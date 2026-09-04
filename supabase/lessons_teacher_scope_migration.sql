-- ============================================================
-- Scope lesson reads to their owner — 2026-09-04
-- Idempotent + re-runnable. Apply in the Supabase SQL Editor
-- (or via the Management API /database/query endpoint).
--
-- Problem (verified live with a real teacher session): lessons_select
-- granted ANY teacher in the tenant read access to EVERY lesson in that
-- tenant, including other teachers' unpublished drafts. A brand-new
-- teacher account could read another teacher's draft "الوحدة الاولى".
--
-- Target model (owner's spec):
--   university_admin -> everything in their institution
--   teacher          -> only lessons they created (or lessons sitting in
--                       a group they own, so a co-taught group still works)
--   student          -> only published lessons in groups they belong to
--
-- Safe to apply: the teacher lessons page already filters by
-- .eq('teacher_id', user.id), and lessons_update already restricts
-- teachers to their own rows — this closes the READ side to match.
-- ============================================================

DROP POLICY IF EXISTS "lessons_select" ON lessons;

CREATE POLICY "lessons_select" ON lessons FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      (SELECT current_user_role()) = 'super_admin'

      -- university_admin: full visibility inside their own institution
      OR (
        (SELECT current_user_role()) = 'university_admin'
        AND tenant_id = (SELECT current_tenant_id())
      )

      -- teacher: own lessons, plus anything in a group they own
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

      -- student: published lessons in groups they are enrolled in
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

-- ── Verify (as a teacher session) ───────────────────────────
--   SELECT id, title, teacher_id FROM lessons;
-- should return only rows where teacher_id = auth.uid(), or rows whose
-- group_id belongs to a group that teacher owns.
