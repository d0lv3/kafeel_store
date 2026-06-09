-- ═══════════════════════════════════════════════════════════════
-- sections.sql — section (category) management for the admin
-- Adds a `categories` table the admin can create/edit/delete.
-- Products link to a section by name (menu_items.category).
-- Run after supabase-schema.sql.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS categories (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  image TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anyone read categories"  ON categories;
DROP POLICY IF EXISTS "admin insert categories" ON categories;
DROP POLICY IF EXISTS "admin update categories" ON categories;
DROP POLICY IF EXISTS "admin delete categories" ON categories;
CREATE POLICY "anyone read categories"  ON categories FOR SELECT USING (true);
CREATE POLICY "admin insert categories" ON categories FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "admin update categories" ON categories FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin delete categories" ON categories FOR DELETE USING (auth.uid() IS NOT NULL);

DO $rt$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE categories;
EXCEPTION WHEN duplicate_object THEN NULL; END $rt$;

-- Rename a section and cascade the new name to its products (atomic, admin-only)
CREATE OR REPLACE FUNCTION admin_rename_category(p_id BIGINT, p_new TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_old TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;
  p_new := btrim(p_new);
  IF length(p_new) = 0 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  SELECT name INTO v_old FROM categories WHERE id = p_id;
  IF v_old IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_old = p_new THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM categories WHERE name = p_new) THEN RAISE EXCEPTION 'name_taken'; END IF;
  UPDATE categories SET name = p_new WHERE id = p_id;
  UPDATE menu_items SET category = p_new WHERE category = v_old;
END; $fn$;

-- Delete a section AND all its products (atomic, admin-only)
CREATE OR REPLACE FUNCTION admin_delete_category(p_id BIGINT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT name INTO v_name FROM categories WHERE id = p_id;
  IF v_name IS NULL THEN RETURN; END IF;
  DELETE FROM menu_items WHERE category = v_name;
  DELETE FROM categories WHERE id = p_id;
END; $fn$;

GRANT EXECUTE ON FUNCTION admin_rename_category(BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_category(BIGINT) TO authenticated;

-- ─── Migrate legacy "*" section names to readable "و" form ──
-- Renames existing sections AND cascades to their products. Idempotent
-- (after the first run nothing matches the old names). Guarded so it can't
-- clash with a row that already has the new name. Safe on fresh installs.
DO $mig$
DECLARE
  v_pairs TEXT[][] := ARRAY[
    ['جكليت*سلات هدايا',      'جكليت وسلات هدايا'],
    ['قسم الشاي * القهوة',    'قسم الشاي والقهوة'],
    ['معكرونية*شوربة جاهزة',  'معكرونية وشوربة جاهزة']
  ];
  v_old TEXT; v_new TEXT; i INT;
BEGIN
  FOR i IN 1 .. array_length(v_pairs, 1) LOOP
    v_old := v_pairs[i][1];
    v_new := v_pairs[i][2];
    IF NOT EXISTS (SELECT 1 FROM categories WHERE name = v_new) THEN
      UPDATE categories SET name = v_new WHERE name = v_old;
    END IF;
    UPDATE menu_items SET category = v_new WHERE category = v_old;
  END LOOP;
END $mig$;

-- ─── Seed the current sections ──────────────────────────────
INSERT INTO categories (name, image, sort_order) VALUES
  ('قسم المواد الغذائية', 'assets/categories/cat_3.jpg', 1),
  ('قسم المنظفات', 'assets/categories/cat_2.jpg', 2),
  ('الفطائر والمقبلات', 'assets/categories/cat_696b56d441f361964749.jpg', 3),
  ('معطرات جو + الأرضيات', 'assets/categories/cat_693ee59141f361964752.jpg', 4),
  ('إفطار صباحي', 'assets/categories/cat_37.jpg', 5),
  ('البطاريات', 'assets/categories/cat_32.jpg', 6),
  ('الشامبو', 'assets/categories/cat_40.jpg', 7),
  ('المشروبات الغازية والعصائر', 'assets/categories/cat_8.jpg', 8),
  ('جكليت وسلات هدايا', 'assets/categories/cat_18.jpg', 9),
  ('قرطاسية', 'assets/categories/cat_4.jpg', 10),
  ('قسم الاجباس', 'assets/categories/cat_20.jpg', 11),
  ('قسم الاجبان', 'assets/categories/cat_19.jpg', 12),
  ('قسم الالبان', 'assets/categories/cat_44.jpg', 13),
  ('قسم البقوليات', 'assets/categories/cat_10.jpg', 14),
  ('قسم البهارات', 'assets/categories/cat_21.jpg', 15),
  ('قسم الحفاظات', 'assets/categories/cat_17.jpg', 16),
  ('قسم الحلويات', 'assets/categories/cat_5.jpg', 17),
  ('قسم الحليب السائل', 'assets/categories/cat_43.jpg', 18),
  ('قسم الدايت', 'assets/categories/cat_33.jpg', 19),
  ('قسم الزيوت', 'assets/categories/cat_9.jpg', 20),
  ('قسم السكائر', 'assets/categories/cat_1.jpg', 21),
  ('قسم الشاي والقهوة', 'assets/categories/cat_14.jpg', 22),
  ('قسم الصلصات', 'assets/categories/cat_31.jpg', 23),
  ('قسم العطور', 'assets/categories/cat_12.jpg', 24),
  ('قسم الكرزات', 'assets/categories/cat_6.jpg', 25),
  ('قسم اللحوم', 'assets/categories/cat_22.jpg', 26),
  ('قسم المخللات', 'assets/categories/cat_7.jpg', 27),
  ('قسم المعلبات', 'assets/categories/cat_30.jpg', 28),
  ('قسم المواد السفري', 'assets/categories/cat_15.jpg', 29),
  ('قسم المياه', 'assets/categories/cat_28.jpg', 30),
  ('قسم الورقيات', 'assets/categories/cat_16.jpg', 31),
  ('قسم حليب ومستلزمات الاطفال', 'assets/categories/cat_13.jpg', 32),
  ('كيك و معجنات', 'assets/categories/cat_26.jpg', 34),
  ('مخبوزات', 'assets/categories/cat_36.jpg', 35),
  ('مستلزمات اعياد ميلاد ومناسبات', 'assets/categories/cat_38.jpg', 36),
  ('مشروبات الطاقة', 'assets/categories/cat_41.jpg', 37),
  ('معكرونية وشوربة جاهزة', 'assets/categories/cat_35.jpg', 38),
  ('منتجات الورد البغدادي', 'assets/categories/cat_48.jpg', 39),
  ('منتجات شركة البوادي', 'assets/categories/cat_24.jpg', 40),
  ('منتجات مخابز الريف', 'assets/categories/cat_45.jpg', 41)
ON CONFLICT (name) DO NOTHING;
