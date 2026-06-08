-- ═══════════════════════════════════════════════════════════════
-- offers-product.sql — per-product discount offers ("العروض")
--
-- The admin sets a discounted price on a product (إدارة القائمة → edit →
-- "سعر العرض"). Products with an offer price appear in the "العروض" row on
-- the customer homepage, with the original price struck through.
--
-- Run this once on your EXISTING database, then RE-RUN security-fixes.sql
-- (its create_order now charges the discounted price when one is set).
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS offer_price INTEGER;

-- offer_price IS NULL  → no offer
-- offer_price > 0 AND < price → product is "on offer" at that price
