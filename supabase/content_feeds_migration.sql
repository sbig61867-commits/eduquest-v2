-- Batch 3 — P-02 + P-04: bounded content feeds.
--
-- P-02 (university_admin): get_admin_lessons() / get_admin_exams() return EVERY lesson / exam of the
-- institution; the dashboard reads both just to count them and show 5 lessons, and /admin/lessons and
-- /admin/exams render the whole list. This adds:
--   get_admin_content_counts()                    one row of counts for the dashboard and the page summaries;
--   get_admin_lessons_page(p_limit, p_offset)     one page of the lesson feed (totals: the counts above);
--   get_admin_exams_page(p_homework, p_limit, p_offset)  one page of exams OR homework.
-- Same columns, same guard and same "metadata only" rule as the existing feeds (role = university_admin,
-- tenant = the caller's; no content, no questions, no answers). SECURITY DEFINER is required for the same
-- reason as the existing feeds: the admin has no direct RLS read on lessons / exams (admin_metadata_only).
-- Homework = type 'homework' OR an out-of-range duration (≤ 0 or ≥ 43200) — the page's isHomework rule.
--
-- P-04 (teacher): /teacher/exams reads exams.* (every question of every exam) to show questions.length.
-- This adds the PostgREST computed field question_count(exams) → integer, so the page can select named
-- columns + question_count instead. SECURITY INVOKER: it only reads the row it is given, which RLS has
-- already let the caller see.
--
-- Additive and idempotent: creates four functions; changes no table, row, policy, index or existing function.
-- get_admin_lessons() / get_admin_exams() stay as they are (the deployed code still calls them).
-- Rollback:
--   DROP FUNCTION IF EXISTS public.get_admin_content_counts();
--   DROP FUNCTION IF EXISTS public.get_admin_lessons_page(integer, integer);
--   DROP FUNCTION IF EXISTS public.get_admin_exams_page(boolean, integer, integer);
--   DROP FUNCTION IF EXISTS public.question_count(public.exams);

-- ── P-04: computed field ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.question_count(e public.exams)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN jsonb_typeof(e.questions) = 'array' THEN jsonb_array_length(e.questions) ELSE 0 END;
$$;

REVOKE ALL ON FUNCTION public.question_count(public.exams) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.question_count(public.exams) TO authenticated;

-- ── P-02: counts ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_admin_content_counts()
RETURNS TABLE (lessons bigint, published_lessons bigint, exams bigint, homework bigint, submissions bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (
    SELECT (SELECT public.current_tenant_id()) AS tenant_id
    WHERE (SELECT public.current_user_role()) = 'university_admin'
  )
  SELECT
    (SELECT count(*) FROM public.lessons l, me WHERE l.tenant_id = me.tenant_id AND l.deleted_at IS NULL),
    (SELECT count(*) FROM public.lessons l, me WHERE l.tenant_id = me.tenant_id AND l.deleted_at IS NULL AND l.is_published),
    (SELECT count(*) FROM public.exams e, me WHERE e.tenant_id = me.tenant_id AND e.deleted_at IS NULL
       AND NOT (COALESCE(e.type, '') = 'homework' OR COALESCE(e.duration_minutes, 0) <= 0 OR e.duration_minutes >= 43200)),
    (SELECT count(*) FROM public.exams e, me WHERE e.tenant_id = me.tenant_id AND e.deleted_at IS NULL
       AND (COALESCE(e.type, '') = 'homework' OR COALESCE(e.duration_minutes, 0) <= 0 OR e.duration_minutes >= 43200)),
    (SELECT count(*) FROM public.exam_submissions s JOIN public.exams e ON e.id = s.exam_id, me
       WHERE e.tenant_id = me.tenant_id AND e.deleted_at IS NULL)
  FROM me;
$$;

REVOKE ALL ON FUNCTION public.get_admin_content_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_content_counts() TO authenticated;

-- ── P-02: lessons, one page ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_admin_lessons_page(p_limit integer, p_offset integer)
RETURNS TABLE (id uuid, title text, is_published boolean, created_at timestamptz,
               teacher_name text, group_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT l.id, l.title, l.is_published, l.created_at, t.full_name, g.name
  FROM public.lessons l
  LEFT JOIN public.users t ON t.id = l.teacher_id
  LEFT JOIN public.groups g ON g.id = l.group_id
  WHERE l.deleted_at IS NULL
    AND (SELECT public.current_user_role()) = 'university_admin'
    AND l.tenant_id = (SELECT public.current_tenant_id())
  ORDER BY l.created_at DESC, l.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

REVOKE ALL ON FUNCTION public.get_admin_lessons_page(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_lessons_page(integer, integer) TO authenticated;

-- ── P-02: exams or homework, one page ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_admin_exams_page(p_homework boolean, p_limit integer, p_offset integer)
RETURNS TABLE (id uuid, title text, type text, duration_minutes integer, is_published boolean,
               proctoring_enabled boolean, created_at timestamptz, teacher_name text, group_name text,
               submission_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.id, e.title, e.type, e.duration_minutes, e.is_published, e.proctoring_enabled, e.created_at,
         t.full_name, g.name,
         (SELECT count(*) FROM public.exam_submissions s WHERE s.exam_id = e.id)
  FROM public.exams e
  LEFT JOIN public.users t ON t.id = e.teacher_id
  LEFT JOIN public.groups g ON g.id = e.group_id
  WHERE e.deleted_at IS NULL
    AND (SELECT public.current_user_role()) = 'university_admin'
    AND e.tenant_id = (SELECT public.current_tenant_id())
    AND (COALESCE(e.type, '') = 'homework' OR COALESCE(e.duration_minutes, 0) <= 0 OR e.duration_minutes >= 43200)
        = COALESCE(p_homework, false)
  ORDER BY e.created_at DESC, e.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

REVOKE ALL ON FUNCTION public.get_admin_exams_page(boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_exams_page(boolean, integer, integer) TO authenticated;
