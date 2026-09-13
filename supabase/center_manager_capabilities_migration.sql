-- ============================================================
-- center_manager_capabilities_migration.sql — 2026-09-13
-- Idempotent + re-runnable. Apply in the Supabase SQL Editor.
--
-- The centre manager can now manage teachers, students, groups and courses
-- inside their own university, each behind a per-user capability flag
-- (src/lib/permissions.ts: manage_teachers / manage_students /
-- manage_groups / manage_courses). Every WRITE goes through route handlers
-- that check the capability with the user session and then write with the
-- service-role client — so no write policy is widened here.
--
-- What this migration changes is READ access the centre manager lacked:
--   * courses_select            — centre manager had no course read at all
--   * course_enrollments_select — needed to see who is enrolled
-- users / groups / group_students already allow every non-student staff
-- role in the tenant (verified against pg_policies on 2026-09-13).
--
-- Capability flags are deliberately NOT evaluated in RLS: reads are
-- tenant-scoped metadata the role already sees elsewhere (dashboard counts),
-- matching the announcements_select / schedules_select convention.
-- ============================================================

DROP POLICY IF EXISTS "courses_select" ON courses;
CREATE POLICY "courses_select" ON courses FOR SELECT USING (
  deleted_at IS NULL
  AND (
    (SELECT current_user_role()) = 'super_admin'
    OR (
      tenant_id = (SELECT current_tenant_id())
      AND (
        (SELECT current_user_role()) IN ('university_admin', 'center_manager')
        OR teacher_id = (SELECT auth.uid())
        OR (
          (SELECT current_user_role()) = 'student'
          AND is_published = true
          AND EXISTS (
            SELECT 1 FROM course_enrollments ce
            WHERE ce.course_id = courses.id AND ce.student_id = (SELECT auth.uid())
          )
        )
      )
    )
  )
);

DROP POLICY IF EXISTS "course_enrollments_select" ON course_enrollments;
CREATE POLICY "course_enrollments_select" ON course_enrollments FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin'
  OR (
    tenant_id = (SELECT current_tenant_id())
    AND (
      (SELECT current_user_role()) IN ('university_admin', 'center_manager', 'teacher')
      OR student_id = (SELECT auth.uid())
    )
  )
);
