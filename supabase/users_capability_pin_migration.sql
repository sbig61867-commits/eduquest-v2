-- ============================================================
-- EduQuest — pin the capability columns in users_update  (privilege-escalation fix)
--
-- PROBLEM
-- `users_update` lets a user update their own row (`id = auth.uid()`), and its
-- WITH CHECK pinned only `role`, `tenant_id` and `is_active`. Postgres RLS
-- cannot restrict *columns*, so every other column on that row was freely
-- self-writable — including the two that carry authorization:
--
--   users.permissions        JSONB — the staff capability map read by can()
--                            in src/lib/permissions.ts (manage_announcements,
--                            manage_center_staff, view_reports, ...)
--   users.can_create_courses BOOL  — gates api/courses, api/courses/create-full
--                            and api/ai/generate-course-pptx
--
-- So any authenticated user could POST a PATCH to /rest/v1/users?id=eq.<self>
-- and grant themselves staff capabilities, or flip the course-creation gate,
-- entirely bypassing the two admin routes that are supposed to be the only way
-- to change them.
--
-- Verified before the fix: impersonating a real teacher session, the write
-- succeeded (1 row) and left permissions =
--   {"view_reports":true,"manage_students":true,"manage_teachers":true,
--    "manage_invitations":true,"manage_center_staff":true}
-- Verified after: "new row violates row-level security policy for table users",
-- while a legitimate self-update (changing full_name) still succeeds.
--
-- No abuse had occurred — every users.permissions value was still '{}'.
--
-- WHY THIS IS SAFE
-- Both legitimate editors write with the SERVICE-ROLE client, which bypasses
-- RLS entirely, so neither is affected:
--   src/app/api/admin/permissions/route.ts        (permissions)
--   src/app/api/admin/teacher-permissions/route.ts (can_create_courses)
-- That route also already blocks self-editing and refuses to grant a capability
-- the caller does not hold — this migration closes the path that skipped it.
--
-- The two new helpers follow the existing current_is_active() idiom already used
-- by this policy: SECURITY DEFINER, pinned search_path, read the caller's stored
-- row by auth.uid(). During an UPDATE they observe the pre-update snapshot, so
-- comparing the NEW value against them detects any change.
--
-- NOTE: like current_user_role() / current_tenant_id() / current_is_active(),
-- these helpers are called from inside an RLS policy and are evaluated as the
-- calling user — do NOT revoke EXECUTE from `authenticated`, or every update on
-- public.users will start failing.
--
-- Idempotent & re-runnable. Applied to production 2026-09-05.
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_permissions()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT permissions FROM public.users WHERE id = auth.uid() $$;

CREATE OR REPLACE FUNCTION public.current_can_create_courses()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT can_create_courses FROM public.users WHERE id = auth.uid() $$;

DROP POLICY IF EXISTS users_update ON public.users;

CREATE POLICY users_update ON public.users FOR UPDATE
USING (
  (SELECT current_user_role()) = 'super_admin'
  OR ((SELECT current_user_role()) = 'university_admin'
      AND tenant_id = (SELECT current_tenant_id()))
  OR id = (SELECT auth.uid())
)
WITH CHECK (
  (SELECT current_user_role()) = 'super_admin'
  OR (
    -- university_admin may manage users in their own tenant, but may not mint a
    -- super_admin and may not edit themselves through this branch.
    (SELECT current_user_role()) = 'university_admin'
    AND tenant_id = (SELECT current_tenant_id())
    AND role <> 'super_admin'
    AND id <> (SELECT auth.uid())
  )
  OR (
    -- Self-update: profile fields only. Identity AND authorization columns are
    -- pinned to their stored values.
    id = (SELECT auth.uid())
    AND role = (SELECT current_user_role())
    AND NOT (tenant_id          IS DISTINCT FROM (SELECT current_tenant_id()))
    AND NOT (is_active          IS DISTINCT FROM (SELECT current_is_active()))
    AND NOT (permissions        IS DISTINCT FROM (SELECT current_permissions()))
    AND NOT (can_create_courses IS DISTINCT FROM (SELECT current_can_create_courses()))
  )
);


-- ============================================================
-- VERIFICATION (run as a normal signed-in user; both must hold)
-- ============================================================
-- 1. Self-granting a capability must be rejected:
--      update users set permissions = '{"view_reports":true}' where id = auth.uid();
--    → ERROR: new row violates row-level security policy for table "users"
--
-- 2. A normal profile edit must still succeed:
--      update users set full_name = 'New Name' where id = auth.uid();
--    → UPDATE 1
