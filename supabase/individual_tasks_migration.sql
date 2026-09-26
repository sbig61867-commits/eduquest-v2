-- ============================================================
-- Migration: individual follow-up tasks (one student, one task)
-- Idempotent, re-runnable. Apply in the Supabase SQL Editor.
-- Apply AFTER course_assessments_migration.sql.
-- ============================================================
--
-- After a written exam a teacher sends each student something different:
-- their weak points, a paragraph or question to rework, sometimes a photo of
-- their own marked paper. Nothing on the platform could be addressed to one
-- student — every exam/homework went to a whole group or course.
--
-- An individual task is an ordinary exams row (type 'homework', so it runs on
-- the same engine: start, draft, submit, server-side grading, results,
-- publishing) with assigned_student_id set. Everything that decides who may
-- see or take an exam learns one extra rule: a row with assigned_student_id is
-- visible to, and startable by, that student only.
--
--   exams.assigned_student_id  the one student it is for (NULL = everyone on the roster)
--   exams.source_exam_id       the exam it follows up, when there is one (paper exams have none)
--   exams.instructions         the teacher's note: weak points, what to do
--   exams.attachments          storage paths in the private exam-files bucket (images)
--   exams.counts_toward_grade  false = feedback/practice only, never in averages
--   exam_submissions.answer_files  {question_id: storage path} photos of the student's answer
--   exam_submissions.teacher_comment  the teacher's written review of the answer
--
-- Files live in a PRIVATE bucket with no storage policies at all: only the
-- service role reads or writes, and pages hand out short-lived signed URLs
-- after their own access check (src/lib/exam-files.ts). A path is never
-- enough to open a file.

-- ── 1. Columns ───────────────────────────────────────────────
ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS assigned_student_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS source_exam_id      uuid REFERENCES public.exams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS instructions        text,
  ADD COLUMN IF NOT EXISTS attachments         jsonb   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS counts_toward_grade boolean NOT NULL DEFAULT true;

ALTER TABLE public.exam_submissions
  ADD COLUMN IF NOT EXISTS answer_files    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS teacher_comment text;

DO $$ BEGIN
  ALTER TABLE public.exams ADD CONSTRAINT exams_attachments_shape
    CHECK (jsonb_typeof(attachments) = 'array' AND jsonb_array_length(attachments) <= 6);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.exams ADD CONSTRAINT exams_instructions_length
    CHECK (instructions IS NULL OR length(instructions) <= 8000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.exam_submissions ADD CONSTRAINT exam_submissions_answer_files_shape
    CHECK (jsonb_typeof(answer_files) = 'object');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.exam_submissions ADD CONSTRAINT exam_submissions_teacher_comment_length
    CHECK (teacher_comment IS NULL OR length(teacher_comment) <= 8000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_exams_assigned_student ON public.exams(assigned_student_id) WHERE assigned_student_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exams_source_exam      ON public.exams(source_exam_id)      WHERE source_exam_id IS NOT NULL;

-- ── 2. The assigned student must be on the exam's own roster ─
-- Defense in depth behind /api/exams/individual: whatever writes the row,
-- an individual task can only point at a member of its group / course.
CREATE OR REPLACE FUNCTION public.assert_exam_assignee_on_roster()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.assigned_student_id IS NULL THEN RETURN NEW; END IF;
  IF NOT (
    (NEW.group_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.group_students WHERE group_id = NEW.group_id AND student_id = NEW.assigned_student_id))
    OR
    (NEW.course_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.course_enrollments WHERE course_id = NEW.course_id AND student_id = NEW.assigned_student_id))
  ) THEN
    RAISE EXCEPTION 'ASSIGNEE_NOT_ON_ROSTER' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.assert_exam_assignee_on_roster() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_exams_assignee_on_roster ON public.exams;
CREATE TRIGGER trg_exams_assignee_on_roster
  BEFORE INSERT OR UPDATE OF assigned_student_id, group_id, course_id ON public.exams
  FOR EACH ROW EXECUTE FUNCTION public.assert_exam_assignee_on_roster();

