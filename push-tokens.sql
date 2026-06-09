-- ─────────────────────────────────────────────────────────────
-- push-tokens.sql
-- Creates the push_tokens table used by Firebase push notifications.
-- Run once in Supabase → SQL Editor.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS push_tokens (
  id         BIGSERIAL PRIMARY KEY,
  order_id   TEXT        NOT NULL,   -- 'ADMIN' for admin app; order id for customers
  fcm_token  TEXT        NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT push_tokens_uq UNIQUE (order_id, fcm_token)
);

-- Customers/admins can register their own token
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "push_tokens_insert" ON push_tokens
  FOR INSERT WITH CHECK (true);

-- Only service role (Edge Function) reads tokens — no SELECT for anon
