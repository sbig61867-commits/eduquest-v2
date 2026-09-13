-- =============================================================================
-- Fix: student role can enumerate every user/group-roster in their own tenant
-- =============================================================================
-- Found + LIVE-EXPLOIT-VERIFIED during a full security audit on 2026-09-13
-- (see AUDIT/11-security-isolation-tests.md for the full write-up and the
-- real HTTP request that proved it). NOT a cross-tenant leak — every one of
-- the 9 cross-tenant exploit attempts in that audit was blocked. This closes
-- an *intra-tenant* over-exposure instead: `users_select` / `groups_select` /
-- `group_students_select` had no role check beyond `tenant_id =
-- current_tenant_id()`, so a single student account could read the email,
-- full name, role, `is_active` and `permissions` of every other user in
-- their university (including staff), plus every group's full roster —
-- classes they were never enrolled in — via a single unauthenticated-feeling
-- REST call (`GET /rest/v1/users?tenant_id=eq.<own tenant>`).
--
-- SCOPE OF THE FIX: `student` role only. `teacher` / `university_admin` /
-- `center_manager` / `super_admin` keep their existing tenant-wide read —
-- traced against every client-side `.from('users'|'groups'|'group_students')`
-- call in src/app during this audit (2026-09-13) and found a real, shipped
-- feature that depends on it: teacher/groups/page.tsx's "Manage Students"
-- modal queries `users` for every student in the tenant (not just the
-- teacher's own groups) so a teacher can browse the whole student body when
-- assigning someone to a new group. Narrowing that role too would break it;
-- narrowing only `student` does not, because every student-facing page
-- already scopes its own queries to `id = auth.uid()` (self) or reaches
-- `users` only via a join through a group/course the student is actually
-- enrolled in (teacher-name lookups) — verified by tracing every
-- student-facing file under src/app/(student) and src/components/student.
--
-- After this migration, a student can see:
--   - their own `users` row (unchanged — `id = auth.uid()`)
--   - the `users` row of a teacher who owns a group or course they are
--     enrolled in (needed: course/lesson pages show "Instructor: <name>")
--   - their own `group_students` enrollment row(s) — NOT the rest of any
--     group's roster
--   - `groups` rows they are actually enrolled in — NOT every group's name
--     in the university
--
-- Idempotent — DROP POLICY IF EXISTS before each CREATE, safe to re-run.
-- =============================================================================

-- `groups_select`'s student branch and `group_students_select` would
-- otherwise reference each other directly (groups_select checking
-- group_students, group_students_select checking groups) and Postgres
-- rejects that as infinite RLS recursion (42P17 — hit and confirmed live
-- while drafting this migration). This SECURITY DEFINER helper breaks the
-- cycle the same way current_tenant_id()/current_user_role() already do
-- elsewhere in this schema: it queries group_students directly as its
-- (trusted) owner, which is exempt from group_students' own RLS, so
-- groups_select can call it without looping back into itself.
CREATE OR REPLACE FUNCTION current_student_group_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT group_id FROM public.group_students WHERE student_id = auth.uid();
$$;

-- ── users_select ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "users_select" ON users;
CREATE POLICY "users_select" ON users FOR SELECT USING (
  current_user_role() = 'super_admin'
  OR id = auth.uid()
  OR (
    current_user_role() IN ('university_admin', 'center_manager', 'teacher')
    AND tenant_id = current_tenant_id()
  )
  OR (
    current_user_role() = 'student'
    AND tenant_id = current_tenant_id()
    AND (
      -- the teacher of a group this student belongs to
      id IN (
        SELECT g.teacher_id FROM groups g
        JOIN group_students gs ON gs.group_id = g.id
        WHERE gs.student_id = auth.uid()
      )
      -- the teacher of a course this student is enrolled in
      OR id IN (
        SELECT c.teacher_id FROM courses c
        JOIN course_enrollments ce ON ce.course_id = c.id
        WHERE ce.student_id = auth.uid()
      )
    )
  )
);

-- ── groups_select ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "groups_select" ON groups;
CREATE POLICY "groups_select" ON groups FOR SELECT USING (
  deleted_at IS NULL AND (
    current_user_role() = 'super_admin'
    OR (current_user_role() != 'student' AND tenant_id = current_tenant_id())
    OR (
      current_user_role() = 'student'
      AND id IN (SELECT current_student_group_ids())
    )
  )
);

-- ── group_students_select ────────────────────────────────────────────────
DROP POLICY IF EXISTS "group_students_select" ON group_students;
CREATE POLICY "group_students_select" ON group_students FOR SELECT USING (
  current_user_role() = 'super_admin'
  OR student_id = auth.uid()
  OR (
    current_user_role() != 'student'
    AND EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = group_students.group_id
        AND (g.tenant_id = current_tenant_id() OR g.teacher_id = auth.uid())
    )
  )
);
