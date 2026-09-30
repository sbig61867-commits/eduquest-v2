-- ============================================================
-- Batch 1 (Performance Contract P3): the student exam list without questions.
--
-- get_student_exams() returns every question (minus correct_answer) of every
-- published exam a student can see — to show a title, a date and a count.
-- Measured on a synthetic institution (PERFORMANCE_BASELINE.md §3): 50 exams ×
-- 40 questions = 1 718 KB, 30 KB without the questions. It is called from 11
-- places, one of them polled every 5 minutes and one in the browser. It also
-- hands a student the questions of an exam whose window has NOT OPENED yet
-- (the feed has no starts_at filter), long before /api/exam/start would let
-- them begin.
--
-- get_student_exam_list() is the same rows, the same authorization — the WHERE
-- clause is copied verbatim from the live get_student_exams() (as defined by
-- individual_tasks_migration.sql) — with the questions replaced by the three
-- facts the list screens actually use:
--   question_count        the "N questions" label
--   has_manual_questions  isScoreVisible(): an exam with a question the teacher
--                         grades by hand hides its auto score until published
--                         (mirrors isAutoGradable in src/lib/score-visibility.ts:
--                         a missing/empty type, 'mcq' and 'true_false' are auto)
--   total_points          the grades page's max-score fallback
-- The questions themselves now come only from /api/exam/start, after the
-- roster, the window and SEB have been checked and the attempt exists.
--
-- PART A (this file) is additive and safe to apply BEFORE the code ships: the
-- old feed keeps working for the deployed code. PART B
-- (student_exam_list_lockdown_migration.sql) revokes the old feed from
-- students and must be applied only AFTER the new code is live.
--
-- Idempotent. Regression check: supabase/tests/student_exam_list_check.sql.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_student_exam_list();

CREATE FUNCTION public.get_student_exam_list()
RETURNS TABLE(id uuid, tenant_id uuid, group_id uuid, course_id uuid, teacher_id uuid, title text,
              duration_minutes integer, is_published boolean, proctoring_enabled boolean,
              starts_at timestamptz, ends_at timestamptz, created_at timestamptz,
              group_name text, course_title text,
              type text, lesson_id uuid,
              assigned_student_id uuid, source_exam_id uuid, instructions text,
              attachments jsonb, counts_toward_grade boolean,
              question_count integer, has_manual_questions boolean, total_points numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    e.id, e.tenant_id, e.group_id, e.course_id, e.teacher_id,
    e.title, e.duration_minutes, e.is_published, e.proctoring_enabled,
    e.starts_at, e.ends_at, e.created_at,
    g.name  AS group_name,
    c.title AS course_title,
    COALESCE(e.type, 'exam') AS type,
    e.lesson_id,
    e.assigned_student_id,
    e.source_exam_id,
    e.instructions,
    e.attachments,
    e.counts_toward_grade,
    qs.question_count,
    qs.has_manual_questions,
    qs.total_points
  FROM public.exams e
  LEFT JOIN public.groups  g ON g.id = e.group_id
  LEFT JOIN public.courses c ON c.id = e.course_id
  CROSS JOIN LATERAL (
    SELECT
      count(q)::integer AS question_count,
      COALESCE(bool_or(COALESCE(q->>'type', '') NOT IN ('', 'mcq', 'true_false')), false) AS has_manual_questions,
      COALESCE(sum(CASE WHEN jsonb_typeof(q->'points') = 'number' THEN (q->'points')::numeric ELSE 0 END), 0) AS total_points
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(e.questions) = 'array' THEN e.questions ELSE '[]'::jsonb END) AS q
  ) qs
  WHERE e.is_published = true
    AND e.deleted_at IS NULL
    AND e.tenant_id = public.current_tenant_id()
    AND (e.group_id IS NULL OR (g.is_active = true AND g.deleted_at IS NULL))
    AND (
      e.group_id IN (SELECT gs.group_id FROM public.group_students gs WHERE gs.student_id = auth.uid())
      OR e.course_id IN (SELECT ce.course_id FROM public.course_enrollments ce WHERE ce.student_id = auth.uid())
    )
    -- An individual task belongs to its one student.
    AND (e.assigned_student_id IS NULL OR e.assigned_student_id = auth.uid())
  ORDER BY e.created_at DESC;
$$;

-- anon inherits EXECUTE through PUBLIC, so revoking from anon alone is not enough.
REVOKE ALL ON FUNCTION public.get_student_exam_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_exam_list() TO authenticated;

-- Verification
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_can_execute,        -- expect false
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute, -- expect true
       p.proconfig                                               AS config                  -- expect search_path pinned
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'get_student_exam_list';
