-- ============================================================
-- Supabase Schema for ماركت الكفيل (Kafeel Market)
--
-- HOW TO USE:
-- 1. Create a Supabase project at https://supabase.com
-- 2. Go to SQL Editor in your Supabase dashboard
-- 3. Paste this entire file and click "Run"
-- 4. Create admin user: go to Authentication → Users → Add User
--    Email: admin@kafeel.restaurant  Password: (your admin password)
-- 5. Copy your project URL and anon key from Settings → API
--    and paste them into data.js
-- ============================================================

-- ─── Tables ─────────────────────────────────────────────────

CREATE TABLE menu_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT NOT NULL,
  price INTEGER NOT NULL,
  image TEXT DEFAULT '',
  in_stock BOOLEAN DEFAULT true,
  addons JSONB DEFAULT '[]'::jsonb,
  is_special BOOLEAN DEFAULT false,   -- admin-picked "منتجات مميزة"
  sales_count INTEGER DEFAULT 0,      -- incremented per sale → "الأكثر مبيعاً"
  offer_price INTEGER,                -- discounted price → "العروض" (NULL = no offer)
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'cooking', 'delivery', 'done', 'cancelled')),
  subtotal INTEGER NOT NULL,
  delivery_fee INTEGER DEFAULT 0,
  discount INTEGER DEFAULT 0,
  promo_code TEXT,
  total INTEGER NOT NULL,
  cancel_note TEXT DEFAULT '',
  customer_id BIGINT,                 -- set by create_order from the login session
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE order_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  unit_price INTEGER NOT NULL,
  addons TEXT[] DEFAULT '{}',
  notes TEXT DEFAULT ''
);

CREATE TABLE promo_codes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('percent', 'fixed')),
  value INTEGER NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE push_tokens (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id TEXT NOT NULL,
  fcm_token TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Indexes ────────────────────────────────────────────────

CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_menu_items_category ON menu_items(category);
CREATE INDEX idx_push_tokens_order_id ON push_tokens(order_id);

-- ─── Auto-update updated_at on orders ───────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ─── Row Level Security ─────────────────────────────────────

ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

-- menu_items: anyone reads, authenticated admin writes
CREATE POLICY "Anyone can read menu"
  ON menu_items FOR SELECT USING (true);
CREATE POLICY "Admin can insert menu"
  ON menu_items FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admin can update menu"
  ON menu_items FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admin can delete menu"
  ON menu_items FOR DELETE USING (auth.uid() IS NOT NULL);

-- orders: anyone creates/reads, admin updates/deletes
CREATE POLICY "Anyone can create orders"
  ON orders FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can read orders"
  ON orders FOR SELECT USING (true);
CREATE POLICY "Admin can update orders"
  ON orders FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admin can delete orders"
  ON orders FOR DELETE USING (auth.uid() IS NOT NULL);

-- order_items: anyone creates/reads, admin manages
CREATE POLICY "Anyone can create order items"
  ON order_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can read order items"
  ON order_items FOR SELECT USING (true);
CREATE POLICY "Admin can update order items"
  ON order_items FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admin can delete order items"
  ON order_items FOR DELETE USING (auth.uid() IS NOT NULL);

-- promo_codes: anyone reads, admin manages
CREATE POLICY "Anyone can read promos"
  ON promo_codes FOR SELECT USING (true);
CREATE POLICY "Admin can insert promos"
  ON promo_codes FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admin can update promos"
  ON promo_codes FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admin can delete promos"
  ON promo_codes FOR DELETE USING (auth.uid() IS NOT NULL);

-- settings: anyone reads, admin writes
CREATE POLICY "Anyone can read settings"
  ON settings FOR SELECT USING (true);
CREATE POLICY "Admin can insert settings"
  ON settings FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admin can update settings"
  ON settings FOR UPDATE USING (auth.uid() IS NOT NULL);

-- push_tokens: anyone creates, admin reads
CREATE POLICY "Anyone can save tokens"
  ON push_tokens FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin can read tokens"
  ON push_tokens FOR SELECT USING (auth.uid() IS NOT NULL);

-- ─── Enable Realtime ────────────────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE orders;
ALTER PUBLICATION supabase_realtime ADD TABLE menu_items;

-- ─── Seed Data: Settings ────────────────────────────────────

INSERT INTO settings (key, value) VALUES
  ('restaurant_status', '{"isOpen": true}'::jsonb);

-- ─── Seed Data: Menu Items (PLACEHOLDER market products) ────
-- Replace these with the real Kafeel Market product list.
-- Keep `category` values identical to CATEGORIES in data.js.
-- `image` is '' here — add image paths (e.g. assets/products/x.png) later.

INSERT INTO menu_items (id, name, description, category, price, image, in_stock, addons, is_special, sales_count, sort_order) VALUES
  ('veg_tomato',    'طماطم',      '', 'خضار وفواكه',  1000, '', true, '[]', false, 40, 1),
  ('veg_cucumber',  'خيار',       '', 'خضار وفواكه',  750,  '', true, '[]', false, 12, 2),
  ('fruit_apple',   'تفاح',       '', 'خضار وفواكه',  2000, '', true, '[]', true,   8, 3),
  ('dairy_milk',    'حليب',       '', 'ألبان وأجبان', 1250, '', true, '[]', false, 33, 4),
  ('dairy_cheese',  'جبن',        '', 'ألبان وأجبان', 2500, '', true, '[]', true,   5, 5),
  ('dairy_yogurt',  'لبن',        '', 'ألبان وأجبان', 1000, '', true, '[]', false, 20, 6),
  ('bake_bread',    'صمون',       '', 'مخبوزات',      500,  '', true, '[]', false, 55, 7),
  ('bake_cake',     'كيك',        '', 'مخبوزات',      1500, '', true, '[]', true,   3, 8),
  ('drink_water',   'ماء',        '', 'مشروبات',      250,  '', true, '[]', false, 60, 9),
  ('drink_cola',    'كولا',       '', 'مشروبات',      500,  '', true, '[]', false, 48, 10),
  ('drink_juice',   'عصير',       '', 'مشروبات',      1000, '', true, '[]', false, 15, 11),
  ('snack_chips',   'چبس',        '', 'وجبات خفيفة',  500,  '', true, '[]', false, 25, 12),
  ('snack_choco',   'شوكولاتة',   '', 'وجبات خفيفة',  750,  '', true, '[]', true,  18, 13),
  ('clean_soap',    'صابون',      '', 'منظفات',       1000, '', true, '[]', false,  7, 14),
  ('clean_deterg',  'منظف غسيل',  '', 'منظفات',       3000, '', true, '[]', false,  2, 15);
