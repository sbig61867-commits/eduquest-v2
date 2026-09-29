-- member_code_migration.sql — a permanent, unique, human-readable ID for every account
-- (owner's request, 2026-09-29).
--
--   tenants.code        short institution prefix, 2–6 of A–Z / 0–9 (e.g. QOU). Set by the
--                       owner; existing tenants are backfilled as T001, T002 … (renameable).
--   users.member_code   <prefix>-<role letter><8 RANDOM digits>, e.g. QOU-S48203917.
--                       role letters: A institution admin · M centre manager · T teacher ·
--                       S student · P platform owner (prefix EQ).
--                       The digits are random (gen_random_uuid, cryptographic), NOT a counter,
--                       so an ID reveals nothing about how many accounts exist and the
--                       neighbours of a known ID cannot be guessed.
--
-- The code is issued ONCE, at insert, and never changes afterwards — not when the
-- institution prefix is renamed, not on a role change, not by any client
-- (a BEFORE UPDATE trigger restores it, so no RLS policy needs touching).
-- Idempotent: safe to re-run.

BEGIN;

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE public.users   ADD COLUMN IF NOT EXISTS member_code TEXT;

-- Backfill institution prefixes: T001, T002 … in creation order.
WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS n
  FROM public.tenants WHERE code IS NULL
), taken AS (
  SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '^T', ''), '')::int), 0) AS base
  FROM public.tenants WHERE code ~ '^T[0-9]{3,5}$'
)
UPDATE public.tenants t
   SET code = 'T' || lpad((taken.base + numbered.n)::text, 3, '0')
  FROM numbered, taken
 WHERE t.id = numbered.id;

ALTER TABLE public.tenants ALTER COLUMN code SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_code_format') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_code_format CHECK (code ~ '^[A-Z0-9]{2,6}$' AND code <> 'EQ');
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_code_key ON public.tenants (code);

-- New institutions get T<n> automatically when the owner leaves the code empty.
CREATE SEQUENCE IF NOT EXISTS public.tenant_code_seq;
SELECT setval('public.tenant_code_seq', GREATEST(1, (SELECT COALESCE(MAX(regexp_replace(code, '^T', '')::int), 0)
  FROM public.tenants WHERE code ~ '^T[0-9]{3,5}$')), true);
REVOKE ALL ON SEQUENCE public.tenant_code_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tenants_default_code()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.code IS NULL OR btrim(NEW.code) = '' THEN
    LOOP
      NEW.code := 'T' || lpad(nextval('public.tenant_code_seq')::text, 3, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.tenants WHERE code = NEW.code);
    END LOOP;
  ELSE
    NEW.code := upper(btrim(NEW.code));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tenants_default_code() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tenants_default_code ON public.tenants;
CREATE TRIGGER tenants_default_code BEFORE INSERT OR UPDATE OF code ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.tenants_default_code();

CREATE OR REPLACE FUNCTION public.member_role_letter(p_role TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE p_role
    WHEN 'university_admin' THEN 'A' WHEN 'center_manager' THEN 'M'
    WHEN 'teacher' THEN 'T' WHEN 'student' THEN 'S' WHEN 'super_admin' THEN 'P'
    ELSE 'U' END
$$;

-- Issues a random code, retrying on the (1 in 100 million) chance it is taken;
-- the unique index is the final guard.
CREATE OR REPLACE FUNCTION public.assign_member_code()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_prefix TEXT; v_code TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Immutable once issued. A row that somehow has none gets one.
    IF OLD.member_code IS NOT NULL THEN NEW.member_code := OLD.member_code; RETURN NEW; END IF;
  END IF;
  IF NEW.tenant_id IS NOT NULL THEN
    SELECT code INTO v_prefix FROM public.tenants WHERE id = NEW.tenant_id;
  END IF;
  v_prefix := COALESCE(v_prefix, 'EQ');
  LOOP
    v_code := v_prefix || '-' || public.member_role_letter(NEW.role) || lpad((
      ('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))::bit(48)::bigint % 100000000
    )::text, 8, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.users WHERE member_code = v_code);
  END LOOP;
  NEW.member_code := v_code;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.assign_member_code() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS users_assign_member_code ON public.users;
CREATE TRIGGER users_assign_member_code
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.assign_member_code();

-- Backfill existing accounts (the trigger issues each code).
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT id FROM public.users WHERE member_code IS NULL LOOP
    UPDATE public.users SET member_code = NULL WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE public.users ALTER COLUMN member_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_member_code_key ON public.users (member_code);

COMMIT;
