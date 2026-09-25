-- ============================================================
-- engagement_metrics_migration.sql — 2026-09-19
-- Idempotent + re-runnable. Apply in the Supabase SQL Editor
-- AFTER courses_migration.sql and attendance_migration.sql.
--
-- "Platform attendance": how much each student actually engages with the
-- work their teacher set — submitted assignments, completed course items,
-- days active — as opposed to physically showing up (attendance_*).
--
--   get_group_engagement(p_group_id, p_days) — one group, per student
--   get_tenant_engagement(p_days)            — every group, aggregates only
--   get_course_analytics(p_days)             — every course, with its groups
--
-- Processing & storage:
--   * Computed on demand from live tables. No new columns, no new rows,
--     no materialized view, no cron. Indexes below cover the hot paths.
--   * Tenant/role/identity come from public.users by auth.uid(), never
--     from a parameter (the r1_defense_in_depth rule).
--
-- Deliberately contains NO scores: engagement counts submissions and
-- completions, never what the student answered or the mark they got, so
-- this stays inside admin_metadata_only_migration's "numbers, not content".
--
-- Access:
--   get_group_engagement  — the group's own teacher; super_admin;
--                           university_admin / center_manager holding
--                           view_reports (same tenant). Others: 42501.
--   get_tenant_engagement — staff only (same view_reports rule). 42501.
--   get_course_analytics  — staff only (same view_reports rule). 42501.
--
-- The score:
--   task_pct   = submitted / assigned      (published exams + homework of
--                the group created inside the window; NULL if none were set)
--   course_pct = completed published items / published items of the
--                courses the student is enrolled in (NULL if not enrolled)
--   engagement = 0.6*task_pct + 0.4*course_pct, falling back to whichever
--                component exists; NULL when neither does (nothing to
--                engage with yet — that is not a zero).
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_student_progress_student_done
  ON student_progress (student_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_unit_quiz_submissions_student
  ON unit_quiz_submissions (student_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_exam_submissions_student_sub
  ON exam_submissions (student_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_exams_group_published
  ON exams (group_id, created_at DESC) WHERE is_published;

-- ── One group, per student ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_group_engagement(
  p_group_id uuid,
  p_days     integer DEFAULT 30
)
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
  v_group  record;
  v_assigned integer;
  v_rows   jsonb;
  v_summary jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT u.role, u.tenant_id, COALESCE(u.permissions, '{}'::jsonb)
    INTO v_role, v_tenant, v_perms
  FROM public.users u WHERE u.id = v_uid AND u.is_active = true;

  SELECT g.id, g.name, g.tenant_id, g.teacher_id, g.course_id
    INTO v_group
  FROM public.groups g
  WHERE g.id = p_group_id AND g.deleted_at IS NULL;

  IF v_group.id IS NULL THEN
    RAISE EXCEPTION 'group not found' USING ERRCODE = 'P0002';
  END IF;

  -- super_admin is cross-tenant; everyone else must match the group's tenant.
  IF v_role <> 'super_admin' AND (v_tenant IS NULL OR v_tenant <> v_group.tenant_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT (
       v_role = 'super_admin'
    OR (v_role = 'teacher' AND v_group.teacher_id = v_uid)
    OR (v_role = 'university_admin' AND COALESCE(v_perms->>'view_reports', 'true') <> 'false')
    OR (v_role = 'center_manager'   AND v_perms->>'view_reports' = 'true')
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_days := LEAST(GREATEST(COALESCE(p_days, 30), 7), 365);
  v_from := now() - make_interval(days => v_days);

  -- Work the teacher set for THIS group inside the window.
  SELECT count(*) INTO v_assigned
  FROM public.exams e
  WHERE e.group_id = v_group.id
    AND e.is_published
    AND e.created_at >= v_from
    AND e.deleted_at IS NULL;

  WITH roster AS (
    SELECT u.id, u.full_name, u.is_active
    FROM public.group_students gs
    JOIN public.users u ON u.id = gs.student_id
    WHERE gs.group_id = v_group.id
  ),
  assigned_exams AS (
    SELECT e.id FROM public.exams e
    WHERE e.group_id = v_group.id AND e.is_published
      AND e.created_at >= v_from AND e.deleted_at IS NULL
  ),
  per_student AS (
    SELECT
      r.id, r.full_name, r.is_active,
      (SELECT count(*) FROM public.exam_submissions es
        WHERE es.student_id = r.id AND es.exam_id IN (SELECT id FROM assigned_exams)) AS submitted,
      (SELECT count(*) FROM public.student_progress sp
        WHERE sp.student_id = r.id AND sp.completed_at >= v_from) AS items_done,
      (SELECT count(*) FROM public.unit_quiz_submissions q
        WHERE q.student_id = r.id AND q.submitted_at >= v_from) AS quizzes_done,
      -- Published items completed / published items of every course the
      -- student is enrolled in. Counted through course_units.course_id so
      -- flat courses (level_id IS NULL) are included — the same bug class
      -- fixed in fix_get_course_progress_flat_courses_migration.sql.
      (SELECT count(*) FROM public.unit_items ui
         JOIN public.course_units cu ON cu.id = ui.unit_id
        WHERE ui.is_published AND cu.is_published
          AND cu.course_id IN (SELECT ce.course_id FROM public.course_enrollments ce WHERE ce.student_id = r.id)) AS course_total,
      (SELECT count(*) FROM public.student_progress sp
         JOIN public.unit_items ui ON ui.id = sp.unit_item_id
         JOIN public.course_units cu ON cu.id = ui.unit_id
        WHERE sp.student_id = r.id AND ui.is_published AND cu.is_published
          AND cu.course_id IN (SELECT ce.course_id FROM public.course_enrollments ce WHERE ce.student_id = r.id)) AS course_done,
      (SELECT count(DISTINCT d) FROM (
          SELECT date_trunc('day', sp.completed_at) AS d FROM public.student_progress sp
           WHERE sp.student_id = r.id AND sp.completed_at >= v_from
          UNION
          SELECT date_trunc('day', es.submitted_at) FROM public.exam_submissions es
           WHERE es.student_id = r.id AND es.submitted_at >= v_from
          UNION
          SELECT date_trunc('day', q.submitted_at) FROM public.unit_quiz_submissions q
           WHERE q.student_id = r.id AND q.submitted_at >= v_from
        ) days) AS active_days,
      (SELECT max(t) FROM (
          SELECT max(sp.completed_at) AS t FROM public.student_progress sp WHERE sp.student_id = r.id
          UNION ALL
          SELECT max(es.submitted_at) FROM public.exam_submissions es WHERE es.student_id = r.id
          UNION ALL
          SELECT max(q.submitted_at) FROM public.unit_quiz_submissions q WHERE q.student_id = r.id
        ) seen) AS last_active_at
    FROM roster r
  ),
  scored AS (
    SELECT
      ps.*,
      CASE WHEN v_assigned > 0
           THEN LEAST(100.0, round(100.0 * ps.submitted / v_assigned, 1)) END AS task_pct,
      CASE WHEN ps.course_total > 0
           THEN round(100.0 * ps.course_done / ps.course_total, 1) END AS course_pct
    FROM per_student ps
  ),
  final AS (
    SELECT s.*,
      CASE
        WHEN s.task_pct IS NOT NULL AND s.course_pct IS NOT NULL
          THEN round(0.6 * s.task_pct + 0.4 * s.course_pct, 1)
        ELSE COALESCE(s.task_pct, s.course_pct)
      END AS engagement_pct
    FROM scored s
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'student_id',     f.id,
      'full_name',      f.full_name,
      'is_active',      f.is_active,
      'submitted',      f.submitted,
      'assigned',       v_assigned,
      'task_pct',       f.task_pct,
      'items_done',     f.items_done,
      'quizzes_done',   f.quizzes_done,
      'course_done',    f.course_done,
      'course_total',   f.course_total,
      'course_pct',     f.course_pct,
      'active_days',    f.active_days,
      'last_active_at', f.last_active_at,
      'engagement_pct', f.engagement_pct
    ) ORDER BY f.engagement_pct NULLS LAST, f.full_name), '[]'::jsonb),
    jsonb_build_object(
      'students',        count(*),
      'assigned',        v_assigned,
      'submitted',       COALESCE(sum(f.submitted), 0),
      'avg_engagement',  round(avg(f.engagement_pct), 1),
      'avg_task_pct',    round(avg(f.task_pct), 1),
      'avg_course_pct',  round(avg(f.course_pct), 1),
      'inactive',        count(*) FILTER (WHERE f.active_days = 0),
      'at_risk',         count(*) FILTER (WHERE f.engagement_pct IS NOT NULL AND f.engagement_pct < 50),
      'thriving',        count(*) FILTER (WHERE f.engagement_pct >= 85)
    )
  INTO v_rows, v_summary
  FROM final f;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'period_days',  v_days,
    'group',        jsonb_build_object('id', v_group.id, 'name', v_group.name, 'course_id', v_group.course_id),
    'summary',      v_summary,
    'students',     v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_group_engagement(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_group_engagement(uuid, integer) TO authenticated;

-- ── Whole tenant, one row per group (aggregates only) ─────────────
CREATE OR REPLACE FUNCTION public.get_tenant_engagement(p_days integer DEFAULT 30)
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
  v_rows   jsonb;
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

  WITH g AS (
    SELECT gr.id, gr.name, gr.course_id, t.full_name AS teacher
    FROM public.groups gr
    LEFT JOIN public.users t ON t.id = gr.teacher_id
    WHERE gr.tenant_id = v_tenant AND gr.deleted_at IS NULL AND gr.is_active
  ),
  per_group AS (
    SELECT
      g.id, g.name, g.course_id, g.teacher,
      (SELECT count(*) FROM public.group_students gs WHERE gs.group_id = g.id) AS students,
      (SELECT count(*) FROM public.exams e
        WHERE e.group_id = g.id AND e.is_published AND e.created_at >= v_from AND e.deleted_at IS NULL) AS assigned,
      (SELECT count(*) FROM public.exam_submissions es
        WHERE es.exam_id IN (SELECT e.id FROM public.exams e
                              WHERE e.group_id = g.id AND e.is_published
                                AND e.created_at >= v_from AND e.deleted_at IS NULL)
          AND es.student_id IN (SELECT gs.student_id FROM public.group_students gs WHERE gs.group_id = g.id)) AS submitted,
      (SELECT count(DISTINCT sp.student_id) FROM public.student_progress sp
        WHERE sp.completed_at >= v_from
          AND sp.student_id IN (SELECT gs.student_id FROM public.group_students gs WHERE gs.group_id = g.id)) AS active_students,
      (SELECT count(*) FROM public.student_progress sp
        WHERE sp.completed_at >= v_from
          AND sp.student_id IN (SELECT gs.student_id FROM public.group_students gs WHERE gs.group_id = g.id)) AS items_done
    FROM g
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'group_id',        pg.id,
    'name',            pg.name,
    'course_id',       pg.course_id,
    'teacher',         pg.teacher,
    'students',        pg.students,
    'assigned',        pg.assigned,
    'submitted',       pg.submitted,
    'task_pct',        CASE WHEN pg.assigned > 0 AND pg.students > 0
                            THEN LEAST(100.0, round(100.0 * pg.submitted / (pg.assigned * pg.students), 1)) END,
    'active_students', pg.active_students,
    'active_pct',      CASE WHEN pg.students > 0
                            THEN round(100.0 * pg.active_students / pg.students, 1) END,
    'items_done',      pg.items_done
  ) ORDER BY pg.name), '[]'::jsonb)
  INTO v_rows FROM per_group pg;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'period_days',  v_days,
    'groups',       v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_tenant_engagement(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_engagement(integer) TO authenticated;

-- ── One row per course, with its linked groups ────────────────────
-- Feeds /center/analytics: course → its groups → progress, engagement and
-- class attendance side by side, so a weak group is visible inside an
-- otherwise healthy course. Aggregates only — no student rows, no scores.
-- A group appears under a course only when groups.course_id links them
-- (group_course_transfer_migration): membership is never inferred.
CREATE OR REPLACE FUNCTION public.get_course_analytics(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text; v_tenant uuid; v_perms jsonb;
  v_days integer; v_from timestamptz; v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE='42501'; END IF;

  SELECT u.role, u.tenant_id, COALESCE(u.permissions,'{}'::jsonb) INTO v_role, v_tenant, v_perms
  FROM public.users u WHERE u.id = v_uid AND u.is_active = true;

  IF v_tenant IS NULL OR NOT (
       (v_role = 'university_admin' AND COALESCE(v_perms->>'view_reports','true') <> 'false')
    OR (v_role = 'center_manager'   AND v_perms->>'view_reports' = 'true')
  ) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;

  v_days := LEAST(GREATEST(COALESCE(p_days,30),7),365);
  v_from := now() - make_interval(days => v_days);

  WITH items AS (
    SELECT cu.course_id, ui.id FROM public.unit_items ui
    JOIN public.course_units cu ON cu.id = ui.unit_id
    WHERE ui.is_published AND cu.is_published AND ui.tenant_id = v_tenant
  ),
  totals AS (SELECT course_id, count(*) AS items_total FROM items GROUP BY course_id),
  done AS (
    SELECT i.course_id, sp.student_id, count(*) AS n,
           count(*) FILTER (WHERE sp.completed_at >= v_from) AS n_window
    FROM public.student_progress sp JOIN items i ON i.id = sp.unit_item_id
    WHERE sp.tenant_id = v_tenant GROUP BY 1,2
  ),
  co AS (
    SELECT c.id, c.title, c.is_published, t.full_name AS teacher, COALESCE(tt.items_total,0) AS items_total
    FROM public.courses c
    LEFT JOIN public.users t ON t.id = c.teacher_id
    LEFT JOIN totals tt ON tt.course_id = c.id
    WHERE c.tenant_id = v_tenant AND c.deleted_at IS NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'course_id', co.id, 'title', co.title, 'is_published', co.is_published, 'teacher', co.teacher,
    'items_total', co.items_total, 'enrollments', st.enrollments, 'avg_progress', st.avg_progress,
    'completed_students', st.completed_students, 'active_students', st.active_students, 'groups', st.groups
  ) ORDER BY co.title), '[]'::jsonb) INTO v_rows
  FROM co
  CROSS JOIN LATERAL (
    SELECT
      (SELECT count(*) FROM public.course_enrollments ce WHERE ce.course_id = co.id) AS enrollments,
      -- Average of each enrolled student's own completion, so a course with
      -- one keen student and nine idle ones does not read as healthy.
      (SELECT CASE WHEN co.items_total > 0 THEN round(avg(LEAST(100.0, 100.0 * COALESCE(d.n,0) / co.items_total)),1) END
         FROM public.course_enrollments ce
         LEFT JOIN done d ON d.course_id = co.id AND d.student_id = ce.student_id
        WHERE ce.course_id = co.id) AS avg_progress,
      (SELECT count(*) FROM public.course_enrollments ce
         JOIN done d ON d.course_id = co.id AND d.student_id = ce.student_id
        WHERE ce.course_id = co.id AND co.items_total > 0 AND d.n >= co.items_total) AS completed_students,
      (SELECT count(*) FROM public.course_enrollments ce
         JOIN done d ON d.course_id = co.id AND d.student_id = ce.student_id
        WHERE ce.course_id = co.id AND d.n_window > 0) AS active_students,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'group_id', g.id, 'name', g.name, 'teacher', gt.full_name, 'students', gs.n,
          'avg_progress', CASE WHEN co.items_total > 0 AND gs.n > 0 THEN round(gp.p,1) END,
          'active_pct', CASE WHEN gs.n > 0 THEN round(100.0 * ga.n / gs.n, 1) END,
          'attendance_rate', att.rate, 'sessions', att.sessions
        ) ORDER BY g.name), '[]'::jsonb)
       FROM public.groups g
       LEFT JOIN public.users gt ON gt.id = g.teacher_id
       CROSS JOIN LATERAL (SELECT count(*)::numeric AS n FROM public.group_students x WHERE x.group_id = g.id) gs
       CROSS JOIN LATERAL (SELECT COALESCE(avg(LEAST(100.0, 100.0 * COALESCE(d.n,0) / NULLIF(co.items_total,0))),0) AS p
                             FROM public.group_students x
                             LEFT JOIN done d ON d.course_id = co.id AND d.student_id = x.student_id
                            WHERE x.group_id = g.id) gp
       CROSS JOIN LATERAL (SELECT count(*)::numeric AS n FROM public.group_students x
                            JOIN done d ON d.course_id = co.id AND d.student_id = x.student_id
                           WHERE x.group_id = g.id AND d.n_window > 0) ga
       -- Class attendance over the same window. 'excused' is excluded from
       -- both sides, matching the student view and the centre dashboard.
       CROSS JOIN LATERAL (
         SELECT count(DISTINCT s.id) AS sessions,
                CASE WHEN count(r.*) FILTER (WHERE r.status <> 'excused') > 0
                     THEN round(100.0 * count(r.*) FILTER (WHERE r.status IN ('present','late'))
                                / count(r.*) FILTER (WHERE r.status <> 'excused'), 1) END AS rate
           FROM public.attendance_sessions s
           LEFT JOIN public.attendance_records r ON r.session_id = s.id
          WHERE s.group_id = g.id AND s.session_date >= v_from::date
       ) att
       WHERE g.course_id = co.id AND g.deleted_at IS NULL AND g.is_active
      ) AS groups
  ) st;

  RETURN jsonb_build_object('generated_at', now(), 'period_days', v_days, 'courses', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.get_course_analytics(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_analytics(integer) TO authenticated;
