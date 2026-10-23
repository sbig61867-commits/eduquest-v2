-- Neon only (Cloudflare + Neon migration, step 9.6). Never run on Supabase.
-- Idempotent: safe to run more than once.
--
-- Sign-in moves from managed Neon Auth to Better Auth running inside our own
-- Worker (owner's decision 2026-10-22: Neon Auth limits sign-in to ~8 per 10 s
-- per IP, which a class starting an exam together would hit). Better Auth's
-- tables live in their own schema `ba`, reached only by the login role
-- app_auth (no BYPASSRLS, rights on `ba` only, through its own Hyperdrive
-- config). The platform roles cannot read password hashes or sessions, and
-- app_auth cannot read platform data.
--
-- Ids are UUIDs (Better Auth generateId), so auth.uid() and every policy keep
-- working: public.users.id = ba."user".id. The app_auth password is set
-- outside this file (never committed).

BEGIN;

CREATE SCHEMA IF NOT EXISTS ba;

-- Better Auth core schema (user, session, account, verification) + its
-- database rate-limit table. Column names are Better Auth's own.
CREATE TABLE IF NOT EXISTS ba."user" (
  id              uuid PRIMARY KEY,
  name            text NOT NULL,
  email           text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,
  image           text,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ba.session (
  id          uuid PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  token       text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "ipAddress" text,
  "userAgent" text,
  "userId"    uuid NOT NULL REFERENCES ba."user"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ba_session_user_idx ON ba.session ("userId");

CREATE TABLE IF NOT EXISTS ba.account (
  id                      uuid PRIMARY KEY,
  "accountId"             text NOT NULL,
  "providerId"            text NOT NULL,
  "userId"                uuid NOT NULL REFERENCES ba."user"(id) ON DELETE CASCADE,
  "accessToken"           text,
  "refreshToken"          text,
  "idToken"               text,
  "accessTokenExpiresAt"  timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope                   text,
  password                text,
  "createdAt"             timestamptz NOT NULL DEFAULT now(),
  "updatedAt"             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ba_account_user_idx ON ba.account ("userId");

CREATE TABLE IF NOT EXISTS ba.verification (
  id          uuid PRIMARY KEY,
  identifier  text NOT NULL,
  value       text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ba_verification_identifier_idx ON ba.verification (identifier);

CREATE TABLE IF NOT EXISTS ba."rateLimit" (
  id            uuid PRIMARY KEY,
  key           text NOT NULL UNIQUE,
  count         integer NOT NULL,
  "lastRequest" bigint NOT NULL
);

-- generateId: 'uuid' leaves id generation to Postgres (gen_random_uuid()).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user', 'session', 'account', 'verification', 'rateLimit'] LOOP
    EXECUTE format('ALTER TABLE ba.%I ALTER COLUMN id SET DEFAULT gen_random_uuid()', t);
  END LOOP;
END $$;

-- 1. The login role: rights on `ba` only, RLS on with a policy for it alone.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_auth') THEN
    CREATE ROLE app_auth LOGIN NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE app_auth LOGIN NOINHERIT NOBYPASSRLS NOCREATEDB NOCREATEROLE;
-- Better Auth names its tables without a schema; the role's own default makes
-- them resolve to `ba` (no connection option needed, works through Hyperdrive).
ALTER ROLE app_auth SET search_path = ba, pg_temp;
REVOKE ALL ON SCHEMA ba FROM PUBLIC;
GRANT USAGE ON SCHEMA ba TO app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ba TO app_auth;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user', 'session', 'account', 'verification', 'rateLimit'] LOOP
    EXECUTE format('ALTER TABLE ba.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE ba.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON ba.%I', 'auth_' || t, t);
    EXECUTE format('CREATE POLICY %I ON ba.%I FOR ALL TO app_auth USING (true) WITH CHECK (true)', 'auth_' || t, t);
  END LOOP;
END $$;

-- 2. public.users follows the Better Auth user (deleting the account still
--    removes the profile, as before).
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_id_neon_auth_fkey;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_id_ba_fkey;
ALTER TABLE public.users
  ADD CONSTRAINT users_id_ba_fkey FOREIGN KEY (id) REFERENCES ba."user"(id) ON DELETE CASCADE;

-- 3. A new account gets a profile row: a student with no institution until an
--    admin or an invitation sets the rest (as on Supabase and Neon Auth).
CREATE OR REPLACE FUNCTION public.handle_new_ba_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, role, tenant_id)
  VALUES (NEW.id, NEW.email, COALESCE(NULLIF(NEW.name, ''), NEW.email), 'student', NULL)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'handle_new_ba_user failed for %: %', NEW.email, SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_ba_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_ba_user_created ON ba."user";
CREATE TRIGGER on_ba_user_created
  AFTER INSERT ON ba."user"
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_ba_user();

-- Neon Auth is no longer the identity source.
DO $$
BEGIN
  IF to_regclass('neon_auth."user"') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS on_neon_auth_user_created ON neon_auth."user"';
  END IF;
END $$;

COMMIT;
