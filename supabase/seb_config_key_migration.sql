-- ════════════════════════════════════════════════════════════════════════
-- Optional Safe Exam Browser requirement per exam  (2026-09-27) — PENDING
-- ════════════════════════════════════════════════════════════════════════
-- exams.seb_config_key: the Config Key of the teacher's SEB configuration
-- (64 hex characters, from the SEB Config Tool). NULL = no SEB requirement,
-- which is every existing exam, so nothing changes until a teacher sets one.
-- /api/exam/start then refuses an attempt unless the request carries SEB's
-- Config Key hash for the exam page (src/lib/seb.ts).
--
-- No policy change: students already cannot SELECT exams (answers-leak fix),
-- and get_student_exams() lists explicit columns, so the key never reaches a
-- student. Writes go through /api/exams with the service-role client.
--
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS seb_config_key TEXT;

DO $$ BEGIN
  ALTER TABLE public.exams
    ADD CONSTRAINT exams_seb_config_key_format CHECK (seb_config_key IS NULL OR seb_config_key ~ '^[0-9a-f]{64}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
