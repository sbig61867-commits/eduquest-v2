-- =============================================================================
-- Exam logic audit 2026-09-30 — finalize_exam_submission fixes.
-- =============================================================================
-- B1 [High] A blank answer earned an essay's full marks. Essays are stored with
--    correct_answer = '' (generate-homework-from-file writes "" explicitly,
--    /api/exams/individual defaults to ''), and the grader awarded points on
--    lower(btrim(answer)) = lower(btrim(correct_answer)) — '' = '' for every
--    unanswered essay. Live 2026-09-30: wrong MCQ + both essays blank = 10/12;
--    correct MCQ + written essays = 2/12. Now a question scores automatically
--    only when it is auto-gradable — type mcq / true_false, exactly the
--    teacher results screen's isAutoQ (a row with no type, from before types
--    existed, still counts) — AND its key is non-empty. Everything else waits
--    for the teacher (/api/homework/submissions PATCH), as the UI already
--    assumed.
--
-- B2 [High] A student who started before exams.ends_at lost the whole attempt
--    when the window closed mid-exam: the hand-in was refused (EXAM_CLOSED)
--    with no grace, while the duration check allows 30 s. The page now counts
--    down to min(duration, ends_at) (exam-taker.tsx); the same 30 s grace here
--    absorbs the auto-submit's network latency. Starting after ends_at is still
--    refused by start_exam_attempt, so the grace cannot open a closed exam.
--
-- Body = the live definition read 2026-09-30, unchanged apart from those two
-- conditions. Service-role only (never auth.uid()); grants re-asserted.
-- Regression check: supabase/tests/exam_grading_check.sql.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.finalize_exam_submission(
  p_exam_id uuid, p_student_id uuid, p_answers jsonb, p_client_events jsonb,
  p_score numeric, p_max_score numeric
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _exam     RECORD;
  _sub      RECORD;
  _now      TIMESTAMPTZ := now();
  _deadline TIMESTAMPTZ;
  _q        jsonb;
  _pts      numeric;
  _key      text;
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
  -- B2: same 30 s grace as the duration check below.
  IF _exam.ends_at IS NOT NULL AND _now > _exam.ends_at + interval '30 seconds' THEN
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
    _key := lower(btrim(COALESCE(_q->>'correct_answer', ''), E' \t\n\r'));
    -- B1: only auto-gradable questions with a real key score here.
    IF COALESCE(_q->>'type', 'mcq') IN ('mcq', 'true_false')
       AND _key <> ''
       AND lower(btrim(COALESCE(p_answers->>(_q->>'id'), ''), E' \t\n\r')) = _key
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
END
$$;

REVOKE ALL ON FUNCTION public.finalize_exam_submission(uuid, uuid, jsonb, jsonb, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_exam_submission(uuid, uuid, jsonb, jsonb, numeric, numeric) TO service_role;
