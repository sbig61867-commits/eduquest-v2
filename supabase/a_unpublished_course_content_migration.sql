-- A — unpublished course content (security review 2026-10-04).
--
-- course_levels_select / course_units_select / unit_items_select only required the parent course to be visible
-- (security_audit_2026-09-04_migration.sql: "the row is visible exactly when the parent course row is visible").
-- For a student, courses_select shows a course once it is published and they are enrolled, so an enrolled student
-- could read through REST every level, unit and item of that course, drafts included, with their full `content`
-- (text, video link, exam id). The course player drops drafts before rendering ("Drops unpublished units/items so a
-- student never sees draft content"), so the policies did not hold the product's own rule. Not intentional: the
-- 2026-09-04 audit scoped these rows to their course and never added the publication condition.
--
-- Fix — the STUDENT branch only: a student sees a row only when its whole publication chain is published:
--   * level: the level is published;
--   * unit:  the unit is published, and its level (if it has one) is published;
--   * item:  the item is published, its unit is published, and that unit's level (if any) is published;
-- the course itself stays covered by the unchanged EXISTS on courses (courses_select: published + enrolled for a
-- student). Every other role — and a session without a profile row (role NULL, IS DISTINCT FROM 'student') — keeps
-- exactly the previous predicate: each USING is the pre-A predicate, unchanged, AND (role is not 'student' OR chain).
-- The role helper is wrapped in (SELECT …) (init-plan, once per query — P-09).
--
-- Out of scope (unchanged): write policies (can_edit_course), courses_select, the SECURITY DEFINER functions that read
-- these tables (get_course_progress, get_course_analytics, get_center_dashboard, get_group_engagement,
-- transfer_student_group — owner postgres, no FORCE RLS, so RLS does not apply to them), student_progress, and
-- application code (the player already drops drafts; it now receives fewer rows and renders the same output).
-- schema.sql is NOT updated: it does not contain these tables or policies (courses_migration.sql /
-- security_audit_2026-09-04_migration.sql only).
--
-- Idempotent (ALTER POLICY can be re-run). Rollback: supabase/a_unpublished_course_content_rollback.sql.
-- Regression check: supabase/tests/course_content_publication_check.sql.

ALTER POLICY course_levels_select ON public.course_levels USING (
  EXISTS (SELECT 1 FROM public.courses c WHERE c.id = course_levels.course_id)
  AND (
    (SELECT public.current_user_role()) IS DISTINCT FROM 'student'
    OR course_levels.is_published
  )
);

ALTER POLICY course_units_select ON public.course_units USING (
  EXISTS (SELECT 1 FROM public.courses c WHERE c.id = course_units.course_id)
  AND (
    (SELECT public.current_user_role()) IS DISTINCT FROM 'student'
    OR (
      course_units.is_published
      AND (
        course_units.level_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.course_levels l
          WHERE l.id = course_units.level_id AND l.is_published
        )
      )
    )
  )
);

ALTER POLICY unit_items_select ON public.unit_items USING (
  EXISTS (
    SELECT 1
    FROM public.course_units cu
    JOIN public.courses c ON c.id = cu.course_id
    WHERE cu.id = unit_items.unit_id
  )
  AND (
    (SELECT public.current_user_role()) IS DISTINCT FROM 'student'
    OR (
      unit_items.is_published
      AND EXISTS (
        SELECT 1 FROM public.course_units pu
        WHERE pu.id = unit_items.unit_id
          AND pu.is_published
          AND (
            pu.level_id IS NULL
            OR EXISTS (
              SELECT 1 FROM public.course_levels pl
              WHERE pl.id = pu.level_id AND pl.is_published
            )
          )
      )
    )
  )
);
