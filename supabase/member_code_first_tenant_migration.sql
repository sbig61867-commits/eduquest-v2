-- Member ID issued with the account's real institution and role.
--
-- Bug: every account is inserted by the auth trigger as role 'student' with
-- tenant_id NULL, and staff/invitation flows set role + tenant in a second
-- write. users_assign_member_code ran only on that first INSERT and kept the
-- value on UPDATE, so every non-owner account got EQ-S… (e.g. a QOU teacher
-- EQ-S64029349 instead of QOU-T…).
--
-- Fix: the code stays immutable, with one exception — the write that first
-- gives the account an institution (tenant_id NULL → set) reissues it from the
-- final role and tenant, unless the account already signs in with that code
-- (users.email = member_code), which must never change under the person.
--
-- Idempotent: CREATE OR REPLACE only; the trigger itself is unchanged.
-- Existing wrong codes are NOT rewritten here (see the optional block at the end).

BEGIN;

CREATE OR REPLACE FUNCTION public.assign_member_code()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_prefix TEXT; v_code TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Immutable once issued, except the provisional code from before the
    -- account had an institution (see header). A row with none gets one.
    IF OLD.member_code IS NOT NULL AND NOT (
      OLD.tenant_id IS NULL AND NEW.tenant_id IS NOT NULL
      AND OLD.email IS DISTINCT FROM OLD.member_code
      AND NEW.email IS DISTINCT FROM OLD.member_code
    ) THEN
      NEW.member_code := OLD.member_code; RETURN NEW;
    END IF;
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

COMMIT;

-- Optional, owner's decision — reissue existing wrong codes for accounts that
-- do NOT sign in with their code. Run only after approval:
--
-- DO $$ DECLARE r RECORD; v_prefix TEXT; v_code TEXT; BEGIN
--   FOR r IN SELECT u.id, u.role, t.code AS tcode FROM public.users u
--            JOIN public.tenants t ON t.id = u.tenant_id
--            WHERE u.member_code LIKE 'EQ-%' AND u.email IS DISTINCT FROM u.member_code LOOP
--     LOOP
--       v_code := r.tcode || '-' || public.member_role_letter(r.role) || lpad((
--         ('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))::bit(48)::bigint % 100000000
--       )::text, 8, '0');
--       EXIT WHEN NOT EXISTS (SELECT 1 FROM public.users WHERE member_code = v_code);
--     END LOOP;
--     ALTER TABLE public.users DISABLE TRIGGER users_assign_member_code;
--     UPDATE public.users SET member_code = v_code WHERE id = r.id;
--     ALTER TABLE public.users ENABLE TRIGGER users_assign_member_code;
--   END LOOP;
-- END $$;
