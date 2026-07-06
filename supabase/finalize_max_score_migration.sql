-- ============================================================
-- finalize_exam_submission: also persist score + max_score on the
-- exam_submissions row itself. All student/teacher UIs read from
-- exam_submissions; max_score was only written to `grades`, leaving
-- NULL max_score → "70/1 (7000%)" displays.
-- Also backfills max_score on existing submitted rows.
-- Idempotent / re-runnable.
-- ============================================================

CREATE OR REPLACE FUNCTION public.finalize_exam_submission(
  p_exam_id       UUID,
  p_student_id    UUID,
  p_answers       JSONB,
  p_client_events JSONB,
  p_score         NUMERIC,
  p_max_score     NUMERIC
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _exam     RECORD;
  _sub      RECORD;
  _now      TIMESTAMPTZ := now();
  _deadline TIMESTAMPTZ;
BEGIN
  SELECT duration_minutes, starts_at, ends_at, tenant_id INTO _exam
  FROM public.exams WHERE id = p_exam_id AND is_published = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXAM_NOT_FOUND'; END IF;

  SELECT id, status, started_at, proctoring_events INTO _sub
  FROM public.exam_submissions
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

  UPDATE public.exam_submissions
  SET answers           = p_answers,
      proctoring_events = COALESCE(_sub.proctoring_events, '[]'::jsonb) || COALESCE(p_client_events, '[]'::jsonb),
      status            = 'submitted',
      score             = p_score,
      max_score         = p_max_score,
      is_graded         = true,
      submitted_at      = _now
  WHERE id = _sub.id;

  INSERT INTO public.grades (exam_id, student_id, tenant_id, submission_id, score, max_score)
  VALUES (p_exam_id, p_student_id, _exam.tenant_id, _sub.id, p_score, p_max_score)
  ON CONFLICT (student_id, exam_id) DO UPDATE
    SET score = EXCLUDED.score, max_score = EXCLUDED.max_score,
        submission_id = EXCLUDED.submission_id, graded_at = now();

  RETURN jsonb_build_object('score', p_score, 'max_score', p_max_score);
END $$;

-- Backfill: max_score = sum of the exam's question points where missing.
UPDATE public.exam_submissions s
SET max_score = q.total
FROM (
  SELECT e.id AS exam_id,
         COALESCE(SUM((elem->>'points')::numeric), 0) AS total
  FROM public.exams e
  CROSS JOIN LATERAL jsonb_array_elements(e.questions) elem
  GROUP BY e.id
) q
WHERE q.exam_id = s.exam_id
  AND s.max_score IS NULL;
