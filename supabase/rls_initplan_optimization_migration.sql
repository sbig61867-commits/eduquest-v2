-- ============================================================
-- rls_initplan_optimization_migration.sql — 2026-09-05
-- Idempotent + re-runnable.
--
-- The Supabase performance advisor flagged 16 policies with
-- `auth_rls_initplan`: they call auth.uid() / current_user_role() /
-- current_tenant_id() directly, so Postgres re-evaluates the function
-- ONCE PER ROW. Wrapping each call in a scalar sub-select — (SELECT
-- auth.uid()) — turns it into an InitPlan that is evaluated ONCE per
-- query and reused for every row.
--
-- This is the documented Supabase optimization and is SEMANTICALLY
-- IDENTICAL: the wrapped functions are STABLE and take no arguments from
-- the row, so hoisting them cannot change any result. Only the plan
-- changes. `rls_performance_migration.sql` already did this for the hot
-- tables; these 16 were missed.
--
-- Every policy below is recreated with the SAME command, the SAME
-- expression and the SAME role targeting ({public}, i.e. no TO clause —
-- verified against pg_policies before writing this file). UPDATE policies
-- that had no WITH CHECK keep none, so the USING expression continues to
-- serve as the check.
-- ============================================================

-- ── lessons / exams ─────────────────────────────────────────
DROP POLICY IF EXISTS "lessons_delete" ON lessons;
CREATE POLICY "lessons_delete" ON lessons FOR DELETE USING (
  (SELECT current_user_role()) = 'super_admin'
  OR ((SELECT current_user_role()) = 'teacher' AND teacher_id = (SELECT auth.uid()))
);

DROP POLICY IF EXISTS "exams_delete" ON exams;
CREATE POLICY "exams_delete" ON exams FOR DELETE USING (
  (SELECT current_user_role()) = 'super_admin'
  OR ((SELECT current_user_role()) = 'teacher' AND teacher_id = (SELECT auth.uid()))
);

-- ── courses ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "courses_insert" ON courses;
CREATE POLICY "courses_insert" ON courses FOR INSERT WITH CHECK (
  tenant_id = (SELECT current_tenant_id())
  AND (
    (SELECT current_user_role()) = 'super_admin'
    OR (SELECT current_user_role()) = 'university_admin'
    OR (
      (SELECT current_user_role()) = 'teacher'
      AND EXISTS (
        SELECT 1 FROM public.users
        WHERE users.id = (SELECT auth.uid()) AND users.can_create_courses = true
      )
    )
  )
);

DROP POLICY IF EXISTS "courses_update" ON courses;
CREATE POLICY "courses_update" ON courses FOR UPDATE USING (
  (SELECT current_user_role()) = 'super_admin'
  OR (
    (SELECT current_user_role()) = ANY (ARRAY['teacher','university_admin'])
    AND tenant_id = (SELECT current_tenant_id())
    AND ((SELECT current_user_role()) = 'university_admin' OR teacher_id = (SELECT auth.uid()))
  )
);

DROP POLICY IF EXISTS "courses_delete" ON courses;
CREATE POLICY "courses_delete" ON courses FOR DELETE USING (
  (SELECT current_user_role()) = 'super_admin'
  OR (
    (SELECT current_user_role()) = ANY (ARRAY['teacher','university_admin'])
    AND tenant_id = (SELECT current_tenant_id())
    AND ((SELECT current_user_role()) = 'university_admin' OR teacher_id = (SELECT auth.uid()))
  )
);

-- ── course_enrollments ──────────────────────────────────────
DROP POLICY IF EXISTS "course_enrollments_select" ON course_enrollments;
CREATE POLICY "course_enrollments_select" ON course_enrollments FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin'
  OR (
    tenant_id = (SELECT current_tenant_id())
    AND (
      (SELECT current_user_role()) = ANY (ARRAY['university_admin','teacher'])
      OR student_id = (SELECT auth.uid())
    )
  )
);

