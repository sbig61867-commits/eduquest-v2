-- exam_draft_migration.sql
-- Adds answers_draft column to exam_submissions for cross-device resume.
-- Applied manually in the Supabase SQL Editor.

ALTER TABLE public.exam_submissions
  ADD COLUMN IF NOT EXISTS answers_draft JSONB DEFAULT NULL;

-- The start_exam_attempt definition that used to follow here was broken
-- (auth.uid() under the service-role client, grading_status='in_progress',
-- no status) and made every exam start fail. It was removed on 2026-09-25 so
-- re-running this file cannot bring it back; the working definition, which
-- also returns answers_draft, is supabase/fix_start_exam_attempt_migration.sql.
