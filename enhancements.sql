-- ═══════════════════════════════════════════════════════════════
-- enhancements.sql — feature batch (run ONCE in Supabase SQL Editor)
--
-- Bundles the DB changes for:
--   • Real stock quantity tracking (menu_items.stock_qty)
--   • Order-level delivery note (orders.delivery_note)
--   • create_order rewrite (stock check + decrement, delivery note)
--   • Security hardening (lock orders/order_items SELECT+INSERT to
--     admin + the SECURITY DEFINER RPC; remove blanket anon access)
--
-- Idempotent: safe to re-run. Run AFTER supabase-schema.sql and
-- security-fixes.sql.
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
-- 1. New columns
-- ───────────────────────────────────────────────────────────────
-- stock_qty: NULL  = not tracked (treated as unlimited, current behaviour)
--            0..N   = enforced quantity; auto out-of-stock when it hits 0
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS stock_qty INTEGER;

-- delivery_note: optional free-text instruction for the driver
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_note TEXT DEFAULT '';

-- ───────────────────────────────────────────────────────────────
-- 2. create_order — rewritten with stock handling + delivery note
--    Adds p_delivery_note (optional, last param). Drops the previous
--    6-arg signature so named RPC calls are unambiguous.
-- ───────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS create_order(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT);
DROP FUNCTION IF EXISTS create_order(TEXT, TEXT, TEXT, JSONB, TEXT);

