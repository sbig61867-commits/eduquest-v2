-- ============================================================
-- Archived groups (is_active = false) disappear from the student
-- exam/homework feed. Lessons visibility is filtered app-side.
-- Idempotent / re-runnable.
-- ============================================================

-- Archive flag (didn't exist on the live groups table).
ALTER TABLE groups ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE OR REPLACE FUNCTION public.get_student_exams()
RETURNS TABLE (
  id                 uuid,
  tenant_id          uuid,
  group_id           uuid,
  course_id          uuid,
  teacher_id         uuid,
  title              text,
  duration_minutes   integer,
  is_published       boolean,
  proctoring_enabled boolean,
  starts_at          timestamptz,
  ends_at            timestamptz,
  created_at         timestamptz,
  questions          jsonb,
  group_name         text,
  course_title       text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    e.id, e.tenant_id, e.group_id, e.course_id, e.teacher_id,
    e.title, e.duration_minutes, e.is_published, e.proctoring_enabled,
    e.starts_at, e.ends_at, e.created_at,
    -- Strip correct_answer from every question object before returning.
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
    -- Archived groups: their exams/homework are hidden from students.
    AND (e.group_id IS NULL OR g.is_active = true)
    AND (
      e.group_id IN (
        SELECT group_id FROM group_students WHERE student_id = auth.uid()
      )
      OR e.course_id IN (
        SELECT course_id FROM course_enrollments WHERE student_id = auth.uid()
      )
    )
  ORDER BY e.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_student_exams() TO authenticated;
