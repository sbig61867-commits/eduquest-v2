-- Neon only (Cloudflare + Neon migration, step 9.6). Never run on Supabase.
-- Idempotent: safe to run more than once.
--
-- Sign-in by member ID happens before anyone is known, so it cannot run as a
-- user, and it must not need the broad platform scope of app_service. This
-- function answers exactly one question — the sign-in email behind a member
-- code — and only app_system may call it. An unknown code returns NULL.

BEGIN;

CREATE OR REPLACE FUNCTION public.member_login_email(p_code text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- the account's sign-in email is the source of truth (public.users.email is a copy)
  SELECT coalesce(b.email, u.email)
    FROM public.users u
    LEFT JOIN ba."user" b ON b.id = u.id
   WHERE u.member_code = p_code
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.member_login_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_login_email(text) TO app_system;

COMMIT;
