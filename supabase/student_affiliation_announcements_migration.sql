-- ============================================================
-- EduQuest — student affiliation (university vs continuing-education centre)
--            + capability-gated announcement audiences
--
-- PROBLEM
-- Every university has exactly one continuing-education centre, and both
-- populations live in the SAME tenant. Nothing distinguished them, so:
--   * a centre manager's announcement reached every university student, and
--   * an admin's announcement reached the external trainee who only ever
--     signed up for one course.
-- get_student_announcements() filtered on tenant_id alone.
--
-- MODEL
--   users.is_university_student  — explicit, set at account creation / in the
--                                  invitation. DEFAULT true, so every existing
--                                  student keeps today's behaviour until an
--                                  admin says otherwise.
--   "centre student"             — derived, never stored: NOT is_university_student
--                                  OR enrolled in at least one course. A student
--                                  can be both (the owner's own case).
--
--   announcements.audience       — 'all' | 'university' | 'center' | 'groups'
--   announcements.center_students_only
--                                — set by the API when the author does NOT hold
--                                  `announce_to_university`; narrows a 'groups'
--                                  announcement to the centre students inside
--                                  those groups. Server-set, never client-set.
--
-- The capability itself (`announce_to_university`) is resolved in
-- src/lib/permissions.ts: university_admin default ON, center_manager default
-- OFF, and the owner/admin grant chain (canEditPermissionsOf +
-- ungrantableCapabilities) already governs who may turn it on.
--
-- Idempotent & re-runnable. NOT yet applied to production.
-- ============================================================

-- ── 1. Columns ──────────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_university_student boolean NOT NULL DEFAULT true;

ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS is_university_student boolean NOT NULL DEFAULT true;

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS center_students_only boolean NOT NULL DEFAULT false;

ALTER TABLE public.announcements DROP CONSTRAINT IF EXISTS announcements_audience_check;
ALTER TABLE public.announcements
  ADD CONSTRAINT announcements_audience_check
  CHECK (audience IN ('all', 'groups', 'university', 'center'));

-- ── 2. Pin the new column in users_update ───────────────────
-- RLS gates rows, NOT columns: without this a student could PATCH their own
-- row and move themselves into the university audience. Same idiom as
-- current_permissions() / current_can_create_courses()
-- (users_capability_pin_migration.sql) — during an UPDATE the helper still
-- observes the pre-update snapshot, so comparing NEW against it detects a change.
CREATE OR REPLACE FUNCTION public.current_is_university_student()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT is_university_student FROM public.users WHERE id = auth.uid() $$;

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
    (SELECT current_user_role()) = 'university_admin'
    AND tenant_id = (SELECT current_tenant_id())
    AND role <> 'super_admin'
    AND id <> (SELECT auth.uid())
  )
  OR (
    -- Self-update: profile fields only. EVERY identity/authorization column is
    -- pinned; `is_university_student` now decides which announcements you see.
    id = (SELECT auth.uid())
    AND role = (SELECT current_user_role())
    AND NOT (tenant_id             IS DISTINCT FROM (SELECT current_tenant_id()))
    AND NOT (is_active             IS DISTINCT FROM (SELECT current_is_active()))
    AND NOT (permissions           IS DISTINCT FROM (SELECT current_permissions()))
    AND NOT (can_create_courses    IS DISTINCT FROM (SELECT current_can_create_courses()))
    AND NOT (is_university_student IS DISTINCT FROM (SELECT current_is_university_student()))
  )
);

-- ── 3. Student feed ─────────────────────────────────────────
-- Students still have NO direct row read on announcements; this is the only
-- path. Audience membership is derived here, server-side, from the caller's own
-- row — the client never says which population it belongs to.
CREATE OR REPLACE FUNCTION public.get_student_announcements()
RETURNS TABLE (
  id         uuid,
  title      text,
  body       text,
  image_url  text,
  link_url   text,
  cta_label  text,
  created_at timestamptz,
  ends_at    timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (
    SELECT
      u.id,
      u.tenant_id,
      u.is_university_student,
      -- A centre student is anyone flagged as non-university OR enrolled in at
      -- least one course. Dual-enrolled students match both populations.
      (u.is_university_student = false
       OR EXISTS (SELECT 1 FROM public.course_enrollments ce WHERE ce.student_id = u.id)
      ) AS is_center_student
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role = 'student'
  )
  SELECT a.id, a.title, a.body, a.image_url, a.link_url, a.cta_label, a.created_at, a.ends_at
  FROM public.announcements a
  CROSS JOIN me
  WHERE a.is_published = true
    AND a.tenant_id = me.tenant_id
    AND (a.starts_at IS NULL OR a.starts_at <= now())
    AND (a.ends_at   IS NULL OR a.ends_at   >= now())
    -- Author lacked `announce_to_university`: centre students only, whatever
    -- the audience says.
    AND (a.center_students_only = false OR me.is_center_student)
    AND CASE a.audience
          WHEN 'all'        THEN true
          WHEN 'university' THEN me.is_university_student
          WHEN 'center'     THEN me.is_center_student
          ELSE EXISTS (
            SELECT 1
            FROM public.announcement_groups ag
            JOIN public.group_students gs ON gs.group_id = ag.group_id
            WHERE ag.announcement_id = a.id
              AND gs.student_id = me.id
          )
        END
  ORDER BY a.created_at DESC
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION public.get_student_announcements() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_announcements() TO authenticated;

-- current_is_university_student() is called from inside an RLS policy and must
-- stay executable by the calling user — do NOT revoke it from `authenticated`,
-- or every update on public.users starts failing.

-- ============================================================
-- VERIFICATION (run as the student, e.g. via a rolled-back transaction)
-- ============================================================
-- 1. A centre-only student must NOT see a 'university' announcement:
--      update users set is_university_student = false where id = '<student>';
--      select * from get_student_announcements();
-- 2. A student may never re-classify themselves:
--      update users set is_university_student = true where id = auth.uid();
--    → ERROR: new row violates row-level security policy for table "users"
-- 3. A normal profile edit must still succeed:
--      update users set full_name = 'New Name' where id = auth.uid();
--    → UPDATE 1
