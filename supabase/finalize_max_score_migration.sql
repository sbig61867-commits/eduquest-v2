-- ============================================================
-- finalize_exam_submission: also persist score + max_score on the
-- exam_submissions row itself. All student/teacher UIs read from
-- exam_submissions; max_score was only written to `grades`, leaving
-- NULL max_score → "70/1 (7000%)" displays.
-- Also backfills max_score on existing submitted rows.
-- Idempotent / re-runnable.
-- ============================================================

-- 2026-09-27: this block previously re-created the function TRUSTING p_score
-- / p_max_score, which would silently undo the authoritative in-DB grading
-- from rpc_execute_lockdown_migration.sql if this file were re-run. Replaced
-- with the live definition verbatim (grades in-DB, ignores p_score, and
-- still persists score + max_score on the submission row), so re-running
-- this file is a no-op for the function.
CREATE OR REPLACE FUNCTION public.finalize_exam_submission(p_exam_id uuid, p_student_id uuid, p_answers jsonb, p_client_events jsonb, p_score numeric, p_max_score numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _exam     RECORD;
  _sub      RECORD;
  _now      TIMESTAMPTZ := now();
  _deadline TIMESTAMPTZ;
  _q        jsonb;
  _pts      numeric;
  _score    numeric := 0;
  _max      numeric := 0;
BEGIN
  SELECT duration_minutes, starts_at, ends_at, tenant_id, questions INTO _exam
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

  -- Authoritative server-side grading (never trusts p_score).
  FOR _q IN SELECT * FROM jsonb_array_elements(COALESCE(_exam.questions, '[]'::jsonb))
  LOOP
    _pts := COALESCE((_q->>'points')::numeric, 0);
    _max := _max + _pts;
    IF (_q->>'correct_answer') IS NOT NULL
       AND lower(btrim(COALESCE(p_answers->>(_q->>'id'), ''), E' \t\n\r'))
           = lower(btrim(_q->>'correct_answer', E' \t\n\r'))
    THEN
      _score := _score + _pts;
    END IF;
  END LOOP;

  UPDATE public.exam_submissions
  SET answers           = p_answers,
      proctoring_events = COALESCE(_sub.proctoring_events, '[]'::jsonb) || COALESCE(p_client_events, '[]'::jsonb),
      status            = 'submitted',
      score             = _score,
      max_score         = _max,
      is_graded         = true,
      submitted_at      = _now
  WHERE id = _sub.id;

  INSERT INTO public.grades (exam_id, student_id, tenant_id, submission_id, score, max_score)
  VALUES (p_exam_id, p_student_id, _exam.tenant_id, _sub.id, _score, _max)
  ON CONFLICT (student_id, exam_id) DO UPDATE
    SET score = EXCLUDED.score, max_score = EXCLUDED.max_score,
        submission_id = EXCLUDED.submission_id, graded_at = now();

  RETURN jsonb_build_object('score', _score, 'max_score', _max);
END $function$;

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
