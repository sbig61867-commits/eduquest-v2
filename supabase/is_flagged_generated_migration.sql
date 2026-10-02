-- exam_submissions.is_flagged → STORED generated column.
--
-- The column (homework_exam_migration.sql, BOOLEAN NOT NULL DEFAULT FALSE) was never written by any code
-- path, function or trigger, so every reader (reports, teacher records, get_center_dashboard) always saw
-- FALSE while the student's grades page, /api/exams/results and /teacher/proctoring flag an attempt that
-- has at least one VIOLATION event. This makes the database derive it from proctoring_events with that same
-- rule, on every INSERT / UPDATE of the row, whatever path writes it; nobody can write it directly.
--
-- The type list MUST equal VIOLATION_TYPES in src/lib/proctoring-events.ts — enforced by
-- src/__tests__/is-flagged-violation-types.test.ts (signals and info events never flag).
--
-- Adding the column rewrites the table under an ACCESS EXCLUSIVE lock: instant while it is small. Changing
-- the list later = ALTER TABLE … ALTER COLUMN is_flagged SET EXPRESSION AS (…) (PG 17), also a rewrite.
-- No policy, grant, function or index changes; the new column inherits the table's grants
-- (anon / authenticated SELECT only). get_center_dashboard reads it by name (plpgsql, no hard dependency).
--
-- Idempotent: does nothing when is_flagged is already a stored generated column.
-- Rollback (loses nothing — the old column was always FALSE):
--   ALTER TABLE public.exam_submissions DROP COLUMN IF EXISTS is_flagged;
--   ALTER TABLE public.exam_submissions ADD COLUMN is_flagged BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.exam_submissions'::regclass AND attname = 'is_flagged'
      AND attgenerated = 's' AND NOT attisdropped
  ) THEN
    ALTER TABLE public.exam_submissions DROP COLUMN IF EXISTS is_flagged;
    ALTER TABLE public.exam_submissions
      ADD COLUMN is_flagged BOOLEAN GENERATED ALWAYS AS (
        COALESCE(proctoring_events @? '$[*] ? (@.type == "tab_switch" || @.type == "fullscreen_exit" || @.type == "face_not_detected" || @.type == "multiple_faces" || @.type == "looking_away" || @.type == "audio_detected" || @.type == "speech_detected" || @.type == "suspicious_activity" || @.type == "camera_stopped" || @.type == "face_mismatch" || @.type == "spoof_detected")', FALSE)
      ) STORED NOT NULL;
  END IF;
END $$;
