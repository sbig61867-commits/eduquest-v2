-- ============================================================
-- EduQuest — Comprehensive search_path fix for SECURITY DEFINER functions
-- Run on the live DB (Supabase SQL Editor). Safe to re-run (CREATE OR REPLACE).
--
-- ROOT CAUSE (same class of bug as fix_helper_search_path.sql, wider scope):
-- SECURITY DEFINER functions inherit the CALLER's search_path unless SET
-- search_path is pinned. Under PostgREST the `authenticated` role runs with a
-- restricted search_path, so unqualified table references (`FROM exams`,
-- `FROM rate_limits`, ...) fail with 42P01 "relation does not exist", the
-- function raises/returns unexpectedly, and callers see it as a silent 403
-- or a broken RPC — even though the same SQL works fine in the SQL Editor.
--
-- This migration covers the SECURITY DEFINER functions that were found
-- WITHOUT a pinned search_path (fix_helper_search_path.sql already covers
-- current_user_role/current_tenant_id — do not duplicate here):
--   - check_rate_limit, start_exam_attempt, append_proctoring_events,
--     finalize_exam_submission   (platform_hardening_migration.sql)
--   - cleanup_expired_invitations   (cron_cleanup.sql)
--   - get_invitation_by_token   (fix_rpc_error_codes.sql)
--
-- Functions that already pin search_path correctly (handle_new_user,
-- sync_user_claims via fix_auth_flow.sql; check_email_in_auth,
-- accept_invitation, get_course_progress, get_student_exams) are left as-is.
-- ============================================================

-- ── check_rate_limit ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_rate_limit(p_key TEXT, p_limit INT, p_window_secs INT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE _count INT; _reset TIMESTAMPTZ; _now TIMESTAMPTZ := now();
BEGIN
  INSERT INTO public.rate_limits (key, count, reset_at)
  VALUES (p_key, 1, _now + make_interval(secs => p_window_secs))
  ON CONFLICT (key) DO UPDATE
    SET count    = CASE WHEN public.rate_limits.reset_at < _now THEN 1 ELSE public.rate_limits.count + 1 END,
        reset_at = CASE WHEN public.rate_limits.reset_at < _now THEN _now + make_interval(secs => p_window_secs) ELSE public.rate_limits.reset_at END
  RETURNING count, reset_at INTO _count, _reset;
  RETURN jsonb_build_object('allowed', _count <= p_limit, 'remaining', GREATEST(p_limit - _count, 0), 'reset_at', _reset);
END $$;

-- ── start_exam_attempt ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_exam_attempt(p_exam_id UUID, p_student_id UUID, p_tenant_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE _row RECORD;
BEGIN
  SELECT status, started_at INTO _row FROM public.exam_submissions
  WHERE exam_id = p_exam_id AND student_id = p_student_id;
  IF FOUND THEN
    IF _row.status = 'submitted' THEN RAISE EXCEPTION 'ALREADY_SUBMITTED'; END IF;
    RETURN jsonb_build_object('started_at', _row.started_at, 'resumed', true);
  END IF;
  INSERT INTO public.exam_submissions (exam_id, student_id, tenant_id, answers, proctoring_events, status, started_at)
  VALUES (p_exam_id, p_student_id, p_tenant_id, '{}'::jsonb, '[]'::jsonb, 'in_progress', now());
  RETURN jsonb_build_object('started_at', now(), 'resumed', false);
END $$;

-- ── append_proctoring_events ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.append_proctoring_events(p_exam_id UUID, p_student_id UUID, p_events JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.exam_submissions
  SET proctoring_events = COALESCE(proctoring_events, '[]'::jsonb) || COALESCE(p_events, '[]'::jsonb)
  WHERE exam_id = p_exam_id AND student_id = p_student_id AND status = 'in_progress';
END $$;

-- ── finalize_exam_submission ─────────────────────────────────
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
      submitted_at      = _now
  WHERE id = _sub.id;

  INSERT INTO public.grades (exam_id, student_id, tenant_id, submission_id, score, max_score)
  VALUES (p_exam_id, p_student_id, _exam.tenant_id, _sub.id, p_score, p_max_score)
  ON CONFLICT (student_id, exam_id) DO UPDATE
    SET score = EXCLUDED.score, max_score = EXCLUDED.max_score,
        submission_id = EXCLUDED.submission_id, graded_at = now();

  RETURN jsonb_build_object('score', p_score, 'max_score', p_max_score);
END $$;

-- ── cleanup_expired_invitations ──────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_expired_invitations()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.invitations
  WHERE status = 'pending'
    AND expires_at < NOW() - INTERVAL '30 days';
END $$;

-- ── get_invitation_by_token ───────────────────────────────────
-- Restored to the phase1_migration.sql shape (is_public/max_uses/use_count) —
-- the join page's isPublic branch depends on these fields. A prior fix here
-- accidentally regressed it to the older fix_rpc_error_codes.sql shape.
CREATE OR REPLACE FUNCTION public.get_invitation_by_token(p_token TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inv RECORD;
BEGIN
  SELECT
    i.email,
    i.role,
    i.expires_at,
    i.group_id,
    i.is_public,
    i.max_uses,
    i.use_count,
    t.name AS tenant_name
  INTO inv
  FROM public.invitations i
  JOIN public.tenants t ON t.id = i.tenant_id
  WHERE i.token     = p_token
    AND i.status    = 'pending'
    AND i.expires_at > NOW()
    AND (i.max_uses IS NULL OR i.use_count < i.max_uses);

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN json_build_object(
    'email',       inv.email,
    'role',        inv.role,
    'tenant_name', inv.tenant_name,
    'expires_at',  inv.expires_at,
    'is_public',   inv.is_public,
    'max_uses',    inv.max_uses,
    'use_count',   inv.use_count
  );
END $$;
