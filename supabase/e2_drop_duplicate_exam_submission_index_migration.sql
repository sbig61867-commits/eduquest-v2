-- E2 — drop the duplicate index on exam_submissions (Post-Plan database maintenance, 2026-10-05).
--
-- idx_exam_submissions_exam_student (exam_id, student_id) — created by rls_performance_migration.sql as a
-- "hot-path" index — duplicates the index behind the UNIQUE constraint exam_submissions_exam_id_student_id_key
-- (exam_id, student_id), same columns in the same order. Every write maintained both; the planner uses the
-- unique index for exactly the same lookups once this one is gone.
--
-- Only this index. The UNIQUE constraint (which stops a second attempt) and every other index —
-- including idx_exam_submissions_student_id / idx_exam_submissions_tenant, which are not part of E2 — are
-- untouched. No table, policy, grant or function change.
--
-- rls_performance_migration.sql is an applied, historical migration and is NOT edited: re-running it would
-- recreate this index (CREATE INDEX IF NOT EXISTS). It must not be re-run (see CLAUDE.md, "Applied migrations").
--
-- Idempotent (IF EXISTS). Rollback: supabase/e2_drop_duplicate_exam_submission_index_rollback.sql.

DROP INDEX IF EXISTS public.idx_exam_submissions_exam_student;