-- ── exam_retake_permissions ─────────────────────────────────
DROP POLICY IF EXISTS "exam_retake_select" ON exam_retake_permissions;
CREATE POLICY "exam_retake_select" ON exam_retake_permissions FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin'
  OR (
    tenant_id = (SELECT current_tenant_id())
    AND (
      (SELECT current_user_role()) = ANY (ARRAY['university_admin','teacher'])
      OR student_id = (SELECT auth.uid())
    )
  )
);

-- ── student_progress ────────────────────────────────────────
DROP POLICY IF EXISTS "student_progress_select" ON student_progress;
CREATE POLICY "student_progress_select" ON student_progress FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin'
  OR (
    tenant_id = (SELECT current_tenant_id())
    AND (
      (SELECT current_user_role()) = ANY (ARRAY['university_admin','teacher'])
      OR student_id = (SELECT auth.uid())
    )
  )
);

DROP POLICY IF EXISTS "student_progress_insert" ON student_progress;
CREATE POLICY "student_progress_insert" ON student_progress FOR INSERT WITH CHECK (
  student_id = (SELECT auth.uid()) AND tenant_id = (SELECT current_tenant_id())
);

-- ── unit_quiz_submissions ───────────────────────────────────
DROP POLICY IF EXISTS "unit_quiz_submissions_select" ON unit_quiz_submissions;
CREATE POLICY "unit_quiz_submissions_select" ON unit_quiz_submissions FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin'
  OR (
    tenant_id = (SELECT current_tenant_id())
    AND (
      (SELECT current_user_role()) = ANY (ARRAY['university_admin','teacher'])
      OR student_id = (SELECT auth.uid())
    )
  )
);

DROP POLICY IF EXISTS "unit_quiz_submissions_insert" ON unit_quiz_submissions;
CREATE POLICY "unit_quiz_submissions_insert" ON unit_quiz_submissions FOR INSERT WITH CHECK (
  student_id = (SELECT auth.uid()) AND tenant_id = (SELECT current_tenant_id())
);

-- ── surveys ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "surveys_select" ON surveys;
CREATE POLICY "surveys_select" ON surveys FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin'
  OR (
    tenant_id = (SELECT current_tenant_id())
    AND (
      (SELECT current_user_role()) = 'university_admin'
      OR teacher_id = (SELECT auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.group_students gs
        WHERE gs.group_id = surveys.group_id AND gs.student_id = (SELECT auth.uid())
      )
    )
  )
);

DROP POLICY IF EXISTS "surveys_insert" ON surveys;
CREATE POLICY "surveys_insert" ON surveys FOR INSERT WITH CHECK (
  tenant_id = (SELECT current_tenant_id())
  AND (SELECT current_user_role()) = 'teacher'
  AND teacher_id = (SELECT auth.uid())
);

DROP POLICY IF EXISTS "surveys_update" ON surveys;
CREATE POLICY "surveys_update" ON surveys FOR UPDATE USING (
  (SELECT current_user_role()) = 'super_admin'
  OR (
    (SELECT current_user_role()) = 'teacher'
    AND teacher_id = (SELECT auth.uid())
    AND tenant_id = (SELECT current_tenant_id())
  )
);

-- ── survey_responses ────────────────────────────────────────
DROP POLICY IF EXISTS "survey_responses_select" ON survey_responses;
CREATE POLICY "survey_responses_select" ON survey_responses FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin'
  OR student_id = (SELECT auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.surveys s
    WHERE s.id = survey_responses.survey_id
      AND (
        ((SELECT current_user_role()) = 'teacher' AND s.teacher_id = (SELECT auth.uid()))
        OR ((SELECT current_user_role()) = 'university_admin' AND s.tenant_id = (SELECT current_tenant_id()))
      )
  )
);

DROP POLICY IF EXISTS "survey_responses_insert" ON survey_responses;
CREATE POLICY "survey_responses_insert" ON survey_responses FOR INSERT WITH CHECK (
  (SELECT current_user_role()) = 'student'
  AND student_id = (SELECT auth.uid())
  AND tenant_id = (SELECT current_tenant_id())
  AND EXISTS (
    SELECT 1 FROM public.surveys s
    JOIN public.group_students gs ON gs.group_id = s.group_id
    WHERE s.id = survey_responses.survey_id
      AND s.is_open = true
      AND gs.student_id = (SELECT auth.uid())
  )
);
