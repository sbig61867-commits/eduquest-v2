-- ════════════════════════════════════════════════════════════════════════
-- Student four-part name: private to the student, locked, corrected only by
-- the institution  (2026-09-28)
-- ════════════════════════════════════════════════════════════════════════
-- Owner's rule, 2026-09-28: a student registers with their real four-part name
-- (first · father · grandfather · family, src/lib/person-name.ts). The student
-- alone sees all four parts; teachers, the institution admin and the centre
-- manager see the first and family name only — and must not be able to obtain
-- the middle names at all, not just not see them on screen.
--
-- 1. public.student_names — the four parts, one row per student. RLS: the
--    student reads their own row (the owner reads any); no write policy and
--    writes revoked, so only the service-role routes write it
--    (src/lib/student-names.ts). users.full_name for a student holds first +
--    family name, so every existing screen, report, export and email shows
--    exactly that without change.
--
-- 2. users.name_complete — TRUE once a four-part name is on file. Lets staff
--    flag the students still to be corrected without reading the name itself.
--
-- 3. users_update pins full_name for the `student` role and name_complete for
--    everyone. Until now any student could rename themselves at any time from
--    /student/profile (the browser wrote users.full_name directly), so the
--    registration check could be undone a minute later with a one-letter name
--    or someone else's name. The institution corrects a name through
--    /api/admin/student-name (user-session authorization, service-role write).
--    Teachers, staff and the owner keep editing their own name.
--
-- Everything else in users_update is copied unchanged from the live definition
-- (fix_admin_user_escalation_migration.sql, re-read from pg_policy 2026-09-28).
--
-- Existing students keep their current name (it cannot be split into parts
-- reliably); they start with name_complete = FALSE, i.e. flagged for staff.
--
-- Idempotent / re-runnable. Apply AFTER fix_admin_user_escalation_migration.sql.
-- Regression check: supabase/tests/student_name_lock_check.sql
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The four parts, private to the student ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.student_names (
  user_id          UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  first_name       TEXT NOT NULL CHECK (char_length(first_name)       BETWEEN 1 AND 60),
  father_name      TEXT NOT NULL CHECK (char_length(father_name)      BETWEEN 1 AND 60),
  grandfather_name TEXT NOT NULL CHECK (char_length(grandfather_name) BETWEEN 1 AND 60),
  family_name      TEXT NOT NULL CHECK (char_length(family_name)      BETWEEN 1 AND 60),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.student_names ENABLE ROW LEVEL SECURITY;

-- Supabase's default privileges grant every new public table to anon and
-- authenticated; take all of it back, then give back SELECT only (RLS decides
-- which rows). Writes are service-role only.
REVOKE ALL ON public.student_names FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.student_names TO authenticated;

DROP POLICY IF EXISTS student_names_select ON public.student_names;
CREATE POLICY student_names_select ON public.student_names FOR SELECT
USING (
  user_id = (SELECT auth.uid())
  OR (SELECT current_user_role()) = 'super_admin'
);

-- ── 2. Whether a four-part name is on file ────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS name_complete BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 3. Pins ───────────────────────────────────────────────────────────────
-- Pin helpers, same idiom as current_is_active(): during an UPDATE they observe
-- the pre-update row, so comparing NEW against them detects a change. Each
-- returns the caller's own value only. Must stay executable by `authenticated`
-- (called inside users_update).
CREATE OR REPLACE FUNCTION public.current_full_name()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT full_name FROM public.users WHERE id = auth.uid() $$;

CREATE OR REPLACE FUNCTION public.current_name_complete()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT name_complete FROM public.users WHERE id = auth.uid() $$;

REVOKE ALL ON FUNCTION public.current_full_name()     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_name_complete() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_full_name()     TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_name_complete() TO authenticated;

DROP POLICY IF EXISTS users_update ON public.users;

CREATE POLICY users_update ON public.users FOR UPDATE
USING (
  (SELECT current_user_role()) = 'super_admin'
  OR id = (SELECT auth.uid())
)
WITH CHECK (
  (SELECT current_user_role()) = 'super_admin'
  OR (
    -- Self-update: profile fields only. RLS gates rows, NOT columns — EVERY
    -- identity/authorization column must be pinned here. ANY new such column
    -- on `users` must be added to this list.
    id = (SELECT auth.uid())
    AND role = (SELECT current_user_role())
    AND NOT (tenant_id             IS DISTINCT FROM (SELECT current_tenant_id()))
    AND NOT (is_active             IS DISTINCT FROM (SELECT current_is_active()))
    AND NOT (permissions           IS DISTINCT FROM (SELECT current_permissions()))
    AND NOT (can_create_courses    IS DISTINCT FROM (SELECT current_can_create_courses()))
    AND NOT (is_university_student IS DISTINCT FROM (SELECT current_is_university_student()))
    AND NOT (suspended_by_tenant   IS DISTINCT FROM (SELECT current_suspended_by_tenant()))
    AND NOT (name_complete         IS DISTINCT FROM (SELECT current_name_complete()))
    -- A student's name is the institution's record of them: only staff
    -- correct it (/api/admin/student-name, service role).
    AND (
      (SELECT current_user_role()) <> 'student'
      OR NOT (full_name IS DISTINCT FROM (SELECT current_full_name()))
    )
  )
);

COMMIT;
