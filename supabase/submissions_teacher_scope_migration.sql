-- ============================================================
-- Migration: scope exam_submissions SELECT to the owning teacher
-- ------------------------------------------------------------
-- Before: any teacher in a tenant could read EVERY submission in
-- that tenant (tenant_id = current_tenant_id()), including
-- submissions for exams owned by other teachers.
--
-- After:
--   super_admin       → all submissions
--   student           → own submissions only
--   university_admin  → all submissions in their tenant
--   teacher           → only submissions for exams they own
--
-- Idempotent / re-runnable.
-- ============================================================

DROP POLICY IF EXISTS "submissions_select" ON exam_submissions;
CREATE POLICY "submissions_select" ON exam_submissions FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin' OR
  student_id = (SELECT auth.uid()) OR
  ((SELECT current_user_role()) = 'university_admin'
     AND tenant_id = (SELECT current_tenant_id())) OR
  ((SELECT current_user_role()) = 'teacher' AND EXISTS (
     SELECT 1 FROM exams
     WHERE exams.id = exam_submissions.exam_id
       AND exams.teacher_id = (SELECT auth.uid())
  ))
);
