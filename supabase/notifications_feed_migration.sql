-- P-08 — the header bell's feed in ONE read: public.get_my_notifications().
--
-- /api/notifications is polled by every open tab (NotificationBell: 2.5 s after load, then every 5 min while
-- visible, and on opening the bell). Per poll it ran, through the user's session:
--   student           memberships → lessons (8) + get_student_exam_list() (EVERY row, ~64 KB at 100 exams, to use
--                     8 titles and the type / manual flag of ≤ 20 grades) + scored submissions (20)  = 4 queries;
--   teacher           EVERY exam of the teacher (unbounded) → submissions .in(exam ids) (an id list that grows with
--                     every exam: ~400 ids already break the request) ordered by date, 15            = 2 queries;
--   university_admin  newest users (15) + AI alerts (6);  super_admin  messages (10) + institutions (8) + alerts (6).
-- This function returns the same rows in one call, as one JSON object of sections; the route still builds the
-- items (translated titles) and still applies the score-visibility rule (isScoreVisible, unchanged — the
-- function only returns the fields it needs), so no notification rule moves into SQL.
--
-- SECURITY INVOKER: every read runs as the caller, through the same RLS policies the per-table reads used, so the
-- rows are the same rows. Role / user / institution come from auth.uid() and the existing current_user_role() /
-- current_tenant_id() helpers — nothing is taken from the caller. A role without a section (centre manager) gets {}.
-- Same bounds as before (8 / 8 / 20 / 15 / 15 / 10 / 8 / 6); no id list in any request.
--
-- Idempotent (CREATE OR REPLACE). Changes no table, policy, index or existing function.
-- Rollback:
--   DROP FUNCTION IF EXISTS public.get_my_notifications();

CREATE OR REPLACE FUNCTION public.get_my_notifications()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid    uuid := (SELECT auth.uid());
  v_role   text := (SELECT public.current_user_role());
  v_tenant uuid := (SELECT public.current_tenant_id());
