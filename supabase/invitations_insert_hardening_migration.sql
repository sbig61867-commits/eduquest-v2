-- ============================================================
-- Migration: harden the invitations_insert RLS policy
-- ------------------------------------------------------------
-- The previous policy only checked the CALLER's role:
--   current_user_role() IN ('super_admin','university_admin','teacher')
-- It did NOT constrain the new row's `role` or `tenant_id`.
--
-- Because invitation creation in the API uses the service-role
-- (admin) client (which bypasses RLS) and the anon key is public,
-- a logged-in teacher could call PostgREST directly and insert an
-- invitation with role='university_admin' or any tenant_id — then
-- accept it (accept-invitation trusts inv.role) to escalate
-- privileges or cross into another tenant.
--
-- This policy mirrors the API's ROLE_CEILING and tenant scoping at
-- the database level (the real last line of defense):
--   super_admin      → any role, any tenant
--   university_admin → teacher/student, own tenant only
--   teacher          → student only, own tenant only
-- and forces invited_by = auth.uid() to prevent audit spoofing.
--
-- The legitimate API insert runs as service_role (bypasses RLS),
-- so this change does not affect normal invitation creation.
--
-- Idempotent / re-runnable.
-- ============================================================

DROP POLICY IF EXISTS "invitations_insert" ON invitations;
CREATE POLICY "invitations_insert" ON invitations FOR INSERT WITH CHECK (
  (SELECT current_user_role()) = 'super_admin'
  OR (
    tenant_id = (SELECT current_tenant_id())
    AND invited_by = (SELECT auth.uid())
    AND (
      ((SELECT current_user_role()) = 'university_admin' AND role IN ('teacher','student'))
      OR ((SELECT current_user_role()) = 'teacher' AND role = 'student')
    )
  )
);
