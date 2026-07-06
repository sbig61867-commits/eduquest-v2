-- ============================================================
-- Homework auto-publish flag
-- When TRUE (default) and the homework contains only auto-gradable
-- questions (mcq / true_false), the student's result is published
-- immediately on submit. Essay homework always requires manual
-- grading + publish from the teacher's submissions tab.
-- Idempotent / re-runnable. Apply in the Supabase SQL Editor.
-- ============================================================

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS auto_publish BOOLEAN NOT NULL DEFAULT TRUE;
