-- ============================================================
-- Migration: fix start_exam_attempt (every exam start failed)
-- Idempotent, re-runnable. Apply in the Supabase SQL Editor.
-- ============================================================
--
-- exam_draft_migration.sql (2026-09-17) replaced the R-1 version of
-- start_exam_attempt with one that was broken three ways:
--
--   1. It authorized with auth.uid(). The function is service_role-only
--      (rpc_execute_lockdown) and /api/exam/start calls it with the
--      service-role client, which carries no end-user JWT — auth.uid() is
--      NULL, so every call raised TENANT_MISMATCH. No student could start
--      any exam.
--   2. Its INSERT wrote grading_status = 'in_progress', which the
--      exam_submissions_grading_status_check constraint rejects
--      (pending | reviewing | published).
--   3. It never set `status`, whose column default is 'submitted', so even a
--      successful insert would have made finalize_exam_submission refuse the
--      attempt as ALREADY_SUBMITTED; and it tested grading_status (never
--      'submitted') instead of status for the already-submitted guard.
--
-- This restores the R-1 checks (see r1_defense_in_depth_service_role_rpcs_
-- migration.sql: re-derive every fact from the tables, trust no caller
-- value) and keeps the one thing exam_draft added: returning answers_draft on
-- resume so a refresh or a second device restores the student's answers.

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
  SELECT tenant_id, group_id, is_published, starts_at, ends_at, deleted_at
    INTO _exam
    FROM public.exams
   WHERE id = p_exam_id;
  IF NOT FOUND OR NOT _exam.is_published OR _exam.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'EXAM_NOT_FOUND';
  END IF;

  -- The caller's tenant must be the exam's real tenant, and so must the
  -- student's own row (never the caller-supplied value alone).
  IF p_tenant_id IS DISTINCT FROM _exam.tenant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH';
  END IF;
  SELECT tenant_id INTO _student_tenant FROM public.users WHERE id = p_student_id;
  IF _student_tenant IS DISTINCT FROM _exam.tenant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.group_students
     WHERE group_id = _exam.group_id AND student_id = p_student_id
  ) THEN
    RAISE EXCEPTION 'NOT_ENROLLED';
  END IF;

  IF _exam.starts_at IS NOT NULL AND now() < _exam.starts_at THEN
    RAISE EXCEPTION 'EXAM_NOT_OPEN';
  END IF;
  IF _exam.ends_at IS NOT NULL AND now() > _exam.ends_at THEN
    RAISE EXCEPTION 'EXAM_CLOSED';
  END IF;

  -- Idempotent: a second call resumes the same attempt (same start time).
  -- ON CONFLICT covers two tabs racing on the UNIQUE (exam_id, student_id).
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

-- Grant matrix unchanged (rpc_execute_lockdown / R-1): service_role only.
REVOKE ALL ON FUNCTION public.start_exam_attempt(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_exam_attempt(uuid, uuid, uuid) TO service_role;

-- Verify
SELECT has_function_privilege('anon',          'public.start_exam_attempt(uuid,uuid,uuid)', 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', 'public.start_exam_attempt(uuid,uuid,uuid)', 'EXECUTE') AS authenticated_can_execute,
       has_function_privilege('service_role',  'public.start_exam_attempt(uuid,uuid,uuid)', 'EXECUTE') AS service_role_can_execute;
