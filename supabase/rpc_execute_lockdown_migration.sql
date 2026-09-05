-- ============================================================
-- EduQuest — RPC hardening + EXECUTE lockdown  (security_audit_2026-09-04, part 2)
--
-- PROBLEM
-- Every SECURITY DEFINER function in `public` had the Supabase default grant
-- (EXECUTE to PUBLIC + anon + authenticated). PostgREST exposes them at
-- /rest/v1/rpc/<name>, so ANY holder of the public anon key — including an
-- unauthenticated attacker — could call them directly, BYPASSING the
-- authorization done in the Next.js route handlers. RLS does not help:
-- SECURITY DEFINER runs as the owner and ignores RLS.
--
-- Headline: finalize_exam_submission(..., p_score, ...) trusted the caller's
-- score and is the ONLY write path to exam_submissions.score / grades (there is
-- no user UPDATE policy on exam_submissions). A student could POST a fabricated
-- score straight to the RPC → GRADE FORGERY. [CRITICAL]
--
-- DEFENSE-IN-DEPTH FIX (two independent layers, per industry practice):
--   Layer 1 — the security-critical value is computed INSIDE the trust boundary:
--     finalize_exam_submission now RECOMPUTES the score in-DB from the stored
--     correct_answer and IGNORES p_score. Forgery is impossible regardless of
--     who calls it or how the grants are configured.
--   Layer 2 — least privilege: EXECUTE is revoked from PUBLIC/anon/authenticated
--     on server-only RPCs (the route handlers call them via the service-role
--     client); functions that need the user session keep `authenticated` but gain
--     an in-function authorization guard.
--
-- ── APPLY ORDER ─────────────────────────────────────────────────────────────
-- PART A is BACKWARD-COMPATIBLE with the code currently in production and may be
--        applied at ANY time. It closes the CRITICAL grade-forgery hole
--        immediately (the recompute ignores p_score, so the old and new route
--        both produce the same result) and locks down the RPCs that the app
--        already calls via the service-role client.
-- PART B REVOKEs EXECUTE on finalize / start / append. Apply it ONLY AFTER the
--        code that routes these three through the service-role client is
--        deployed (src/app/api/exam/{submit,start} + proctor/{events,analyze,
--        evidence}). Running PART B before that deploy would break live exam
--        submit/start/proctoring (old code calls them as `authenticated`).
--
-- STATUS: both parts applied to the production project (ubngpsdzjoeqfxfbdtxc)
-- on 2026-09-05. Verified afterwards by impersonating `anon` and attempting the
-- original forged-score call — denied at the grant layer.
--
-- Idempotent & re-runnable.
-- ============================================================


-- ════════════════════════════════════════════════════════════════════════════
--  PART A — safe to apply now (backward-compatible)
-- ════════════════════════════════════════════════════════════════════════════

-- ── A1. Authoritative in-DB grading (kills grade forgery) ────────────────────
-- p_score / p_max_score are IGNORED and kept only so the existing route
-- signature keeps resolving. The score is recomputed from the stored
-- correct_answer, mirroring the app's compare (trim + lowercase, sum of points).
-- Questions with no correct_answer (e.g. essays) score 0 here and are regraded
-- by the teacher through the normal grading flow — unchanged behavior.
CREATE OR REPLACE FUNCTION public.finalize_exam_submission(
  p_exam_id uuid, p_student_id uuid, p_answers jsonb, p_client_events jsonb,
  p_score numeric, p_max_score numeric)
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


