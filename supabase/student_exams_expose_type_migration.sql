-- ============================================================
-- Migration: expose exams.type / lesson_id in the student feed
-- Apply in Supabase SQL Editor. Idempotent, re-runnable.
-- ============================================================
--
-- Problem
-- -------
-- Homework lives in the `exams` table (type='homework', lesson_id set by
-- homework_exam_migration.sql), but get_student_exams() returned neither
-- column. The student UI therefore had to guess what a row was from its
-- duration sentinel (43200 = 30 days), which is wrong in both directions:
--
--   * a real exam saved with duration 0 or >= 43200 was rendered to the
--     student as untimed homework — no countdown, no auto-submit;
--   * homework created before the sentinel existed (duration 0) only
--     classified correctly by accident.
--
-- Adding the real discriminator to the feed lets the client stop guessing.
-- Nothing is filtered out here: homework is still returned, so the exams
-- page can keep listing it under "الواجبات" as a due-date reminder while
-- the lesson page shows it in its proper place.
--
-- Safety: `type` and `lesson_id` are non-sensitive metadata; correct_answer
-- stripping, the tenant check and the enrolment check are unchanged.

-- Postgres refuses to CREATE OR REPLACE a function whose OUT columns change,
-- so the old signature is dropped first. Same name/arity, so no caller changes.
BEGIN;

DROP FUNCTION IF EXISTS public.get_student_exams();

CREATE FUNCTION public.get_student_exams()
RETURNS TABLE(id uuid, tenant_id uuid, group_id uuid, course_id uuid, teacher_id uuid, title text,
              duration_minutes integer, is_published boolean, proctoring_enabled boolean,
              starts_at timestamptz, ends_at timestamptz, created_at timestamptz,
              questions jsonb, group_name text, course_title text,
              type text, lesson_id uuid)
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
    e.lesson_id
  FROM public.exams e
  LEFT JOIN public.groups  g ON g.id = e.group_id
  LEFT JOIN public.courses c ON c.id = e.course_id
  WHERE e.is_published = true
    AND e.deleted_at IS NULL
    -- Added 2026-09-13: an injected enrolment must never surface another
    -- tenant's exam (finding T10).
    AND e.tenant_id = public.current_tenant_id()
    AND (e.group_id IS NULL OR (g.is_active = true AND g.deleted_at IS NULL))
    AND (
      e.group_id IN (SELECT gs.group_id FROM public.group_students gs WHERE gs.student_id = auth.uid())
      OR e.course_id IN (SELECT ce.course_id FROM public.course_enrollments ce WHERE ce.student_id = auth.uid())
    )
  ORDER BY e.created_at DESC;
$$;

-- Re-assert the grant matrix (rpc_execute_lockdown_migration): anon must not
-- reach this feed, and CREATE OR REPLACE with a changed signature resets ACLs.
REVOKE ALL ON FUNCTION public.get_student_exams() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_exams() TO authenticated;

-- Verify
SELECT has_function_privilege('anon',          'public.get_student_exams()', 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', 'public.get_student_exams()', 'EXECUTE') AS authenticated_can_execute;

COMMIT;

-- ── Rollback ──────────────────────────────────────────────────────────────
-- Restores the pre-migration signature exactly (fix_rls_write_path_migration).
-- The app keeps working either way: without `type` the student UI falls back
-- to the duration sentinel and the lesson page's homework block stays empty.
--
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.get_student_exams();
-- CREATE FUNCTION public.get_student_exams()
-- RETURNS TABLE(id uuid, tenant_id uuid, group_id uuid, course_id uuid, teacher_id uuid, title text,
--               duration_minutes integer, is_published boolean, proctoring_enabled boolean,
--               starts_at timestamptz, ends_at timestamptz, created_at timestamptz,
--               questions jsonb, group_name text, course_title text)
-- LANGUAGE sql SECURITY DEFINER
-- SET search_path = public, pg_temp
-- AS $$
--   SELECT
--     e.id, e.tenant_id, e.group_id, e.course_id, e.teacher_id,
--     e.title, e.duration_minutes, e.is_published, e.proctoring_enabled,
--     e.starts_at, e.ends_at, e.created_at,
--     COALESCE(
--       (SELECT jsonb_agg(q - 'correct_answer') FROM jsonb_array_elements(e.questions) AS q),
--       '[]'::jsonb
--     ) AS questions,
--     g.name  AS group_name,
--     c.title AS course_title
--   FROM public.exams e
--   LEFT JOIN public.groups  g ON g.id = e.group_id
--   LEFT JOIN public.courses c ON c.id = e.course_id
--   WHERE e.is_published = true
--     AND e.deleted_at IS NULL
--     AND e.tenant_id = public.current_tenant_id()
--     AND (e.group_id IS NULL OR (g.is_active = true AND g.deleted_at IS NULL))
--     AND (
--       e.group_id IN (SELECT gs.group_id FROM public.group_students gs WHERE gs.student_id = auth.uid())
--       OR e.course_id IN (SELECT ce.course_id FROM public.course_enrollments ce WHERE ce.student_id = auth.uid())
--     )
--   ORDER BY e.created_at DESC;
-- $$;
-- REVOKE ALL ON FUNCTION public.get_student_exams() FROM PUBLIC, anon;
-- GRANT EXECUTE ON FUNCTION public.get_student_exams() TO authenticated;
-- COMMIT;
