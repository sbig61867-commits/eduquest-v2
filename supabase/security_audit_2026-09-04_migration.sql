-- ============================================================
-- Security audit fixes — 2026-09-04
-- Idempotent + re-runnable. Apply in the Supabase SQL Editor.
--
-- Findings this migration fixes (all verified live against production
-- with a real low-privilege teacher session, not assumed from reading code):
--
--   1. CRITICAL (functional): users_update has INFINITE RECURSION.
--      Its WITH CHECK sub-selects FROM users while evaluating a policy ON
--      users, so Postgres aborts with "infinite recursion detected in
--      policy for relation users". Live effect: NO user can update their
--      own profile at all — every self-update 500s. It happens to fail
--      closed (privilege escalation is blocked), but legitimate profile
--      edits are broken too.
--
--   2. courses_select is tenant-wide for EVERY role. Verified: a brand-new
--      teacher could read another teacher's course ("Lv3"), including its
--      course_levels / course_units / unit_items, and students can read
--      every course in the university including unpublished drafts.
--      (Writes/deletes were already correctly blocked — confirmed by
--      checking the actual row state, not just the absence of an error:
--      RLS returns "no error, 0 rows" for a blocked UPDATE/DELETE.)
--
-- NOT changed here (deliberate): lessons_select lets any teacher in the
-- tenant read all of that tenant's lessons. That is the intent of the
-- policy shipped in security_rls_fix_migration.sql (colleagues sharing
-- material); students are already correctly limited to published lessons
-- in groups they belong to. Flagged for the owner to decide, not silently
-- tightened here — changing it could break a teacher-collaboration flow.
-- ============================================================

-- ── 0. Helper: is_active without recursion ──────────────────
-- SECURITY DEFINER so the inner read of public.users bypasses RLS and
-- therefore cannot re-trigger the policy being evaluated. search_path is
-- pinned and the table is schema-qualified — without this, PostgREST runs
-- it under a restricted search_path, the unqualified table is "not found",
-- the function returns NULL and every policy calling it silently denies
-- (the exact failure mode documented in CLAUDE.md / fix_helper_search_path).
CREATE OR REPLACE FUNCTION public.current_is_active()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT is_active FROM public.users WHERE id = auth.uid();
$$;

-- ── 1. USERS: fix the infinite recursion ────────────────────
-- Same intent as before (a user may edit their own profile but may NOT
-- change their own role / tenant_id / is_active), but the frozen-field
-- comparison now goes through the existing SECURITY DEFINER helpers
-- instead of a self-referencing sub-select on `users`.
DROP POLICY IF EXISTS "users_update" ON users;

CREATE POLICY "users_update" ON users FOR UPDATE
  USING (
    (SELECT current_user_role()) = 'super_admin'
    OR (
      (SELECT current_user_role()) = 'university_admin'
      AND tenant_id = (SELECT current_tenant_id())
    )
    OR id = (SELECT auth.uid())
  )
  WITH CHECK (
    -- super_admin: unrestricted
    (SELECT current_user_role()) = 'super_admin'
    OR (
      -- university_admin: may update others in their tenant, may not
      -- create a super_admin, may not edit their own row through this arm
      (SELECT current_user_role()) = 'university_admin'
      AND tenant_id = (SELECT current_tenant_id())
      AND role <> 'super_admin'
      AND id <> (SELECT auth.uid())
    )
    OR (
      -- self-service: profile fields only. role / tenant_id / is_active
      -- must still equal the persisted value, read via SECURITY DEFINER
      -- helpers (no recursion).
      id = (SELECT auth.uid())
      AND role      = (SELECT current_user_role())
      AND tenant_id IS NOT DISTINCT FROM (SELECT current_tenant_id())
      AND is_active IS NOT DISTINCT FROM (SELECT current_is_active())
    )
  );

-- ── 2. COURSES: scope reads by ownership / enrolment ────────
-- super_admin: everything. university_admin: their tenant. teacher: only
-- their own courses. student: only published courses they are enrolled in.
DROP POLICY IF EXISTS "courses_select" ON courses;

CREATE POLICY "courses_select" ON courses FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      (SELECT current_user_role()) = 'super_admin'
      OR (
        tenant_id = (SELECT current_tenant_id())
        AND (
          (SELECT current_user_role()) = 'university_admin'
          OR teacher_id = (SELECT auth.uid())
          OR (
            (SELECT current_user_role()) = 'student'
            AND is_published = TRUE
            AND EXISTS (
              SELECT 1 FROM public.course_enrollments ce
              WHERE ce.course_id = courses.id
                AND ce.student_id = (SELECT auth.uid())
            )
          )
        )
      )
    )
  );

-- ── 3. COURSE STRUCTURE: follow the parent course's visibility ──
-- course_levels / course_units / unit_items were each tenant-wide, so the
-- full structure of another teacher's course leaked even once the course
-- row itself is scoped. Each now derives visibility from its course.
DROP POLICY IF EXISTS "course_levels_select" ON course_levels;
CREATE POLICY "course_levels_select" ON course_levels FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.courses c WHERE c.id = course_levels.course_id));

DROP POLICY IF EXISTS "course_units_select" ON course_units;
CREATE POLICY "course_units_select" ON course_units FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.courses c WHERE c.id = course_units.course_id));

DROP POLICY IF EXISTS "unit_items_select" ON unit_items;
CREATE POLICY "unit_items_select" ON unit_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.course_units cu
      JOIN public.courses c ON c.id = cu.course_id
      WHERE cu.id = unit_items.unit_id
    )
  );

-- The EXISTS above deliberately carries no extra predicate: the row is
-- visible exactly when the parent course row is visible, and the parent's
-- own RLS (policy 2) decides that. One place defines course visibility.

-- ── Verify (run manually after applying) ────────────────────
-- As a teacher session, all three should return only that teacher's rows:
--   SELECT id, title, teacher_id FROM courses;
--   SELECT id, name FROM course_levels;
--   SELECT id, title FROM unit_items;
-- And this should now succeed instead of raising "infinite recursion":
--   UPDATE users SET full_name = full_name WHERE id = auth.uid();
