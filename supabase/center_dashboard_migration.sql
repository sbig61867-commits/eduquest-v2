-- ============================================================
-- center_dashboard_migration.sql — 2026-09-15
-- Idempotent + re-runnable. Apply in the Supabase SQL Editor
-- AFTER attendance_migration.sql (the function reads its tables).
--
-- get_center_dashboard(p_days) — one call returns every aggregate the
-- centre / university dashboard renders, as JSONB.
--
-- Processing & storage:
--   * Computed on demand from the live tables — no new storage, no
--     materialized views, no cron. One round-trip per page load.
--   * Returns AGGREGATES ONLY (counts, rates, averages per group/teacher).
--     No student names, answers or individual grades leave this function —
--     the "numbers, not content" rule from admin_metadata_only_migration.
--   * Tenant comes from public.users by auth.uid(), never from a parameter.
--
-- Access (mirrors src/lib/permissions.ts view_reports):
--   university_admin — allowed unless permissions.view_reports = false
--   center_manager   — only when permissions.view_reports = true
--   anyone else      — raises 42501
-- ============================================================

-- Hot paths for the windowed aggregates.
CREATE INDEX IF NOT EXISTS idx_grades_tenant_graded        ON grades (tenant_id, graded_at DESC);
CREATE INDEX IF NOT EXISTS idx_exam_submissions_tenant_sub ON exam_submissions (tenant_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_progress_tenant     ON student_progress (tenant_id, completed_at DESC);

CREATE OR REPLACE FUNCTION public.get_center_dashboard(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_role   text;
  v_tenant uuid;
  v_perms  jsonb;
  v_days   integer;
  v_from   timestamptz;
  v_people jsonb; v_groups jsonb; v_learning jsonb; v_assess jsonb;
  v_attend jsonb; v_group_rows jsonb; v_teacher_rows jsonb; v_trend jsonb;
  v_sched  jsonb; v_engage jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT u.role, u.tenant_id, COALESCE(u.permissions, '{}'::jsonb)
    INTO v_role, v_tenant, v_perms
  FROM public.users u WHERE u.id = v_uid AND u.is_active = true;

  IF v_tenant IS NULL OR NOT (
       (v_role = 'university_admin' AND COALESCE(v_perms->>'view_reports', 'true') <> 'false')
    OR (v_role = 'center_manager'   AND v_perms->>'view_reports' = 'true')
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_days := LEAST(GREATEST(COALESCE(p_days, 30), 7), 365);
  v_from := now() - make_interval(days => v_days);

  -- ── People ────────────────────────────────────────────────
  SELECT jsonb_build_object(
    'teachers',        count(*) FILTER (WHERE u.role = 'teacher'),
    'active_teachers', count(*) FILTER (WHERE u.role = 'teacher' AND u.is_active),
    'students',        count(*) FILTER (WHERE u.role = 'student'),
    'active_students', count(*) FILTER (WHERE u.role = 'student' AND u.is_active),
    'new_students',    count(*) FILTER (WHERE u.role = 'student' AND u.created_at >= v_from),
    'students_without_group', count(*) FILTER (
      WHERE u.role = 'student' AND u.is_active AND NOT EXISTS (
        SELECT 1 FROM public.group_students gs
        JOIN public.groups g ON g.id = gs.group_id AND g.deleted_at IS NULL AND g.is_active
        WHERE gs.student_id = u.id))
  ) INTO v_people
  FROM public.users u WHERE u.tenant_id = v_tenant;

  -- ── Groups ────────────────────────────────────────────────
  SELECT jsonb_build_object(
    'active',   count(*) FILTER (WHERE g.is_active),
    'archived', count(*) FILTER (WHERE NOT g.is_active),
    'avg_size', COALESCE(round(avg(sz.n) FILTER (WHERE g.is_active), 1), 0)
  ) INTO v_groups
  FROM public.groups g
  LEFT JOIN LATERAL (SELECT count(*) AS n FROM public.group_students gs WHERE gs.group_id = g.id) sz ON true
  WHERE g.tenant_id = v_tenant AND g.deleted_at IS NULL;

  -- ── Courses & progress ────────────────────────────────────
  WITH totals AS (
    SELECT ui.course_id, count(*) AS total
    FROM public.unit_items ui
    JOIN public.course_units cu ON cu.id = ui.unit_id AND cu.is_published
    WHERE ui.tenant_id = v_tenant AND ui.is_published
    GROUP BY ui.course_id
  ), prog AS (
    SELECT sp.student_id, ui.course_id,
           count(*) FILTER (WHERE ui.is_published AND cu.is_published) AS done,
           max(sp.completed_at) AS last_at
    FROM public.student_progress sp
    JOIN public.unit_items ui   ON ui.id = sp.unit_item_id
    JOIN public.course_units cu ON cu.id = ui.unit_id
    WHERE sp.tenant_id = v_tenant
    GROUP BY sp.student_id, ui.course_id
  ), enr AS (
    SELECT ce.student_id, ce.course_id, ce.enrolled_at,
           COALESCE(t.total, 0) AS total, COALESCE(p.done, 0) AS done, p.last_at
    FROM public.course_enrollments ce
    JOIN public.courses c ON c.id = ce.course_id AND c.deleted_at IS NULL
    LEFT JOIN totals t ON t.course_id = ce.course_id
    LEFT JOIN prog p   ON p.course_id = ce.course_id AND p.student_id = ce.student_id
    WHERE ce.tenant_id = v_tenant
  )
  SELECT jsonb_build_object(
    'courses',           (SELECT count(*) FROM public.courses c WHERE c.tenant_id = v_tenant AND c.deleted_at IS NULL),
    'published_courses', (SELECT count(*) FROM public.courses c WHERE c.tenant_id = v_tenant AND c.deleted_at IS NULL AND c.is_published),
    'enrollments',       count(*),
    'avg_progress',      COALESCE(round(avg(LEAST(done::numeric / total, 1)) FILTER (WHERE total > 0) * 100, 1), 0),
    'completed',         count(*) FILTER (WHERE total > 0 AND done >= total),
    'active_learners',   count(DISTINCT student_id) FILTER (WHERE last_at >= v_from),
    'at_risk',           count(*) FILTER (WHERE NOT (total > 0 AND done >= total)
                                            AND COALESCE(last_at, enrolled_at) < now() - interval '14 days')
  ) INTO v_learning
  FROM enr;

  -- ── Assessments (aggregates only) ─────────────────────────
  SELECT jsonb_build_object(
    'graded',    count(*),
    'avg_pct',   COALESCE(round(avg(gr.score / gr.max_score) * 100, 1), 0),
    'pass_rate', COALESCE(round(avg(CASE WHEN gr.score / gr.max_score >= 0.5 THEN 1.0 ELSE 0 END) * 100, 1), 0),
    'submissions', (SELECT count(*) FROM public.exam_submissions s
                    WHERE s.tenant_id = v_tenant AND s.submitted_at >= v_from),
    'flagged',     (SELECT count(*) FROM public.exam_submissions s
                    WHERE s.tenant_id = v_tenant AND s.submitted_at >= v_from AND s.is_flagged)
  ) INTO v_assess
  FROM public.grades gr
  WHERE gr.tenant_id = v_tenant AND gr.graded_at >= v_from AND gr.max_score > 0;

  -- ── Attendance ────────────────────────────────────────────
  SELECT jsonb_build_object(
    'sessions', (SELECT count(*) FROM public.attendance_sessions s
                 WHERE s.tenant_id = v_tenant AND s.session_date >= v_from::date),
    'records',  count(*),
    'present',  count(*) FILTER (WHERE ar.status = 'present'),
    'late',     count(*) FILTER (WHERE ar.status = 'late'),
    'absent',   count(*) FILTER (WHERE ar.status = 'absent'),
    'excused',  count(*) FILTER (WHERE ar.status = 'excused'),
    'rate',     COALESCE(round(100.0 * count(*) FILTER (WHERE ar.status IN ('present', 'late'))
                         / NULLIF(count(*) FILTER (WHERE ar.status <> 'excused'), 0), 1), 0),
    'chronic_absentees', (
      SELECT count(*) FROM (
        SELECT ar2.student_id
        FROM public.attendance_records ar2
        JOIN public.attendance_sessions s2 ON s2.id = ar2.session_id
        WHERE ar2.tenant_id = v_tenant AND s2.session_date >= v_from::date AND ar2.status <> 'excused'
        GROUP BY ar2.student_id
        HAVING count(*) >= 3
           AND count(*) FILTER (WHERE ar2.status = 'absent')::numeric / count(*) >= 0.25
      ) x)
  ) INTO v_attend
  FROM public.attendance_records ar
  JOIN public.attendance_sessions s ON s.id = ar.session_id
  WHERE ar.tenant_id = v_tenant AND s.session_date >= v_from::date;

  -- ── Per group ─────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.students DESC, r.name), '[]'::jsonb) INTO v_group_rows
  FROM (
    SELECT g.id, g.name, u.full_name AS teacher,
      (SELECT count(*) FROM public.group_students gs WHERE gs.group_id = g.id) AS students,
      (SELECT count(*) FROM public.attendance_sessions s
        WHERE s.group_id = g.id AND s.session_date >= v_from::date) AS sessions,
      (SELECT round(100.0 * count(*) FILTER (WHERE ar.status IN ('present', 'late'))
                / NULLIF(count(*) FILTER (WHERE ar.status <> 'excused'), 0), 1)
         FROM public.attendance_records ar
         JOIN public.attendance_sessions s ON s.id = ar.session_id
        WHERE s.group_id = g.id AND s.session_date >= v_from::date) AS attendance_rate,
      (SELECT round(avg(gr.score / gr.max_score) * 100, 1)
         FROM public.grades gr JOIN public.exams e ON e.id = gr.exam_id
        WHERE e.group_id = g.id AND gr.graded_at >= v_from AND gr.max_score > 0) AS avg_pct
    FROM public.groups g
    LEFT JOIN public.users u ON u.id = g.teacher_id
    WHERE g.tenant_id = v_tenant AND g.deleted_at IS NULL AND g.is_active
    ORDER BY g.name
    LIMIT 100
  ) r;

  -- ── Per teacher ───────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.students DESC, r.name), '[]'::jsonb) INTO v_teacher_rows
  FROM (
    SELECT t.id, t.full_name AS name, t.is_active,
      (SELECT count(*) FROM public.groups g
        WHERE g.teacher_id = t.id AND g.deleted_at IS NULL AND g.is_active) AS groups,
      (SELECT count(DISTINCT gs.student_id) FROM public.group_students gs
         JOIN public.groups g ON g.id = gs.group_id AND g.deleted_at IS NULL AND g.is_active
        WHERE g.teacher_id = t.id) AS students,
      (SELECT count(*) FROM public.courses c WHERE c.teacher_id = t.id AND c.deleted_at IS NULL) AS courses,
      (SELECT round(sum(extract(epoch FROM (sl.end_time - sl.start_time))) / 3600.0, 1)
         FROM public.schedule_slots sl WHERE sl.teacher_id = t.id) AS weekly_hours,
      (SELECT round(avg(gr.score / gr.max_score) * 100, 1)
         FROM public.grades gr JOIN public.exams e ON e.id = gr.exam_id
        WHERE e.teacher_id = t.id AND gr.graded_at >= v_from AND gr.max_score > 0) AS avg_pct
    FROM public.users t
    WHERE t.tenant_id = v_tenant AND t.role = 'teacher'
    ORDER BY t.full_name
    LIMIT 100
  ) r;

  -- ── Weekly trend (last 8 weeks) ───────────────────────────
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.week), '[]'::jsonb) INTO v_trend
  FROM (
    SELECT wk::date AS week,
      (SELECT count(*) FROM public.users u WHERE u.tenant_id = v_tenant AND u.role = 'student'
          AND u.created_at >= wk AND u.created_at < wk + interval '1 week') AS new_students,
      (SELECT count(*) FROM public.exam_submissions s WHERE s.tenant_id = v_tenant
          AND s.submitted_at >= wk AND s.submitted_at < wk + interval '1 week') AS submissions,
      (SELECT count(*) FROM public.student_progress sp WHERE sp.tenant_id = v_tenant
          AND sp.completed_at >= wk AND sp.completed_at < wk + interval '1 week') AS completed_items,
      (SELECT round(100.0 * count(*) FILTER (WHERE ar.status IN ('present', 'late'))
                / NULLIF(count(*) FILTER (WHERE ar.status <> 'excused'), 0), 1)
         FROM public.attendance_records ar
         JOIN public.attendance_sessions s ON s.id = ar.session_id
        WHERE ar.tenant_id = v_tenant
          AND s.session_date >= wk::date AND s.session_date < (wk + interval '1 week')::date) AS attendance_rate
    FROM generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()), interval '1 week') wk
  ) r;

  -- ── Timetable ─────────────────────────────────────────────
  SELECT jsonb_build_object(
    'schedules',           (SELECT count(*) FROM public.schedules sc WHERE sc.tenant_id = v_tenant AND sc.kind = 'group'),
    'published_schedules', (SELECT count(*) FROM public.schedules sc WHERE sc.tenant_id = v_tenant AND sc.kind = 'group' AND sc.is_published),
    'groups_without_schedule', (SELECT count(*) FROM public.groups g
                                WHERE g.tenant_id = v_tenant AND g.deleted_at IS NULL AND g.is_active
                                  AND NOT EXISTS (SELECT 1 FROM public.schedules sc WHERE sc.group_id = g.id)),
    'weekly_slots', (SELECT count(*) FROM public.schedule_slots sl
                     JOIN public.schedules sc ON sc.id = sl.schedule_id AND sc.kind = 'group'
                     WHERE sl.tenant_id = v_tenant),
    'weekly_hours', (SELECT COALESCE(round(sum(extract(epoch FROM (sl.end_time - sl.start_time))) / 3600.0, 1), 0)
                     FROM public.schedule_slots sl
                     JOIN public.schedules sc ON sc.id = sl.schedule_id AND sc.kind = 'group'
                     WHERE sl.tenant_id = v_tenant),
    'teacher_conflicts', (SELECT count(*) FROM public.schedule_slots a
                          JOIN public.schedule_slots b
                            ON a.teacher_id = b.teacher_id AND a.day_of_week = b.day_of_week AND a.id < b.id
                           AND a.start_time < b.end_time AND b.start_time < a.end_time
                          WHERE a.tenant_id = v_tenant AND b.tenant_id = v_tenant AND a.teacher_id IS NOT NULL)
  ) INTO v_sched;

  -- ── Engagement & workload ─────────────────────────────────
  SELECT jsonb_build_object(
    'announcements_live', (SELECT count(*) FROM public.announcements a WHERE a.tenant_id = v_tenant AND a.is_published
                            AND (a.starts_at IS NULL OR a.starts_at <= now()) AND (a.ends_at IS NULL OR a.ends_at >= now())),
    'announcements_scheduled', (SELECT count(*) FROM public.announcements a WHERE a.tenant_id = v_tenant
                                 AND a.is_published AND a.starts_at > now()),
    'survey_responses', (SELECT count(*) FROM public.survey_responses sr WHERE sr.tenant_id = v_tenant AND sr.submitted_at >= v_from),
    'survey_ease_avg',  (SELECT round(avg(sr.ease_rating), 2) FROM public.survey_responses sr WHERE sr.tenant_id = v_tenant AND sr.submitted_at >= v_from),
    'survey_recommend_pct', (SELECT round(100.0 * avg(CASE WHEN sr.recommend THEN 1 ELSE 0 END), 1)
                             FROM public.survey_responses sr WHERE sr.tenant_id = v_tenant AND sr.submitted_at >= v_from AND sr.recommend IS NOT NULL),
    'open_requests',   (SELECT count(*) FROM public.staff_requests r WHERE r.tenant_id = v_tenant AND r.status IN ('pending', 'accepted')),
    'pending_appeals', (SELECT count(*) FROM public.exam_appeals ap WHERE ap.tenant_id = v_tenant AND ap.status = 'pending')
  ) INTO v_engage;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'period_days',  v_days,
    'people',       v_people,
    'groups',       v_groups,
    'learning',     v_learning,
    'assessments',  v_assess,
    'attendance',   v_attend,
    'group_rows',   v_group_rows,
    'teacher_rows', v_teacher_rows,
    'trend',        v_trend,
    'schedule',     v_sched,
    'engagement',   v_engage
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_center_dashboard(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_center_dashboard(integer) TO authenticated;
