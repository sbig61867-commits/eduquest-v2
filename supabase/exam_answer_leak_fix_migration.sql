-- ============================================================
-- Migration: stop students from reading exam answer keys
-- ------------------------------------------------------------
-- Problem: exams_select allowed any user in a tenant (INCLUDING
-- students) to read every exam row. The questions JSONB embeds
-- `correct_answer`, so a student could query PostgREST directly
-- (the anon key is public) and harvest all correct answers before
-- or during an exam, defeating server-side grading.
--
-- Fix (no data migration):
--   1. exams_select no longer grants students row access. Only
--      super_admin, a tenant's university_admin, and a teacher's
--      OWN exams remain directly readable.
--   2. Students get exam content exclusively through the
--      get_student_exams() SECURITY DEFINER RPC, which returns the
--      questions with `correct_answer` stripped out.
--
-- API routes (exam/start, exam/submit, proctor/analyze) read exams
-- with the service-role client, so they are unaffected by the RLS
-- change. Grading in exam/submit reads correct_answer server-side
-- via the service-role client.
--
-- Idempotent / re-runnable.
-- ============================================================

-- ── 1. Tighten exams_select (remove blanket student/tenant read) ──
DROP POLICY IF EXISTS "exams_select" ON exams;
CREATE POLICY "exams_select" ON exams FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin'
  OR ((SELECT current_user_role()) = 'university_admin'
        AND tenant_id = (SELECT current_tenant_id()))
  OR ((SELECT current_user_role()) = 'teacher'
        AND teacher_id = (SELECT auth.uid()))
);

-- ── 2. Student-safe exam feed (answers stripped) ──────────────────
CREATE OR REPLACE FUNCTION get_student_exams()
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
