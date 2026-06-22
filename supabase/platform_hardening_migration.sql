-- ============================================================
-- EduQuest — Platform Hardening Migration
-- Run AFTER schema.sql + invitations_migration.sql
--
-- Fixes:
--   1. Exam attempt lifecycle (status + started_at) — server-authoritative timing
--   2. Atomic, RLS-bypassing exam writes via SECURITY DEFINER RPCs
--      (students cannot write grades/submissions directly under RLS)
--   3. Re-submission lock (in_progress -> submitted, one-way)
--   4. Server-side enforcement of exam window + per-attempt duration
--   5. Persistent rate limiting (survives serverless / multi-instance)
--   6. Atomic proctoring event append (no read-then-write race)
-- ============================================================

-- ── 1. Exam attempt lifecycle columns ───────────────────────
ALTER TABLE exam_submissions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('in_progress','submitted'));
ALTER TABLE exam_submissions
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

-- ── 2. Persistent rate limiting ─────────────────────────────
CREATE TABLE IF NOT EXISTS rate_limits (
  key      TEXT PRIMARY KEY,
  count    INT NOT NULL,
  reset_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_reset_at ON rate_limits(reset_at);

-- Atomic counter: increments within a window, resets when the window passes.
-- One round-trip, race-free via INSERT ... ON CONFLICT.
CREATE OR REPLACE FUNCTION check_rate_limit(p_key TEXT, p_limit INT, p_window_secs INT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE _count INT; _reset TIMESTAMPTZ; _now TIMESTAMPTZ := now();
BEGIN
  INSERT INTO rate_limits (key, count, reset_at)
  VALUES (p_key, 1, _now + make_interval(secs => p_window_secs))
  ON CONFLICT (key) DO UPDATE
    SET count    = CASE WHEN rate_limits.reset_at < _now THEN 1 ELSE rate_limits.count + 1 END,
        reset_at = CASE WHEN rate_limits.reset_at < _now THEN _now + make_interval(secs => p_window_secs) ELSE rate_limits.reset_at END
  RETURNING count, reset_at INTO _count, _reset;
  RETURN jsonb_build_object('allowed', _count <= p_limit, 'remaining', GREATEST(p_limit - _count, 0), 'reset_at', _reset);
END $$;

-- ── 3. start_exam_attempt ───────────────────────────────────
-- Atomic + idempotent. Records the authoritative server start time.
-- Rejects if the attempt was already submitted (no second attempt).
CREATE OR REPLACE FUNCTION start_exam_attempt(p_exam_id UUID, p_student_id UUID, p_tenant_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE _row RECORD;
BEGIN
  SELECT status, started_at INTO _row FROM exam_submissions
  WHERE exam_id = p_exam_id AND student_id = p_student_id;
  IF FOUND THEN
    IF _row.status = 'submitted' THEN RAISE EXCEPTION 'ALREADY_SUBMITTED'; END IF;
    RETURN jsonb_build_object('started_at', _row.started_at, 'resumed', true);
  END IF;
  INSERT INTO exam_submissions (exam_id, student_id, tenant_id, answers, proctoring_events, status, started_at)
  VALUES (p_exam_id, p_student_id, p_tenant_id, '{}'::jsonb, '[]'::jsonb, 'in_progress', now());
  RETURN jsonb_build_object('started_at', now(), 'resumed', false);
END $$;

-- ── 4. append_proctoring_events ─────────────────────────────
-- Atomic jsonb concat — no read-then-write race when frames overlap.
-- Only writes while the attempt is still in progress.
CREATE OR REPLACE FUNCTION append_proctoring_events(p_exam_id UUID, p_student_id UUID, p_events JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE exam_submissions
  SET proctoring_events = COALESCE(proctoring_events, '[]'::jsonb) || COALESCE(p_events, '[]'::jsonb)
  WHERE exam_id = p_exam_id AND student_id = p_student_id AND status = 'in_progress';
END $$;

-- ── 5. finalize_exam_submission ─────────────────────────────
-- The single authoritative write path for finishing an exam:
--   * locks the attempt row (FOR UPDATE) to serialize concurrent submits
--   * enforces the teacher-defined window (starts_at / ends_at)
--   * enforces per-attempt duration from the SERVER start time (+30s grace)
--   * transitions in_progress -> submitted exactly once (re-submission lock)
--   * writes the authoritative grade (computed server-side by the caller)
CREATE OR REPLACE FUNCTION finalize_exam_submission(
  p_exam_id       UUID,
  p_student_id    UUID,
  p_answers       JSONB,
  p_client_events JSONB,
  p_score         NUMERIC,
  p_max_score     NUMERIC
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _exam     RECORD;
  _sub      RECORD;
  _now      TIMESTAMPTZ := now();
  _deadline TIMESTAMPTZ;
BEGIN
  SELECT duration_minutes, starts_at, ends_at, tenant_id INTO _exam
  FROM exams WHERE id = p_exam_id AND is_published = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXAM_NOT_FOUND'; END IF;

  SELECT id, status, started_at, proctoring_events INTO _sub
  FROM exam_submissions
  WHERE exam_id = p_exam_id AND student_id = p_student_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_STARTED'; END IF;
  IF _sub.status = 'submitted' THEN RAISE EXCEPTION 'ALREADY_SUBMITTED'; END IF;

  IF _exam.starts_at IS NOT NULL AND _now < _exam.starts_at THEN
    RAISE EXCEPTION 'EXAM_NOT_OPEN';
  END IF;
  IF _exam.ends_at IS NOT NULL AND _now > _exam.ends_at THEN
    RAISE EXCEPTION 'EXAM_CLOSED';
  END IF;

  _deadline := _sub.started_at + make_interval(mins => _exam.duration_minutes) + interval '30 seconds';
  IF _now > _deadline THEN
    RAISE EXCEPTION 'TIME_EXPIRED';
  END IF;

  UPDATE exam_submissions
  SET answers           = p_answers,
      proctoring_events = COALESCE(_sub.proctoring_events, '[]'::jsonb) || COALESCE(p_client_events, '[]'::jsonb),
      status            = 'submitted',
      submitted_at      = _now
  WHERE id = _sub.id;

  INSERT INTO grades (exam_id, student_id, tenant_id, submission_id, score, max_score)
  VALUES (p_exam_id, p_student_id, _exam.tenant_id, _sub.id, p_score, p_max_score)
  ON CONFLICT (student_id, exam_id) DO UPDATE
    SET score = EXCLUDED.score, max_score = EXCLUDED.max_score,
        submission_id = EXCLUDED.submission_id, graded_at = now();

  RETURN jsonb_build_object('score', p_score, 'max_score', p_max_score);
END $$;
