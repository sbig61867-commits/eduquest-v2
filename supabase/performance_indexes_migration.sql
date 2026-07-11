-- ============================================================
-- performance_indexes_migration.sql
-- Idempotent. Run once in the Supabase SQL Editor.
--
-- Adds indexes for hot-path queries that were found missing:
--
-- 1. lessons(teacher_id) WHERE deleted_at IS NULL
--    — teacher dashboard COUNT query + lessons page filter
-- 2. exams(teacher_id) WHERE deleted_at IS NULL
--    — teacher dashboard COUNT query + exams page filter
-- 3. grades(exam_id)
--    — join from exam_submissions → grades (submission detail)
-- 4. exam_submissions(exam_id, student_id) already exists
--    (idx_exam_submissions_exam_student from rls_performance_migration)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_lessons_teacher_live
  ON lessons (teacher_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_exams_teacher_live
  ON exams (teacher_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_grades_exam_id
  ON grades (exam_id);