BEGIN
  IF v_uid IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  IF v_role = 'student' THEN
    RETURN (
      WITH list AS (
        -- The student's exam list, in its own order (created_at DESC), read once inside the database.
        SELECT l.id, l.title, l.created_at, l.type, l.has_manual_questions, l.ordinality AS ord
        FROM public.get_student_exam_list() WITH ORDINALITY AS l
      ),
      lessons AS (
        SELECT les.id, les.title, les.created_at, gr.name AS group_name,
               row_number() OVER (ORDER BY les.created_at DESC) AS ord
        FROM public.lessons les
        LEFT JOIN public.groups gr ON gr.id = les.group_id
        WHERE les.group_id IN (SELECT gs.group_id FROM public.group_students gs WHERE gs.student_id = v_uid)
          AND les.is_published = true AND les.deleted_at IS NULL
        ORDER BY les.created_at DESC
        LIMIT 8
      ),
      grades AS (
        SELECT s.id, s.exam_id, s.score, s.max_score, s.submitted_at, s.grading_status,
               row_number() OVER (ORDER BY s.submitted_at DESC) AS ord
        FROM public.exam_submissions s
        WHERE s.student_id = v_uid AND s.score IS NOT NULL
        ORDER BY s.submitted_at DESC
        LIMIT 20
      )
      SELECT jsonb_build_object(
        'lessons', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'title', title, 'created_at', created_at, 'group_name', group_name) ORDER BY ord) FROM lessons), '[]'::jsonb),
        'exams', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'title', title, 'created_at', created_at) ORDER BY ord)
                            FROM (SELECT * FROM list ORDER BY ord LIMIT 8) first8), '[]'::jsonb),
        'grades', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'id', g.id, 'exam_id', g.exam_id, 'score', g.score, 'max_score', g.max_score,
                    'submitted_at', g.submitted_at, 'grading_status', g.grading_status,
                    'exam_listed', l.id IS NOT NULL, 'exam_title', l.title, 'exam_type', l.type,
                    'exam_has_manual_questions', l.has_manual_questions) ORDER BY g.ord)
                  FROM grades g LEFT JOIN list l ON l.id = g.exam_id), '[]'::jsonb)
      )
    );
  END IF;

  IF v_role = 'teacher' THEN
    RETURN (
      WITH recent AS (
        -- Submissions to the teacher's live exams, joined in the database (no exam-id list).
        SELECT s.id, s.exam_id, s.submitted_at, u.full_name AS student_name, e.title AS exam_title, e.type AS exam_type,
               row_number() OVER (ORDER BY s.submitted_at DESC) AS ord
        FROM public.exam_submissions s
        JOIN public.exams e ON e.id = s.exam_id
        LEFT JOIN public.users u ON u.id = s.student_id
        WHERE e.teacher_id = v_uid AND e.deleted_at IS NULL
        ORDER BY s.submitted_at DESC
        LIMIT 15
      )
      SELECT jsonb_build_object(
        'submissions', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'exam_id', exam_id, 'submitted_at', submitted_at,
                         'student_name', student_name, 'exam_title', exam_title, 'exam_type', exam_type) ORDER BY ord) FROM recent), '[]'::jsonb)
      )
    );
  END IF;

  IF v_role = 'university_admin' THEN
    RETURN (
      WITH people AS (
        SELECT u.id, u.full_name, u.role, u.created_at, row_number() OVER (ORDER BY u.created_at DESC) AS ord
        FROM public.users u
        WHERE u.tenant_id = v_tenant AND u.role IN ('teacher', 'student')
        ORDER BY u.created_at DESC
        LIMIT 15
      ),
      alerts AS (
        SELECT a.id, a.level, a.metric, a.created_at, t.name AS tenant_name, t.ai_alert_threshold_pct,
               row_number() OVER (ORDER BY a.created_at DESC) AS ord
        FROM public.ai_usage_alerts a
        LEFT JOIN public.tenants t ON t.id = a.tenant_id
        ORDER BY a.created_at DESC
        LIMIT 6
      )
      SELECT jsonb_build_object(
        'users', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'full_name', full_name, 'role', role, 'created_at', created_at) ORDER BY ord) FROM people), '[]'::jsonb),
        'ai_alerts', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'level', level, 'metric', metric, 'created_at', created_at,
                       'tenant_name', tenant_name, 'alert_threshold_pct', ai_alert_threshold_pct) ORDER BY ord) FROM alerts), '[]'::jsonb)
      )
    );
  END IF;

  IF v_role = 'super_admin' THEN
    RETURN (
      WITH msgs AS (
        SELECT m.id, m.name, m.message, m.created_at, m.is_read, row_number() OVER (ORDER BY m.created_at DESC) AS ord
        FROM public.contact_messages m
        ORDER BY m.created_at DESC
        LIMIT 10
      ),
      insts AS (
        SELECT t.id, t.name, t.created_at, row_number() OVER (ORDER BY t.created_at DESC) AS ord
        FROM public.tenants t
        ORDER BY t.created_at DESC
        LIMIT 8
      ),
      alerts AS (
        SELECT a.id, a.level, a.metric, a.created_at, t.name AS tenant_name, t.ai_alert_threshold_pct,
               row_number() OVER (ORDER BY a.created_at DESC) AS ord
        FROM public.ai_usage_alerts a
        LEFT JOIN public.tenants t ON t.id = a.tenant_id
        ORDER BY a.created_at DESC
        LIMIT 6
      )
      SELECT jsonb_build_object(
        'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'message', message, 'created_at', created_at, 'is_read', is_read) ORDER BY ord) FROM msgs), '[]'::jsonb),
        'tenants', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'created_at', created_at) ORDER BY ord) FROM insts), '[]'::jsonb),
        'ai_alerts', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'level', level, 'metric', metric, 'created_at', created_at,
                       'tenant_name', tenant_name, 'alert_threshold_pct', ai_alert_threshold_pct) ORDER BY ord) FROM alerts), '[]'::jsonb)
      )
    );
  END IF;

  RETURN '{}'::jsonb;
END
$fn$;

REVOKE ALL ON FUNCTION public.get_my_notifications() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_notifications() TO authenticated;