-- ── A2. get_tenant_archive — gate by role + tenant (kept pure SQL) ───────────
-- Unauthorized or cross-tenant callers get zero rows; super_admin may read any
-- tenant, university_admin only its own. Gate applied to BOTH UNION branches.
CREATE OR REPLACE FUNCTION public.get_tenant_archive(p_tenant_id uuid, p_year integer DEFAULT NULL::integer)
 RETURNS TABLE(kind text, id uuid, title text, teacher_id uuid, teacher_name text, created_at timestamp with time zone, deleted_at timestamp with time zone, is_archived boolean, student_count bigint, lesson_count bigint, exam_count bigint, submission_count bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    'group'::text, g.id, g.name, g.teacher_id, u.full_name,
    g.created_at, g.deleted_at, (g.deleted_at IS NOT NULL),
    (SELECT count(*) FROM group_students gs WHERE gs.group_id = g.id),
    (SELECT count(*) FROM lessons l WHERE l.group_id = g.id),
    (SELECT count(*) FROM exams e WHERE e.group_id = g.id),
    (SELECT count(*) FROM exam_submissions s
       JOIN exams e ON e.id = s.exam_id WHERE e.group_id = g.id)
  FROM groups g
  LEFT JOIN users u ON u.id = g.teacher_id
  WHERE g.tenant_id = p_tenant_id
    AND (p_year IS NULL OR EXTRACT(YEAR FROM g.created_at) = p_year)
    AND ( public.current_user_role() = 'super_admin'
          OR (public.current_user_role() = 'university_admin'
              AND public.current_tenant_id() = p_tenant_id) )

  UNION ALL

  SELECT
    'course'::text, c.id, c.title, c.teacher_id, u.full_name,
    c.created_at, c.deleted_at, (c.deleted_at IS NOT NULL),
    (SELECT count(*) FROM course_enrollments ce WHERE ce.course_id = c.id),
    0,
    (SELECT count(*) FROM exams e WHERE e.course_id = c.id),
    (SELECT count(*) FROM exam_submissions s
       JOIN exams e ON e.id = s.exam_id WHERE e.course_id = c.id)
  FROM courses c
  LEFT JOIN users u ON u.id = c.teacher_id
  WHERE c.tenant_id = p_tenant_id
    AND (p_year IS NULL OR EXTRACT(YEAR FROM c.created_at) = p_year)
    AND ( public.current_user_role() = 'super_admin'
          OR (public.current_user_role() = 'university_admin'
              AND public.current_tenant_id() = p_tenant_id) )

  ORDER BY created_at DESC;
$function$;


-- ── A3. get_course_progress — gate by identity + pin pg_temp ─────────────────
CREATE OR REPLACE FUNCTION public.get_course_progress(p_course_id uuid, p_student_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  total_items     INTEGER;
  completed_items INTEGER;
BEGIN
  IF NOT ( auth.uid() = p_student_id
           OR public.current_user_role() IN ('teacher','university_admin','super_admin') ) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT COUNT(*) INTO total_items
  FROM unit_items ui
  JOIN course_units cu ON cu.id = ui.unit_id
  JOIN course_levels cl ON cl.id = cu.level_id
  WHERE cl.course_id = p_course_id
    AND ui.is_published = TRUE;

  SELECT COUNT(*) INTO completed_items
  FROM student_progress sp
  JOIN unit_items ui ON ui.id = sp.unit_item_id
  JOIN course_units cu ON cu.id = ui.unit_id
  JOIN course_levels cl ON cl.id = cu.level_id
  WHERE cl.course_id = p_course_id
    AND sp.student_id = p_student_id;

  RETURN json_build_object(
    'total',     total_items,
    'completed', completed_items,
    'percent',   CASE WHEN total_items = 0 THEN 0
                      ELSE ROUND((completed_items::NUMERIC / total_items) * 100)
                 END
  );
END;
$function$;


-- ── A4. Revoke EXECUTE on RPCs the app ALREADY calls via service-role ────────
-- (delete-entity, admin/restore, accept-invitation, join page, invitations,
--  rate-limit, cron cleanup). Safe now — production never calls these as anon
--  or authenticated.
DO $$
DECLARE
  fn text;
  already_admin text[] := ARRAY[
    'soft_delete_entity(text, uuid, uuid, uuid)',
    'restore_entity(text, uuid, uuid)',
    'accept_invitation(text, uuid, text)',
    'get_invitation_by_token(text)',
    'check_email_in_auth(text)',
    'check_rate_limit(text, integer, integer)',
    'cleanup_expired_invitations()'
  ];
BEGIN
  FOREACH fn IN ARRAY already_admin LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END $$;

-- ── A5. Drop the anon grant on user-session RPCs (they need a signed-in user) ─
REVOKE ALL ON FUNCTION public.get_student_exams()               FROM anon;
REVOKE ALL ON FUNCTION public.get_tenant_archive(uuid, integer) FROM anon, PUBLIC;
REVOKE ALL ON FUNCTION public.get_course_progress(uuid, uuid)   FROM anon, PUBLIC;


-- ════════════════════════════════════════════════════════════════════════════
--  PART B — requires the service-role-client code to be deployed FIRST
--
--  Applied to production 2026-09-05, after merge commit 3c4c9f9 (which routes
--  finalize / start / append through the service-role client) finished
--  deploying. On a FRESH environment this is safe to run together with PART A,
--  because the code that ships with this repo already calls all three RPCs via
--  the service-role client. Only an environment still running pre-3c4c9f9 code
--  must hold this back — there, these RPCs are still called as `authenticated`
--  and revoking would break exam start/submit/proctoring.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  fn text;
  server_only text[] := ARRAY[
    'finalize_exam_submission(uuid, uuid, jsonb, jsonb, numeric, numeric)',
    'start_exam_attempt(uuid, uuid, uuid)',
    'append_proctoring_events(uuid, uuid, jsonb)'
  ];
BEGIN
  FOREACH fn IN ARRAY server_only LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END $$;


-- ════════════════════════════════════════════════════════════════════════════
--  VERIFICATION — expected end state (run after applying)
-- ════════════════════════════════════════════════════════════════════════════
-- select p.proname,
--        has_function_privilege('anon',          p.oid, 'EXECUTE') as anon_can,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can,
--        has_function_privilege('service_role',  p.oid, 'EXECUTE') as service_role_can
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname in (
--   'finalize_exam_submission','start_exam_attempt','append_proctoring_events',
--   'soft_delete_entity','restore_entity','accept_invitation','get_invitation_by_token',
--   'check_rate_limit','check_email_in_auth','cleanup_expired_invitations',
--   'get_student_exams','get_tenant_archive','get_course_progress');
--
-- Expected: anon_can = false for ALL of them; authenticated_can = true ONLY for
-- get_student_exams / get_tenant_archive / get_course_progress (each of which
-- carries its own in-function authorization guard); service_role_can = true for all.