-- ── 3. Private bucket (no policies: service role only) ───────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('exam-files', 'exam-files', false, 4194304, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── 4. Student feed: another student's individual task never appears ──
-- Changed OUT columns ⇒ DROP first (same as student_exams_expose_type).
DROP FUNCTION IF EXISTS public.get_student_exams();

CREATE FUNCTION public.get_student_exams()
RETURNS TABLE(id uuid, tenant_id uuid, group_id uuid, course_id uuid, teacher_id uuid, title text,
              duration_minutes integer, is_published boolean, proctoring_enabled boolean,
              starts_at timestamptz, ends_at timestamptz, created_at timestamptz,
              questions jsonb, group_name text, course_title text,
              type text, lesson_id uuid,
              assigned_student_id uuid, source_exam_id uuid, instructions text,
              attachments jsonb, counts_toward_grade boolean)
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    e.id, e.tenant_id, e.group_id, e.course_id, e.teacher_id,
    e.title, e.duration_minutes, e.is_published, e.proctoring_enabled,
    e.starts_at, e.ends_at, e.created_at,
    COALESCE(
      (SELECT jsonb_agg(q - 'correct_answer') FROM jsonb_array_elements(e.questions) AS q),
      '[]'::jsonb
    ) AS questions,
    g.name  AS group_name,
    c.title AS course_title,
    COALESCE(e.type, 'exam') AS type,
    e.lesson_id,
    e.assigned_student_id,
    e.source_exam_id,
    e.instructions,
    e.attachments,
    e.counts_toward_grade
  FROM public.exams e
  LEFT JOIN public.groups  g ON g.id = e.group_id
  LEFT JOIN public.courses c ON c.id = e.course_id
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

REVOKE ALL ON FUNCTION public.get_student_exams() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_exams() TO authenticated;

-- ── 5. Starting / proctoring: roster AND, when set, the assignee ─
CREATE OR REPLACE FUNCTION public.start_exam_attempt(p_exam_id uuid, p_student_id uuid, p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _exam           RECORD;
  _row            RECORD;
  _student_tenant uuid;
  _inserted       integer;
BEGIN
  SELECT tenant_id, group_id, course_id, assigned_student_id, is_published, starts_at, ends_at, deleted_at
    INTO _exam
    FROM public.exams
   WHERE id = p_exam_id;
  IF NOT FOUND OR NOT _exam.is_published OR _exam.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'EXAM_NOT_FOUND';
  END IF;

  IF p_tenant_id IS DISTINCT FROM _exam.tenant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH';
  END IF;
  SELECT tenant_id INTO _student_tenant FROM public.users WHERE id = p_student_id;
  IF _student_tenant IS DISTINCT FROM _exam.tenant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH';
  END IF;

  IF NOT (
    (_exam.group_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.group_students
        WHERE group_id = _exam.group_id AND student_id = p_student_id))
    OR
    (_exam.course_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.course_enrollments
        WHERE course_id = _exam.course_id AND student_id = p_student_id))
  ) OR (_exam.assigned_student_id IS NOT NULL AND _exam.assigned_student_id <> p_student_id) THEN
    RAISE EXCEPTION 'NOT_ENROLLED';
  END IF;

  IF _exam.starts_at IS NOT NULL AND now() < _exam.starts_at THEN
    RAISE EXCEPTION 'EXAM_NOT_OPEN';
  END IF;
  IF _exam.ends_at IS NOT NULL AND now() > _exam.ends_at THEN
    RAISE EXCEPTION 'EXAM_CLOSED';
  END IF;

  INSERT INTO public.exam_submissions
         (exam_id, student_id, tenant_id, answers, proctoring_events, status, started_at)
  VALUES (p_exam_id, p_student_id, _exam.tenant_id, '{}'::jsonb, '[]'::jsonb, 'in_progress', now())
  ON CONFLICT (exam_id, student_id) DO NOTHING;
  GET DIAGNOSTICS _inserted = ROW_COUNT;

  SELECT status, started_at, answers_draft
    INTO _row
    FROM public.exam_submissions
   WHERE exam_id = p_exam_id AND student_id = p_student_id;

  IF _row.status = 'submitted' THEN
    RAISE EXCEPTION 'ALREADY_SUBMITTED';
  END IF;

  RETURN jsonb_build_object(
    'started_at',    _row.started_at,
    'resumed',       _inserted = 0,
    'answers_draft', COALESCE(_row.answers_draft, '{}'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.append_proctoring_events(p_exam_id uuid, p_student_id uuid, p_events jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _exam RECORD;
BEGIN
  SELECT group_id, course_id, assigned_student_id INTO _exam FROM public.exams WHERE id = p_exam_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT (
    (_exam.group_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.group_students
        WHERE group_id = _exam.group_id AND student_id = p_student_id))
    OR
    (_exam.course_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.course_enrollments
        WHERE course_id = _exam.course_id AND student_id = p_student_id))
  ) OR (_exam.assigned_student_id IS NOT NULL AND _exam.assigned_student_id <> p_student_id) THEN
    RETURN;
  END IF;

  UPDATE public.exam_submissions
     SET proctoring_events = COALESCE(proctoring_events, '[]'::jsonb) || COALESCE(p_events, '[]'::jsonb)
   WHERE exam_id = p_exam_id AND student_id = p_student_id AND status = 'in_progress';
END $$;

REVOKE ALL ON FUNCTION public.start_exam_attempt(uuid, uuid, uuid)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.append_proctoring_events(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_exam_attempt(uuid, uuid, uuid)       TO service_role;
GRANT EXECUTE ON FUNCTION public.append_proctoring_events(uuid, uuid, jsonb) TO service_role;

-- ── 6. Engagement counts only work set for the whole group ───
-- get_group_engagement / get_tenant_engagement count a group's exams as
-- "assigned" to every member. One student's individual task would inflate
-- everyone else's denominator and drag their submission rate down, so both
-- exclude individual tasks. The two functions are patched in place: the exact
-- text is replaced, the number of replacements is asserted, and a function
-- that already carries the rule is left alone (re-runnable).
DO $$
DECLARE
  fn   regprocedure;
  def  text;
  hits integer;
  old  constant text := 'AND e.deleted_at IS NULL';
BEGIN
  FOREACH fn IN ARRAY ARRAY['public.get_group_engagement(uuid,integer)'::regprocedure,
                            'public.get_tenant_engagement(integer)'::regprocedure]
  LOOP
    def := pg_get_functiondef(fn);
    CONTINUE WHEN position('assigned_student_id' in def) > 0;
    hits := (length(def) - length(replace(def, old, ''))) / length(old);
    IF hits <> 2 THEN
      RAISE EXCEPTION 'unexpected shape of %: % occurrences of "%"', fn, hits, old;
    END IF;
    EXECUTE replace(def, old, old || ' AND e.assigned_student_id IS NULL');
  END LOOP;
END $$;

-- ── Verify ───────────────────────────────────────────────────
SELECT p.proname,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
       position('assigned_student_id' in p.prosrc) > 0             AS knows_assignee
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('get_student_exams', 'start_exam_attempt', 'append_proctoring_events',
                     'get_group_engagement', 'get_tenant_engagement');
