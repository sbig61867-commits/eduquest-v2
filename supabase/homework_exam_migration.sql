-- ============================================================
-- Migration: Homework + Essay Questions + Grade Export
-- Apply in Supabase SQL Editor
-- ============================================================

-- 1. Add type and lesson_id to exams
ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'exam'
    CHECK (type IN ('exam', 'homework')),
  ADD COLUMN IF NOT EXISTS lesson_id UUID REFERENCES lessons(id) ON DELETE CASCADE;

-- 2. Add scoring + grading fields to exam_submissions
ALTER TABLE exam_submissions
  ADD COLUMN IF NOT EXISTS score        NUMERIC,
  ADD COLUMN IF NOT EXISTS max_score    NUMERIC,
  ADD COLUMN IF NOT EXISTS is_graded    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_flagged   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS question_scores JSONB NOT NULL DEFAULT '{}';
-- question_scores stores per-question teacher scores for essays: {"q_id": 8}

-- 3. Index for homework lookup by lesson
CREATE INDEX IF NOT EXISTS idx_exams_lesson_id ON exams(lesson_id);
CREATE INDEX IF NOT EXISTS idx_exams_type      ON exams(type);

-- 4. RLS: homework follows same rules as exams (teacher owns it via teacher_id)
--    No new policies needed — existing exam policies cover type='homework' too.

-- 5. Verify
SELECT
  column_name, data_type
FROM information_schema.columns
WHERE table_name = 'exams'
  AND column_name IN ('type', 'lesson_id')
ORDER BY column_name;

SELECT
  column_name, data_type
FROM information_schema.columns
WHERE table_name = 'exam_submissions'
  AND column_name IN ('score','max_score','is_graded','is_flagged','question_scores')
ORDER BY column_name;
