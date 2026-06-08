-- ─── Offers Table ────────────────────────────────────────────
CREATE TABLE offers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'عرض خاص',
  price INTEGER NOT NULL,
  item_ids JSONB NOT NULL DEFAULT '[]',
  expires_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER offers_updated_at
  BEFORE UPDATE ON offers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ─── RLS ────────────────────────────────────────────────────
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active offers"
  ON offers FOR SELECT USING (true);
CREATE POLICY "Admin can insert offers"
  ON offers FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admin can update offers"
  ON offers FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admin can delete offers"
  ON offers FOR DELETE USING (auth.uid() IS NOT NULL);

-- ─── Realtime ───────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE offers;
