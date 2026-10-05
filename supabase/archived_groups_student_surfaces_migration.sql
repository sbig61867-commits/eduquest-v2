-- Archived groups — student surfaces (Option A, owner's decision 2026-10-05).
--
-- groups.is_active = false hides the group and its operational content from students; membership, records,
-- grades and in-progress attempts are kept, and restoring (is_active = true) brings everything back. Access is
-- NOT revoked: no RLS change, current_student_group_ids / start_exam_attempt / get_student_exam_list unchanged.
--
-- Three functions, one predicate each — every other character (signature, SECURITY DEFINER / INVOKER,
-- volatility, search_path, body) is the live definition as read 2026-10-05:
--   get_student_schedule()       + AND g.is_active = true                     (live prosrc md5 a028b21c…)
--   get_student_announcements()  group audience: the targeted group must be active; an announcement aimed at
--                                an active and an archived group still reaches the active group's members
--                                                                             (live prosrc md5 9f1fa1f0…)
--   get_my_notifications()       student lessons section only: LEFT JOIN groups → JOIN … AND gr.is_active
--                                (exams already come from get_student_exam_list; grades are records, unchanged)
--                                                                             (live prosrc md5 a2143e2c…)
-- CREATE OR REPLACE keeps the existing grants. Idempotent.
-- Rollback: supabase/archived_groups_student_surfaces_rollback.sql (the exact live definitions).

CREATE OR REPLACE FUNCTION public.get_student_schedule()
 RETURNS TABLE(slot_id uuid, group_id uuid, group_name text, day_of_week smallint, start_time time without time zone, end_time time without time zone, title text, teacher_name text, location text, note text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT sl.id, s.group_id, g.name, sl.day_of_week, sl.start_time, sl.end_time,
         sl.title, t.full_name, sl.location, sl.note
  FROM schedule_slots sl
  JOIN schedules s  ON s.id = sl.schedule_id
  JOIN groups    g  ON g.id = s.group_id
  LEFT JOIN users t ON t.id = sl.teacher_id
  WHERE auth.uid() IS NOT NULL
    AND s.kind = 'group'
    AND s.is_published = true
    AND g.is_active = true
    AND s.tenant_id = (SELECT u.tenant_id FROM users u WHERE u.id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM group_students gs
      WHERE gs.group_id = s.group_id AND gs.student_id = auth.uid()
    )
  ORDER BY sl.day_of_week, sl.start_time;
$function$;

CREATE OR REPLACE FUNCTION public.get_student_announcements()
 RETURNS TABLE(id uuid, title text, body text, image_url text, link_url text, cta_label text, created_at timestamp with time zone, ends_at timestamp with time zone, collect_interest boolean, pinned boolean, interested boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH me AS (
    SELECT
      u.id,
      u.tenant_id,
      u.is_university_student,
      -- A centre student is anyone flagged as non-university OR enrolled in at
      -- least one course. Dual-enrolled students match both populations.
      (u.is_university_student = false
       OR EXISTS (SELECT 1 FROM public.course_enrollments ce WHERE ce.student_id = u.id)
      ) AS is_center_student
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role = 'student'
  )
  SELECT a.id, a.title, a.body, a.image_url, a.link_url, a.cta_label, a.created_at, a.ends_at,
         a.collect_interest,
         a.pinned,
         EXISTS (
           SELECT 1 FROM public.announcement_events e
           WHERE e.announcement_id = a.id AND e.student_id = me.id AND e.kind = 'interest'
         ) AS interested
  FROM public.announcements a
  CROSS JOIN me
  WHERE a.is_published = true
    AND a.tenant_id = me.tenant_id
    AND (a.starts_at IS NULL OR a.starts_at <= now())
    AND (a.ends_at   IS NULL OR a.ends_at   >= now())
    -- Author lacked `announce_to_university`: centre students only, whatever
    -- the audience says.
    AND (a.center_students_only = false OR me.is_center_student)
    AND CASE a.audience
          WHEN 'all'        THEN true
          WHEN 'university' THEN me.is_university_student
          WHEN 'center'     THEN me.is_center_student
          ELSE EXISTS (
            SELECT 1
            FROM public.announcement_groups ag
            JOIN public.group_students gs ON gs.group_id = ag.group_id
            JOIN public.groups g ON g.id = ag.group_id AND g.is_active = true
            WHERE ag.announcement_id = a.id
              AND gs.student_id = me.id
          )
        END
  ORDER BY a.pinned DESC, a.created_at DESC
  LIMIT 20;
$function$;

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
        JOIN public.groups gr ON gr.id = les.group_id AND gr.is_active = true
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
