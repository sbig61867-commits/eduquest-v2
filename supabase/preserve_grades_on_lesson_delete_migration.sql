-- ============================================================
-- Grades must survive lesson deletion.
-- exams.lesson_id was ON DELETE CASCADE: deleting a lesson wiped its
-- homework → submissions → grades (official academic records).
-- Changed to ON DELETE SET NULL: the homework (and every submission
-- and grade under it) survives; it simply detaches from the lesson.
-- Homework titles already embed the lesson name, so context is kept.
-- Idempotent / re-runnable.
-- ============================================================

ALTER TABLE exams DROP CONSTRAINT IF EXISTS exams_lesson_id_fkey;
ALTER TABLE exams
  ADD CONSTRAINT exams_lesson_id_fkey
  FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE SET NULL;
