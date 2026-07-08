-- ============================================================
-- Hide soft-deleted (archived) rows from all LIVE read paths.
-- Wraps the existing SELECT policies with `deleted_at IS NULL` so every
-- normal-client query (all dashboard pages) automatically excludes
-- archived rows. The archive itself is read via get_tenant_archive()
-- (SECURITY DEFINER — bypasses RLS), so it still sees everything.
-- Idempotent / re-runnable.
-- ============================================================

-- groups
DROP POLICY IF EXISTS "groups_select" ON groups;
CREATE POLICY "groups_select" ON groups FOR SELECT USING (
  deleted_at IS NULL AND (
    (SELECT current_user_role()) = 'super_admin'
    OR tenant_id = (SELECT current_tenant_id())
  )
);

-- lessons
DROP POLICY IF EXISTS "lessons_select" ON lessons;
CREATE POLICY "lessons_select" ON lessons FOR SELECT USING (
  deleted_at IS NULL AND (
    (SELECT current_user_role()) = 'super_admin'
    OR tenant_id = (SELECT current_tenant_id())
  )
);

-- courses
DROP POLICY IF EXISTS "courses_select" ON courses;
CREATE POLICY "courses_select" ON courses FOR SELECT USING (
  deleted_at IS NULL AND (
    current_user_role() = 'super_admin'
    OR tenant_id = current_tenant_id()
  )
);

-- exams: keep the existing (enrollment-aware) policy but exclude archived.
DROP POLICY IF EXISTS "exams_select" ON exams;
CREATE POLICY "exams_select" ON exams FOR SELECT USING (
  deleted_at IS NULL AND (
    (SELECT current_user_role()) = 'super_admin'
    OR ((SELECT current_user_role()) = 'university_admin'
          AND tenant_id = (SELECT current_tenant_id()))
    OR ((SELECT current_user_role()) = 'teacher'
          AND teacher_id = (SELECT auth.uid()))
  )
);

-- Student exam feed (SECURITY DEFINER — RLS doesn't apply inside it):
-- add the archived filter explicitly.
CREATE OR REPLACE FUNCTION public.get_student_exams()
 RETURNS TABLE(id uuid, tenant_id uuid, group_id uuid, course_id uuid, teacher_id uuid, title text, duration_minutes integer, is_published boolean, proctoring_enabled boolean, starts_at timestamptz, ends_at timestamptz, created_at timestamptz, questions jsonb, group_name text, course_title text)
 LANGUAGE sql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    e.id, e.tenant_id, e.group_id, e.course_id, e.teacher_id,
    e.title, e.duration_minutes, e.is_published, e.proctoring_enabled,
    e.starts_at, e.ends_at, e.created_at,
    COALESCE(
      (SELECT jsonb_agg(q - 'correct_answer')
         FROM jsonb_array_elements(e.questions) AS q),
      '[]'::jsonb
    ) AS questions,
    g.name  AS group_name,
    c.title AS course_title
  FROM exams e
  LEFT JOIN groups  g ON g.id = e.group_id
  LEFT JOIN courses c ON c.id = e.course_id
  WHERE e.is_published = true
    AND e.deleted_at IS NULL
    AND (e.group_id IS NULL OR (g.is_active = true AND g.deleted_at IS NULL))
    AND (
      e.group_id IN (
        SELECT group_id FROM group_students WHERE student_id = auth.uid()
      )
      OR e.course_id IN (
        SELECT course_id FROM course_enrollments WHERE student_id = auth.uid()
      )
    )
  ORDER BY e.created_at DESC;
$function$;
