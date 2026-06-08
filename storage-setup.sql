-- ═══════════════════════════════════════════════════════════════
-- storage-setup.sql — Product image uploads (admin "Add product")
-- Run once in the Supabase SQL editor. Creates a public bucket and
-- restricts writes to the logged-in admin.
-- ═══════════════════════════════════════════════════════════════

-- 1. Public bucket for product photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2. Policies on storage.objects scoped to this bucket
DROP POLICY IF EXISTS "kafeel product images public read"   ON storage.objects;
DROP POLICY IF EXISTS "kafeel product images admin insert"  ON storage.objects;
DROP POLICY IF EXISTS "kafeel product images admin update"  ON storage.objects;
DROP POLICY IF EXISTS "kafeel product images admin delete"  ON storage.objects;

CREATE POLICY "kafeel product images public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images');

CREATE POLICY "kafeel product images admin insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "kafeel product images admin update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'product-images');

CREATE POLICY "kafeel product images admin delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-images');