CREATE OR REPLACE FUNCTION create_order(
  p_customer_name TEXT,
  p_phone         TEXT,
  p_address       TEXT,
  p_items         JSONB,            -- [{item_id, qty, addon_ids, notes}]
  p_promo_code    TEXT DEFAULT NULL,
  p_session_token TEXT DEFAULT NULL, -- customer login session (optional — guest checkout allowed)
  p_delivery_note TEXT DEFAULT NULL  -- optional order-level note for the driver
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id        TEXT;
  v_access_token    TEXT;
  v_customer_id     BIGINT;
  v_subtotal        INTEGER := 0;
  v_delivery_fee    INTEGER;
  v_discount        INTEGER := 0;
  v_total           INTEGER;
  v_validated_items JSONB   := '[]'::JSONB;
  v_rec             RECORD;
  v_menu_row        RECORD;
  v_offer_row       RECORD;
  v_promo_row       RECORD;
  v_unit_price      INTEGER;
  v_item_name       TEXT;
  v_addon_names     JSONB;
BEGIN
  -- Validate the customer's phone server-side (Iraqi local mobile, 11 digits).
  IF p_phone IS NULL OR REGEXP_REPLACE(p_phone, '[^0-9]', '', 'g') !~ '^07[5789][0-9]{8}$' THEN
    RAISE EXCEPTION 'invalid_phone';
  END IF;

  -- Optional login session → stamp customer_id (tolerate missing table).
  IF p_session_token IS NOT NULL AND p_session_token <> '' THEN
    BEGIN
      SELECT customer_id INTO v_customer_id
        FROM customer_sessions
       WHERE token = p_session_token AND expires_at > now();
    EXCEPTION WHEN undefined_table THEN
      v_customer_id := NULL;
    END;
  END IF;

  v_order_id     := 'ORD-' || UPPER(LEFT(REPLACE(gen_random_uuid()::TEXT, '-', ''), 12));
  v_access_token := REPLACE(gen_random_uuid()::TEXT || gen_random_uuid()::TEXT, '-', '');

  -- ── Phase 1: validate each item + look up real prices ────
  FOR v_rec IN
    SELECT *
      FROM jsonb_to_recordset(p_items)
        AS x(item_id TEXT, qty INTEGER, addon_ids JSONB, notes TEXT)
  LOOP
    IF v_rec.qty IS NULL OR v_rec.qty < 1 OR v_rec.qty > 50 THEN
      RAISE EXCEPTION 'invalid_qty:%', COALESCE(v_rec.item_id, 'unknown');
    END IF;

    v_addon_names := '[]'::JSONB;
    v_unit_price  := 0;
    v_item_name   := '';

    IF v_rec.item_id LIKE 'offer-%' THEN
      SELECT * INTO v_offer_row
        FROM offers
       WHERE id = SUBSTRING(v_rec.item_id FROM 7)::INTEGER
         AND is_active = true
         AND expires_at > NOW();

      IF NOT FOUND THEN
        RAISE EXCEPTION 'offer_expired:%', v_rec.item_id;
      END IF;

      v_unit_price := v_offer_row.price;
      v_item_name  := v_offer_row.title;

    ELSE
      SELECT * INTO v_menu_row
        FROM menu_items
       WHERE id = v_rec.item_id
         AND in_stock = true;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'item_unavailable:%', v_rec.item_id;
      END IF;

      -- Stock-quantity guard: when tracked, must have enough on hand.
      IF v_menu_row.stock_qty IS NOT NULL AND v_menu_row.stock_qty < v_rec.qty THEN
        RAISE EXCEPTION 'item_unavailable:%', v_rec.item_id;
      END IF;

      IF v_menu_row.offer_price IS NOT NULL
         AND v_menu_row.offer_price > 0
         AND v_menu_row.offer_price < v_menu_row.price THEN
        v_unit_price := v_menu_row.offer_price;
      ELSE
        v_unit_price := v_menu_row.price;
      END IF;
      v_item_name  := v_menu_row.name;

      -- Track sales + decrement tracked stock (auto out-of-stock at 0).
      UPDATE menu_items
         SET sales_count = COALESCE(sales_count, 0) + v_rec.qty,
             stock_qty   = CASE WHEN stock_qty IS NOT NULL
                                THEN GREATEST(stock_qty - v_rec.qty, 0)
                                ELSE NULL END,
             in_stock    = CASE WHEN stock_qty IS NOT NULL AND (stock_qty - v_rec.qty) <= 0
                                THEN false ELSE in_stock END
       WHERE id = v_rec.item_id;

      -- Validate + price addons
      IF  v_rec.addon_ids IS NOT NULL
          AND jsonb_typeof(v_rec.addon_ids) = 'array'
          AND jsonb_array_length(v_rec.addon_ids) > 0
      THEN
        DECLARE
          v_aid   TEXT;
          v_found JSONB;
        BEGIN
          FOR v_aid IN SELECT jsonb_array_elements_text(v_rec.addon_ids)
          LOOP
            SELECT elem INTO v_found
              FROM jsonb_array_elements(
                     COALESCE(v_menu_row.addons, '[]'::JSONB)
                   ) elem
             WHERE elem->>'id' = v_aid;

            IF v_found IS NULL THEN
              RAISE EXCEPTION 'invalid_addon:%:%', v_aid, v_rec.item_id;
            END IF;

            v_unit_price  := v_unit_price + (v_found->>'price')::INTEGER;
            v_addon_names := v_addon_names || jsonb_build_array(v_found->>'name');
          END LOOP;
        END;
      END IF;
    END IF;

    v_subtotal := v_subtotal + (v_unit_price * v_rec.qty);

    v_validated_items := v_validated_items || jsonb_build_array(
      jsonb_build_object(
        'item_name',  v_item_name,
        'qty',        v_rec.qty,
        'unit_price', v_unit_price,
        'addons',     v_addon_names,
        'notes',      COALESCE(v_rec.notes, '')
      )
    );
  END LOOP;

  -- ── Phase 2: delivery fee (mirrors client constants) ─────
  v_delivery_fee := CASE WHEN v_subtotal >= 5000 THEN 0 ELSE 1000 END;

  -- ── Phase 3: server-side promo validation ────────────────
  IF p_promo_code IS NOT NULL AND p_promo_code != '' THEN
    BEGIN
      SELECT * INTO v_promo_row
        FROM promo_codes
       WHERE code = p_promo_code AND active = true;

      IF FOUND THEN
        IF v_promo_row.type = 'percent' THEN
          v_discount := ROUND(v_subtotal * v_promo_row.value / 100.0)::INTEGER;
        ELSIF v_promo_row.type = 'fixed' THEN
          v_discount := LEAST(v_promo_row.value::INTEGER, v_subtotal);
        END IF;
      END IF;
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;
  END IF;

  v_total := v_subtotal + v_delivery_fee - v_discount;

  IF v_subtotal < 3000 THEN
    RAISE EXCEPTION 'minimum_not_met';
  END IF;

  -- ── Phase 4: atomic insert ───────────────────────────────
  INSERT INTO orders
    (id, customer_name, phone, address, status,
     subtotal, delivery_fee, discount, promo_code, total,
     access_token, customer_id, delivery_note)
  VALUES
    (v_order_id, p_customer_name, p_phone, p_address, 'pending',
     v_subtotal, v_delivery_fee, v_discount, p_promo_code, v_total,
     v_access_token, v_customer_id, COALESCE(NULLIF(TRIM(p_delivery_note), ''), ''));

  INSERT INTO order_items (order_id, item_name, qty, unit_price, addons, notes)
  SELECT v_order_id,
         elem->>'item_name',
         (elem->>'qty')::INTEGER,
         (elem->>'unit_price')::INTEGER,
         ARRAY(SELECT jsonb_array_elements_text(elem->'addons')),
         elem->>'notes'
    FROM jsonb_array_elements(v_validated_items) elem;

  RETURN jsonb_build_object(
    'id',           v_order_id,
    'access_token', v_access_token,
    'subtotal',     v_subtotal,
    'delivery_fee', v_delivery_fee,
    'discount',     v_discount,
    'total',        v_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION create_order(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION create_order(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) TO authenticated;

-- ───────────────────────────────────────────────────────────────
-- 3. Security hardening — orders & order_items
--    Before: "Anyone can read/create orders" (USING true) exposed every
--    customer's name/phone/address to anyone holding the anon key.
--    After:  only the admin (authenticated) can SELECT; inserts go solely
--    through create_order (SECURITY DEFINER, bypasses RLS). Customers read
--    their own status via get_order_status(order_id, access_token) RPC.
-- ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anyone can read orders"        ON orders;
DROP POLICY IF EXISTS "Anyone can create orders"      ON orders;
DROP POLICY IF EXISTS "Anyone can read order items"   ON order_items;
DROP POLICY IF EXISTS "Anyone can create order items" ON order_items;

DROP POLICY IF EXISTS "Admin can read orders" ON orders;
CREATE POLICY "Admin can read orders"
  ON orders FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admin can read order items" ON order_items;
CREATE POLICY "Admin can read order items"
  ON order_items FOR SELECT USING (auth.uid() IS NOT NULL);

-- (orders/order_items keep their existing "Admin can update/delete" policies.)
