-- =============================================================================
-- Security audit 2026-09-29 — two fixes found on the live DB.
-- =============================================================================
-- 1. users_update pinned role/tenant/permissions/… but NOT `email` or
--    `avatar_url`, so any user (a student included) could PATCH their own row
--    via PostgREST: show `rector@university.edu` to their teacher and admin,
--    redirect institutional mail (/api/mail/send reads users.email) to any
--    address, or point their avatar at a tracking URL. No screen changes
--    either column — only service-role routes write them (create-user) — so
--    pinning them changes nothing legitimate. Verified live before the fix:
--    a student set their own email and avatar (ALLOWED).
--    The policy body is the live definition read on 2026-09-29, unchanged
--    except for the two added pins. Keep every existing pin when editing it.
--
-- 2. announcement-images is a PUBLIC bucket (images open by their URL with no
--    policy at all), but the extra SELECT policy on storage.objects also let
--    anyone LIST every institution's image paths — each begins with the
--    tenant id. Nothing in the app lists the bucket; dropping the policy
--    keeps every public image URL working.
--
-- Idempotent. Regression check: supabase/tests/audit_2026_09_29_check.sql.
-- =============================================================================

-- ── 1. Pin email / avatar_url in users_update ───────────────────────────────
CREATE OR REPLACE FUNCTION public.current_email()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT email FROM public.users WHERE id = auth.uid() $$;

CREATE OR REPLACE FUNCTION public.current_avatar_url()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT avatar_url FROM public.users WHERE id = auth.uid() $$;

REVOKE ALL ON FUNCTION public.current_email() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_avatar_url() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_email() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_avatar_url() TO authenticated, service_role;

DROP POLICY IF EXISTS users_update ON public.users;
CREATE POLICY users_update ON public.users FOR UPDATE
USING (
  ((SELECT public.current_user_role()) = 'super_admin') OR (id = (SELECT auth.uid()))
)
WITH CHECK (
  ((SELECT public.current_user_role()) = 'super_admin')
  OR (
    (id = (SELECT auth.uid()))
    AND (role = (SELECT public.current_user_role()))
    AND (NOT (tenant_id IS DISTINCT FROM (SELECT public.current_tenant_id())))
    AND (NOT (is_active IS DISTINCT FROM (SELECT public.current_is_active())))
    AND (NOT (permissions IS DISTINCT FROM (SELECT public.current_permissions())))
    AND (NOT (can_create_courses IS DISTINCT FROM (SELECT public.current_can_create_courses())))
    AND (NOT (is_university_student IS DISTINCT FROM (SELECT public.current_is_university_student())))
    AND (NOT (suspended_by_tenant IS DISTINCT FROM (SELECT public.current_suspended_by_tenant())))
    AND (NOT (name_complete IS DISTINCT FROM (SELECT public.current_name_complete())))
    AND (((SELECT public.current_user_role()) <> 'student') OR (NOT (full_name IS DISTINCT FROM (SELECT public.current_full_name()))))
    AND (NOT (email IS DISTINCT FROM (SELECT public.current_email())))
    AND (NOT (avatar_url IS DISTINCT FROM (SELECT public.current_avatar_url())))
  )
);

-- ── 2. announcement-images: public URLs yes, bucket listing no ──────────────
DROP POLICY IF EXISTS announcement_images_public_read ON storage.objects;
