-- ═══════════════════════════════════════════════════════════════
-- customer-auth.sql — Secure customer accounts (phone + password)
--
-- Run order:  supabase-schema.sql → offers-migration.sql →
--             customer-auth.sql → security-fixes.sql
-- (security-fixes.sql redefines create_order to require a login session.)
--
-- SECURITY MODEL
-- • Passwords are hashed server-side with bcrypt (pgcrypto crypt()/gen_salt).
--   The plaintext password is only ever seen inside these SECURITY DEFINER
--   functions; it is never stored and the hash is never sent to the client.
-- • The customers / customer_sessions / customer_otp tables have RLS enabled
--   with NO policies, so the anon/auth roles CANNOT read or write them
--   directly. All access goes through the SECURITY DEFINER RPCs below.
-- • Login issues a random 256-bit session token (stored hashed-by-randomness)
--   with a 30-day expiry; the client keeps it in localStorage.
-- • Phone numbers are validated to the Iraqi +964 format server-side.
-- • WhatsApp OTP is NOT wired yet. Hooks are in place (customer_otp table,
--   phone_verified flag, customer_reset_password OTP check) so it can be
--   added later without touching the client contract.
-- ═══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Tables ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username       TEXT NOT NULL,
  phone          TEXT NOT NULL,                 -- canonical: +9647XXXXXXXX
  password_hash  TEXT NOT NULL,                 -- bcrypt
  phone_verified BOOLEAN DEFAULT false,         -- set true after OTP (later)
  created_at     TIMESTAMPTZ DEFAULT now()
);
-- case-insensitive uniqueness for username; exact for phone
CREATE UNIQUE INDEX IF NOT EXISTS customers_username_lower_idx ON customers (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_idx          ON customers (phone);

CREATE TABLE IF NOT EXISTS customer_sessions (
  token       TEXT PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS customer_sessions_cust_idx ON customer_sessions(customer_id);

-- OTP store for the (later) WhatsApp verification step
CREATE TABLE IF NOT EXISTS customer_otp (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phone       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,                    -- never store the raw code
  purpose     TEXT NOT NULL CHECK (purpose IN ('register','reset')),
  verified    BOOLEAN DEFAULT false,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_otp_phone_idx ON customer_otp(phone);

-- Link orders to the customer who placed them
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id BIGINT;

-- ─── Lock the tables down (RLS on, no policies) ─────────────
ALTER TABLE customers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_otp      ENABLE ROW LEVEL SECURITY;
-- (No policies created → PostgREST anon/auth cannot touch these directly.)

-- ─── Helpers ────────────────────────────────────────────────
-- Validate the Iraqi +964 mobile format (mirrors the client regex).
CREATE OR REPLACE FUNCTION _kafeel_valid_phone(p TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT p ~ '^\+9647[578][0-9]{8}$';
$$;

-- ─── Register ───────────────────────────────────────────────
-- For now (no OTP) this creates the account and logs in. When OTP is added,
-- registration will instead stage the account until customer_otp.verified.
CREATE OR REPLACE FUNCTION customer_register(
  p_username TEXT,
  p_phone    TEXT,
  p_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id    BIGINT;
  v_token TEXT;
BEGIN
  p_username := btrim(COALESCE(p_username, ''));
  p_phone    := btrim(COALESCE(p_phone, ''));

  IF length(p_username) < 3 OR length(p_username) > 30 THEN
    RAISE EXCEPTION 'invalid_username';
  END IF;
  IF NOT _kafeel_valid_phone(p_phone) THEN
    RAISE EXCEPTION 'invalid_phone';
  END IF;
  IF p_password IS NULL OR length(p_password) < 6 THEN
    RAISE EXCEPTION 'weak_password';
  END IF;
  IF EXISTS (SELECT 1 FROM customers WHERE lower(username) = lower(p_username)) THEN
    RAISE EXCEPTION 'username_taken';
  END IF;
  IF EXISTS (SELECT 1 FROM customers WHERE phone = p_phone) THEN
    RAISE EXCEPTION 'phone_taken';
  END IF;

  INSERT INTO customers (username, phone, password_hash)
  VALUES (p_username, p_phone, crypt(p_password, gen_salt('bf', 10)))
  RETURNING id INTO v_id;

  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO customer_sessions (token, customer_id, expires_at)
  VALUES (v_token, v_id, now() + interval '30 days');

  RETURN jsonb_build_object('token', v_token, 'username', p_username, 'phone', p_phone);
END;
$$;

-- ─── Login (by username OR phone) ───────────────────────────
CREATE OR REPLACE FUNCTION customer_login(
  p_identifier TEXT,
  p_password   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cust  customers%ROWTYPE;
  v_token TEXT;
BEGIN
  p_identifier := btrim(COALESCE(p_identifier, ''));

  SELECT * INTO v_cust
    FROM customers
   WHERE lower(username) = lower(p_identifier)
      OR phone = p_identifier
   LIMIT 1;

  -- Generic error — never reveal whether the account exists.
  IF NOT FOUND OR v_cust.password_hash <> crypt(p_password, v_cust.password_hash) THEN
    RAISE EXCEPTION 'invalid_credentials';
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO customer_sessions (token, customer_id, expires_at)
  VALUES (v_token, v_cust.id, now() + interval '30 days');

  RETURN jsonb_build_object('token', v_token, 'username', v_cust.username, 'phone', v_cust.phone);
END;
$$;

-- ─── Who am I (restore session) ─────────────────────────────
CREATE OR REPLACE FUNCTION customer_me(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cust customers%ROWTYPE;
BEGIN
  SELECT c.* INTO v_cust
    FROM customer_sessions s
    JOIN customers c ON c.id = s.customer_id
   WHERE s.token = p_token AND s.expires_at > now();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  RETURN jsonb_build_object('valid', true, 'username', v_cust.username, 'phone', v_cust.phone);
END;
$$;

-- ─── Logout ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION customer_logout(p_token TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM customer_sessions WHERE token = p_token;
END;
$$;

-- ─── Password reset (OTP-gated) ─────────────────────────────
-- Inert until OTP is wired: it requires a verified, unexpired customer_otp
-- row for the phone with purpose='reset'. No such row can exist until the
-- WhatsApp OTP flow is implemented, so this cannot be abused now.
CREATE OR REPLACE FUNCTION customer_reset_password(
  p_phone        TEXT,
  p_otp          TEXT,
  p_new_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_otp customer_otp%ROWTYPE;
BEGIN
  IF NOT _kafeel_valid_phone(p_phone) THEN
    RAISE EXCEPTION 'invalid_phone';
  END IF;
  IF p_new_password IS NULL OR length(p_new_password) < 6 THEN
    RAISE EXCEPTION 'weak_password';
  END IF;

  SELECT * INTO v_otp
    FROM customer_otp
   WHERE phone = p_phone
     AND purpose = 'reset'
     AND expires_at > now()
   ORDER BY id DESC
   LIMIT 1;

  IF NOT FOUND OR NOT v_otp.verified OR v_otp.code_hash <> crypt(p_otp, v_otp.code_hash) THEN
    RAISE EXCEPTION 'otp_required';
  END IF;

  UPDATE customers
     SET password_hash = crypt(p_new_password, gen_salt('bf', 10))
   WHERE phone = p_phone;

  -- consume the OTP and revoke existing sessions for safety
  DELETE FROM customer_otp WHERE phone = p_phone AND purpose = 'reset';
  DELETE FROM customer_sessions s USING customers c
   WHERE s.customer_id = c.id AND c.phone = p_phone;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ─── Grants (RPCs are the only entry points) ────────────────
GRANT EXECUTE ON FUNCTION customer_register(TEXT, TEXT, TEXT)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION customer_login(TEXT, TEXT)                     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION customer_me(TEXT)                              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION customer_logout(TEXT)                          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION customer_reset_password(TEXT, TEXT, TEXT)      TO anon, authenticated;
