-- ============================================================
-- admin_metadata_only_migration.sql — 2026-09-04
-- Idempotent + re-runnable. Apply in the Supabase SQL Editor.
--
-- Owner's spec: the university_admin is a *pure administrator*. They may
-- see that a group exists for a given subject/teacher, how many students
-- are in it, and that lessons/exams/homework are being created — as
-- NUMBERS and metadata only. They must NEVER be able to read:
--   • lesson bodies            (lessons.content, lessons.media_urls)
--   • exam/homework questions  (exams.questions — which embed correct_answer!)
--   • student answers          (exam_submissions.answers)
--   • grades / scores          (grades.*, exam_submissions.score)
--
-- The admin UI already hides all of this. But RLS — the real boundary —
-- still granted university_admin a blanket row read on those tables, so
-- the admin could bypass the UI and query PostgREST directly (the anon
-- key is public) to harvest lesson text, questions WITH their answer key,
-- submissions and grades. This is the same class of leak that
-- exam_answer_leak_fix_migration.sql closed for students.
--
-- This migration:
--   1. Removes the university_admin branch from lessons_select,
--      exams_select, submissions_select and grades_select.
--   2. Adds two SECURITY DEFINER feeds — get_admin_lessons() and
--      get_admin_exams() — that return ONLY safe metadata + counts
--      (no content, no questions, no answers, no scores) to the tenant's
--      university_admin.
--
-- Grade/attainment reports ("كشوفات") are unaffected: they run through
-- src/lib/reports.ts and the grade-export API on the SERVICE-ROLE client,
-- which bypasses RLS. The admin requests those THROUGH the teacher flow,
-- exactly as specified.
-- ============================================================

-- ── 1. LESSONS: drop the admin's direct row read ────────────
-- Keeps: super_admin (all), teacher (own or own-group), student
-- (published lessons in enrolled groups). Admin metadata comes from
-- get_admin_lessons() below.
DROP POLICY IF EXISTS "lessons_select" ON lessons;
CREATE POLICY "lessons_select" ON lessons FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      (SELECT current_user_role()) = 'super_admin'

      OR (
        (SELECT current_user_role()) = 'teacher'
        AND tenant_id = (SELECT current_tenant_id())
        AND (
          teacher_id = (SELECT auth.uid())
          OR group_id IN (
            SELECT g.id FROM public.groups g
            WHERE g.teacher_id = (SELECT auth.uid())
          )
        )
      )

      OR (
        (SELECT current_user_role()) = 'student'
        AND is_published = TRUE
        AND group_id IN (
          SELECT gs.group_id FROM public.group_students gs
          WHERE gs.student_id = (SELECT auth.uid())
        )
      )
    )
  );

-- ── 2. EXAMS: drop the admin's direct row read ──────────────
-- Keeps: super_admin (all), teacher (own). Students already read a
-- correct_answer-stripped feed via get_student_exams(). Admin metadata
-- comes from get_admin_exams() below.
DROP POLICY IF EXISTS "exams_select" ON exams;
CREATE POLICY "exams_select" ON exams FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin'
  OR ((SELECT current_user_role()) = 'teacher'
        AND teacher_id = (SELECT auth.uid()))
);

-- ── 3. EXAM_SUBMISSIONS: drop the admin's direct row read ───
-- Keeps: super_admin (all), student (own), teacher (own exams).
DROP POLICY IF EXISTS "submissions_select" ON exam_submissions;
CREATE POLICY "submissions_select" ON exam_submissions FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin'
  OR student_id = (SELECT auth.uid())
  OR ((SELECT current_user_role()) = 'teacher' AND EXISTS (
     SELECT 1 FROM public.exams
     WHERE exams.id = exam_submissions.exam_id
       AND exams.teacher_id = (SELECT auth.uid())
  ))
);

-- ── 4. GRADES: drop the admin from the staff branch ─────────
-- Keeps: super_admin (all), student (own), teacher (own tenant).
DROP POLICY IF EXISTS "grades_select" ON grades;
CREATE POLICY "grades_select" ON grades FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin'
  OR student_id = (SELECT auth.uid())
  OR (
    (SELECT current_user_role()) = 'teacher'
    AND tenant_id = (SELECT current_tenant_id())
  )
);

-- ── 5. Admin-safe LESSON feed (metadata only, no content) ───
CREATE OR REPLACE FUNCTION get_admin_lessons()
RETURNS TABLE (
  id           uuid,
  title        text,
  is_published boolean,
  created_at   timestamptz,
  teacher_name text,
  group_name   text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    l.id, l.title, l.is_published, l.created_at,
    t.full_name AS teacher_name,
    g.name      AS group_name
  FROM lessons l
  LEFT JOIN users  t ON t.id = l.teacher_id
  LEFT JOIN groups g ON g.id = l.group_id
  WHERE l.deleted_at IS NULL
    AND (SELECT current_user_role()) = 'university_admin'
    AND l.tenant_id = (SELECT current_tenant_id())
  ORDER BY l.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION get_admin_lessons() TO authenticated;

-- ── 6. Admin-safe EXAM feed (metadata + counts, no questions) ─
CREATE OR REPLACE FUNCTION get_admin_exams()
RETURNS TABLE (
  id                 uuid,
  title              text,
  type               text,
  duration_minutes   integer,
  is_published       boolean,
  proctoring_enabled boolean,
  created_at         timestamptz,
  teacher_name       text,
  group_name         text,
  submission_count   bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    e.id, e.title, e.type, e.duration_minutes, e.is_published,
    e.proctoring_enabled, e.created_at,
    t.full_name AS teacher_name,
    g.name      AS group_name,
    (SELECT count(*) FROM exam_submissions s WHERE s.exam_id = e.id) AS submission_count
  FROM exams e
  LEFT JOIN users  t ON t.id = e.teacher_id
  LEFT JOIN groups g ON g.id = e.group_id
  WHERE e.deleted_at IS NULL
    AND (SELECT current_user_role()) = 'university_admin'
    AND e.tenant_id = (SELECT current_tenant_id())
  ORDER BY e.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION get_admin_exams() TO authenticated;

-- ── Verify (as a university_admin session) ──────────────────
--   SELECT * FROM lessons;   -- should now return 0 rows
--   SELECT * FROM exams;     -- should now return 0 rows
--   SELECT * FROM get_admin_lessons();  -- metadata only, no content column
--   SELECT * FROM get_admin_exams();    -- metadata + submission_count, no questions
