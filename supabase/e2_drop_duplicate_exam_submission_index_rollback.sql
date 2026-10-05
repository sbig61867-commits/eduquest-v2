-- Rollback for e2_drop_duplicate_exam_submission_index_migration.sql — recreates the dropped index with its
-- exact original definition (pg_get_indexdef on the live DB, 2026-10-05):
--   CREATE INDEX idx_exam_submissions_exam_student ON public.exam_submissions USING btree (exam_id, student_id)

CREATE INDEX IF NOT EXISTS idx_exam_submissions_exam_student ON public.exam_submissions USING btree (exam_id, student_id);
