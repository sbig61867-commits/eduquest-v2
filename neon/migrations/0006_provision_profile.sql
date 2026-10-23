-- Neon only (Cloudflare + Neon migration, step 9). Never run on Supabase.
-- Idempotent: safe to run more than once.
--
-- A new account's profile row is created by the ba."user" trigger as a student
-- with no institution. app_service is pinned to one institution, so it can
-- neither see nor update a row without one — and must not be able to: accounts
-- whose institution was deleted also have none, and a service unit could
-- otherwise pull them into its own institution.
-- This function is the one narrow way to give a NEW account its place: it only
-- touches a row created in the last 10 minutes that is still a student with no
-- institution, and only into the institution the calling service unit is
-- pinned to (or any, in platform scope for a verified super_admin).

BEGIN;

CREATE OR REPLACE FUNCTION public.provision_user_profile(
  p_user uuid,
  p_tenant uuid,
  p_role text,
  p_email text,
  p_full_name text,
  p_is_university_student boolean,
  p_must_change_password boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT (coalesce(current_setting('app.scope', true), '') = 'platform'
          OR p_tenant = nullif(current_setting('app.tenant_id', true), '')::uuid) THEN
    RAISE EXCEPTION 'PROVISION_SCOPE' USING ERRCODE = '42501';
  END IF;

  UPDATE public.users
     SET email = p_email,
         full_name = p_full_name,
         role = p_role,
         tenant_id = p_tenant,
         is_active = true,
         is_university_student = CASE WHEN p_role = 'student' THEN p_is_university_student ELSE is_university_student END,
         must_change_password = p_must_change_password
   WHERE id = p_user
     AND tenant_id IS NULL
     AND role = 'student'
     AND created_at > now() - interval '10 minutes';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'PROVISION_NOT_NEW' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.provision_user_profile(uuid, uuid, text, text, text, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_user_profile(uuid, uuid, text, text, text, boolean, boolean) TO app_service;

COMMIT;
