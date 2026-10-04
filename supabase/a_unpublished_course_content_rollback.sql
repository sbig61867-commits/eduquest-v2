-- Rollback for a_unpublished_course_content_migration.sql — restores the exact pre-A live definitions
-- (security_audit_2026-09-04_migration.sql form: visible exactly when the parent course is visible).
-- WARNING: this re-opens the gap — an enrolled student can again read the course's draft levels, units and items
-- (with their content) through REST. Use only to recover.

ALTER POLICY course_levels_select ON public.course_levels USING (
  EXISTS (SELECT 1 FROM public.courses c WHERE c.id = course_levels.course_id)
);

ALTER POLICY course_units_select ON public.course_units USING (
  EXISTS (SELECT 1 FROM public.courses c WHERE c.id = course_units.course_id)
);

ALTER POLICY unit_items_select ON public.unit_items USING (
  EXISTS (
    SELECT 1
    FROM public.course_units cu
    JOIN public.courses c ON c.id = cu.course_id
    WHERE cu.id = unit_items.unit_id
  )
);
