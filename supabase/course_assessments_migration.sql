-- ============================================================
-- Migration: course quizzes and tasks run on the exam engine
-- Idempotent, re-runnable. Apply in the Supabase SQL Editor.
-- Apply AFTER fix_start_exam_attempt_migration.sql.
-- ============================================================
--
-- An exam row belongs to exactly one group OR one course (CHECK
-- exam_must_belong_to_group_or_course), and get_student_exams() already
-- serves course exams to the course's enrolled students. But the two
-- service-role RPCs that act on an attempt only knew the group roster, so a
-- course quiz could be listed and never started:
--
--   start_exam_attempt       — raised NOT_ENROLLED for a course exam
--   append_proctoring_events — silently dropped its events
--
-- Both now accept the exam's roster: its group's members, or, for a course
-- exam, the students enrolled in that course (src/lib/exam-roster.ts is the
-- same rule on the route side). Nothing else changes: every fact is still
-- re-derived from the tables (R-1), never from a caller value, and neither
-- function uses auth.uid() — it is NULL under the service-role client.
-- finalize_exam_submission needs no change: it only accepts an attempt that
-- start_exam_attempt created.

CREATE OR REPLACE FUNCTION public.start_exam_attempt(p_exam_id uuid, p_student_id uuid, p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _exam           RECORD;
  _row            RECORD;
  _student_tenant uuid;
  _inserted       integer;
BEGIN
  SELECT tenant_id, group_id, course_id, is_published, starts_at, ends_at, deleted_at
    INTO _exam
    FROM public.exams
   WHERE id = p_exam_id;
  IF NOT FOUND OR NOT _exam.is_published OR _exam.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'EXAM_NOT_FOUND';
  END IF;

  IF p_tenant_id IS DISTINCT FROM _exam.tenant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH';
  END IF;
  SELECT tenant_id INTO _student_tenant FROM public.users WHERE id = p_student_id;
  IF _student_tenant IS DISTINCT FROM _exam.tenant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH';
  END IF;

  IF NOT (
    (_exam.group_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.group_students
        WHERE group_id = _exam.group_id AND student_id = p_student_id))
    OR
    (_exam.course_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.course_enrollments
        WHERE course_id = _exam.course_id AND student_id = p_student_id))
  ) THEN
    RAISE EXCEPTION 'NOT_ENROLLED';
  END IF;

  IF _exam.starts_at IS NOT NULL AND now() < _exam.starts_at THEN
    RAISE EXCEPTION 'EXAM_NOT_OPEN';
  END IF;
  IF _exam.ends_at IS NOT NULL AND now() > _exam.ends_at THEN
    RAISE EXCEPTION 'EXAM_CLOSED';
  END IF;

  INSERT INTO public.exam_submissions
         (exam_id, student_id, tenant_id, answers, proctoring_events, status, started_at)
  VALUES (p_exam_id, p_student_id, _exam.tenant_id, '{}'::jsonb, '[]'::jsonb, 'in_progress', now())
  ON CONFLICT (exam_id, student_id) DO NOTHING;
  GET DIAGNOSTICS _inserted = ROW_COUNT;

  SELECT status, started_at, answers_draft
    INTO _row
    FROM public.exam_submissions
   WHERE exam_id = p_exam_id AND student_id = p_student_id;

  IF _row.status = 'submitted' THEN
    RAISE EXCEPTION 'ALREADY_SUBMITTED';
  END IF;

  RETURN jsonb_build_object(
    'started_at',    _row.started_at,
    'resumed',       _inserted = 0,
    'answers_draft', COALESCE(_row.answers_draft, '{}'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.append_proctoring_events(p_exam_id uuid, p_student_id uuid, p_events jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _exam RECORD;
BEGIN
  SELECT group_id, course_id INTO _exam FROM public.exams WHERE id = p_exam_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT (
    (_exam.group_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.group_students
        WHERE group_id = _exam.group_id AND student_id = p_student_id))
    OR
    (_exam.course_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.course_enrollments
        WHERE course_id = _exam.course_id AND student_id = p_student_id))
  ) THEN
    RETURN;
  END IF;

  UPDATE public.exam_submissions
     SET proctoring_events = COALESCE(proctoring_events, '[]'::jsonb) || COALESCE(p_events, '[]'::jsonb)
   WHERE exam_id = p_exam_id AND student_id = p_student_id AND status = 'in_progress';
END $$;

-- Grant matrix unchanged (rpc_execute_lockdown / R-1): service_role only.
REVOKE ALL ON FUNCTION public.start_exam_attempt(uuid, uuid, uuid)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.append_proctoring_events(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_exam_attempt(uuid, uuid, uuid)       TO service_role;
GRANT EXECUTE ON FUNCTION public.append_proctoring_events(uuid, uuid, jsonb) TO service_role;

-- Verify
SELECT p.proname,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role_can_execute
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('start_exam_attempt', 'append_proctoring_events');
