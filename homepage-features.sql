-- ═══════════════════════════════════════════════════════════════
-- homepage-features.sql — best-sellers + admin-picked specials
-- Run this once on an EXISTING database (fresh installs already get
-- these columns from supabase-schema.sql). After running it, re-run
-- security-fixes.sql so create_order picks up sales tracking.
-- ═══════════════════════════════════════════════════════════════

-- 1. New columns on menu_items
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS is_special  BOOLEAN DEFAULT false;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS sales_count INTEGER DEFAULT 0;

-- 2. (Optional) Index to fetch best-sellers quickly
CREATE INDEX IF NOT EXISTS idx_menu_items_sales ON menu_items(sales_count DESC);

-- 3. IMPORTANT: re-run security-fixes.sql now — its updated create_order()
--    increments menu_items.sales_count on every purchase, which powers the
--    "الأكثر مبيعاً" row. "منتجات مميزة" is controlled by the is_special
--    flag, toggled from the admin dashboard (⭐ button in إدارة القائمة).
