-- ════════════════════════════════════════════════════════════════════════
-- RLS init-plan follow-up + covering indexes for foreign keys  (2026-09-26)
-- ════════════════════════════════════════════════════════════════════════
-- Performance only — no access rule changes.
--
-- 1. Three SELECT policies written after rls_initplan_optimization_migration.sql
--    call auth.uid() / current_user_role() / current_tenant_id() bare, so
--    Postgres re-evaluates them for EVERY row (Supabase advisor
--    `auth_rls_initplan`). Wrapping each call in (SELECT …) makes it an
--    init-plan evaluated once per query. `users_select` is read on almost
--    every page, so this is the one that matters most.
--    The predicates are otherwise byte-for-byte the live definitions of
--    2026-09-26 (pg_policies), only the wrappers are added.
--
-- 2. 14 foreign keys without a covering index (advisor `unindexed_foreign_keys`).
--    Without them, deleting or archiving a user/exam/course scans each
--    referencing table. The tables are tiny today, so plain CREATE INDEX is fine.
--
-- Idempotent: ALTER POLICY and CREATE INDEX IF NOT EXISTS can be re-run.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER POLICY users_select ON public.users USING (
  ((SELECT public.current_user_role()) = 'super_admin'::text)
  OR (id = (SELECT auth.uid()))
  OR (((SELECT public.current_user_role()) = ANY (ARRAY['university_admin'::text, 'center_manager'::text, 'teacher'::text]))
      AND (tenant_id = (SELECT public.current_tenant_id())))
  OR (((SELECT public.current_user_role()) = 'student'::text)
      AND (tenant_id = (SELECT public.current_tenant_id()))
      AND ((id IN (SELECT g.teacher_id
                     FROM public.groups g
                     JOIN public.group_students gs ON gs.group_id = g.id
                    WHERE gs.student_id = (SELECT auth.uid())))
        OR (id IN (SELECT c.teacher_id
                     FROM public.courses c
                     JOIN public.course_enrollments ce ON ce.course_id = c.id
                    WHERE ce.student_id = (SELECT auth.uid())))))
);

ALTER POLICY group_students_select ON public.group_students USING (
  ((SELECT public.current_user_role()) = 'super_admin'::text)
  OR (student_id = (SELECT auth.uid()))
  OR (((SELECT public.current_user_role()) <> 'student'::text)
      AND (EXISTS (SELECT 1
                     FROM public.groups g
                    WHERE g.id = group_students.group_id
                      AND ((g.tenant_id = (SELECT public.current_tenant_id()))
                        OR (g.teacher_id = (SELECT auth.uid()))))))
);

ALTER POLICY exam_appeals_select ON public.exam_appeals USING (
  ((SELECT public.current_user_role()) = 'super_admin'::text)
  OR (student_id = (SELECT auth.uid()))
  OR (teacher_id = (SELECT auth.uid()))
  OR (((SELECT public.current_user_role()) = 'university_admin'::text)
      AND (tenant_id = (SELECT public.current_tenant_id())))
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_user_id              ON public.ai_usage_log (user_id);
CREATE INDEX IF NOT EXISTS idx_announcements_created_by          ON public.announcements (created_by);
CREATE INDEX IF NOT EXISTS idx_courses_deleted_by                ON public.courses (deleted_by);
CREATE INDEX IF NOT EXISTS idx_exam_appeals_exam_id              ON public.exam_appeals (exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_appeals_group_id             ON public.exam_appeals (group_id);
CREATE INDEX IF NOT EXISTS idx_exam_appeals_resolved_by          ON public.exam_appeals (resolved_by);
CREATE INDEX IF NOT EXISTS idx_exam_retake_permissions_granted_by ON public.exam_retake_permissions (granted_by);
CREATE INDEX IF NOT EXISTS idx_exams_deleted_by                  ON public.exams (deleted_by);
CREATE INDEX IF NOT EXISTS idx_groups_deleted_by                 ON public.groups (deleted_by);
CREATE INDEX IF NOT EXISTS idx_invitations_accepted_by           ON public.invitations (accepted_by);
CREATE INDEX IF NOT EXISTS idx_invitations_course_id             ON public.invitations (course_id);
CREATE INDEX IF NOT EXISTS idx_invitations_invited_by            ON public.invitations (invited_by);
CREATE INDEX IF NOT EXISTS idx_lessons_deleted_by                ON public.lessons (deleted_by);
CREATE INDEX IF NOT EXISTS idx_schedules_created_by              ON public.schedules (created_by);

COMMIT;
