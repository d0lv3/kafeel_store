-- ═══════════════════════════════════════════════════════════════
-- security-fixes.sql — Server-side order validation & privacy
-- Run this in the Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
-- 1. Add access_token column to orders (for #1 order privacy)
-- ───────────────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS access_token TEXT;

-- ───────────────────────────────────────────────────────────────
-- 2. Atomic order creation with server-side validation
--    Fixes: #2 item validation, #3 server-side totals,
--           #9 atomic insert, #10 promo enforcement
-- ───────────────────────────────────────────────────────────────
-- Drop the older (pre-auth) signature if present, then redefine. The login
-- session token is OPTIONAL (guest checkout): if present and valid the order
-- is stamped with the customer, otherwise it is placed as a guest. Phone is
-- validated server-side. Run customer-auth.sql BEFORE this file if you want
-- the optional account-linking (orders.customer_id) to work.
DROP FUNCTION IF EXISTS create_order(TEXT, TEXT, TEXT, JSONB, TEXT);

CREATE OR REPLACE FUNCTION create_order(
  p_customer_name TEXT,
  p_phone         TEXT,
  p_address        TEXT,
  p_items          JSONB,            -- [{item_id, qty, addon_ids, notes}]
  p_promo_code     TEXT DEFAULT NULL,
  p_session_token  TEXT DEFAULT NULL -- customer login session (optional — guest checkout allowed)
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
  -- ── Validate the customer's phone server-side (Iraqi mobile, local
  --    format only — 11 digits like 0770xxxxxxx). Defense-in-depth: the
  --    client validates too, but never trust the client. ──
  IF p_phone IS NULL OR REGEXP_REPLACE(p_phone, '[^0-9]', '', 'g') !~ '^07[5789][0-9]{8}$' THEN
    RAISE EXCEPTION 'invalid_phone';
  END IF;

  -- ── Login is optional (guest checkout). If a valid session token is
  --    supplied we stamp the order with the customer; otherwise the order
  --    is placed as a guest. The customer_sessions table may not exist if
  --    customer-auth.sql was never run, so tolerate that. ──
  IF p_session_token IS NOT NULL AND p_session_token <> '' THEN
    BEGIN
      SELECT customer_id INTO v_customer_id
        FROM customer_sessions
       WHERE token = p_session_token AND expires_at > now();
    EXCEPTION WHEN undefined_table THEN
      v_customer_id := NULL;
    END;
  END IF;

  -- ── Generate secure IDs ──────────────────────────────────
  v_order_id     := 'ORD-' || UPPER(LEFT(REPLACE(gen_random_uuid()::TEXT, '-', ''), 12));
  v_access_token := REPLACE(gen_random_uuid()::TEXT || gen_random_uuid()::TEXT, '-', '');

  -- ── Phase 1: Validate every item and look up real prices ─
  FOR v_rec IN
    SELECT *
      FROM jsonb_to_recordset(p_items)
        AS x(item_id TEXT, qty INTEGER, addon_ids JSONB, notes TEXT)
  LOOP
    -- Quantity sanity check
    IF v_rec.qty IS NULL OR v_rec.qty < 1 OR v_rec.qty > 50 THEN
      RAISE EXCEPTION 'invalid_qty:%', COALESCE(v_rec.item_id, 'unknown');
    END IF;

    v_addon_names := '[]'::JSONB;
    v_unit_price  := 0;
    v_item_name   := '';

    IF v_rec.item_id LIKE 'offer-%' THEN
      -- ── Offer item ───────────────────────────────────────
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
      -- ── Regular menu item ────────────────────────────────
      SELECT * INTO v_menu_row
        FROM menu_items
       WHERE id = v_rec.item_id
         AND in_stock = true;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'item_unavailable:%', v_rec.item_id;
      END IF;

      -- Use the discounted offer price when one is set (server-enforced)
      IF v_menu_row.offer_price IS NOT NULL
         AND v_menu_row.offer_price > 0
         AND v_menu_row.offer_price < v_menu_row.price THEN
        v_unit_price := v_menu_row.offer_price;
      ELSE
        v_unit_price := v_menu_row.price;
      END IF;
      v_item_name  := v_menu_row.name;

      -- Track sales for the "الأكثر مبيعاً" row on the homepage
      UPDATE menu_items
         SET sales_count = COALESCE(sales_count, 0) + v_rec.qty
       WHERE id = v_rec.item_id;

      -- Validate and price each addon against menu_items.addons
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

    -- Accumulate subtotal
    v_subtotal := v_subtotal + (v_unit_price * v_rec.qty);

    -- Store validated item for bulk insert later
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

  -- ── Phase 2: Delivery fee (mirrors client constants) ─────
  v_delivery_fee := CASE WHEN v_subtotal >= 5000 THEN 0 ELSE 1000 END;

  -- ── Phase 3: Server-side promo code validation (#10) ─────
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
      -- promo_codes table not created yet — skip silently
      NULL;
    END;
  END IF;

  v_total := v_subtotal + v_delivery_fee - v_discount;

  -- Minimum order check
  IF v_subtotal < 3000 THEN
    RAISE EXCEPTION 'minimum_not_met';
  END IF;

  -- ── Phase 4: Atomic insert (order + items in one tx) ─────
  INSERT INTO orders
    (id, customer_name, phone, address, status,
     subtotal, delivery_fee, discount, promo_code, total, access_token, customer_id)
  VALUES
    (v_order_id, p_customer_name, p_phone, p_address, 'pending',
     v_subtotal, v_delivery_fee, v_discount, p_promo_code, v_total, v_access_token, v_customer_id);

  INSERT INTO order_items (order_id, item_name, qty, unit_price, addons, notes)
  SELECT v_order_id,
         elem->>'item_name',
         (elem->>'qty')::INTEGER,
         (elem->>'unit_price')::INTEGER,
         ARRAY(SELECT jsonb_array_elements_text(elem->'addons')),
         elem->>'notes'
    FROM jsonb_array_elements(v_validated_items) elem;

  -- ── Return server-calculated result ──────────────────────
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

-- ───────────────────────────────────────────────────────────────
-- 3. Secure order status lookup (#1 order privacy)
--    Requires the access_token that was returned at creation time.
--    Falls back gracefully for old orders (token = NULL).
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_order_status(
  p_order_id     TEXT,
  p_access_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
BEGIN
  SELECT status, cancel_note INTO v_order
    FROM orders
   WHERE id = p_order_id
     AND access_token = p_access_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'status',      v_order.status,
    'cancel_note', COALESCE(v_order.cancel_note, '')
  );
END;
$$;

-- ───────────────────────────────────────────────────────────────
-- 4. Grant execute permissions
-- ───────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION create_order(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION create_order(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_order_status(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_order_status(TEXT, TEXT) TO authenticated;

-- ───────────────────────────────────────────────────────────────
-- 5. Push tokens: deduplicate + add unique constraint
-- ───────────────────────────────────────────────────────────────
DELETE FROM push_tokens a USING push_tokens b
 WHERE a.id > b.id
   AND a.order_id  = b.order_id
   AND a.fcm_token = b.fcm_token;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'push_tokens_order_fcm_unique'
  ) THEN
    ALTER TABLE push_tokens
      ADD CONSTRAINT push_tokens_order_fcm_unique UNIQUE (order_id, fcm_token);
  END IF;
END;
$$;

-- ───────────────────────────────────────────────────────────────
-- 6. (Optional) Lock down direct anon INSERT on orders/order_items
--    The create_order function (SECURITY DEFINER) bypasses RLS,
--    so it still works. This prevents clients from inserting
--    orders with fabricated totals.
--
--    Check your current policies first:
--      SELECT policyname, cmd, roles FROM pg_policies
--       WHERE tablename IN ('orders','order_items');
--
--    Then drop the anon INSERT policies, for example:
--      DROP POLICY "allow anon insert" ON orders;
--      DROP POLICY "allow anon insert" ON order_items;
-- ───────────────────────────────────────────────────────────────
