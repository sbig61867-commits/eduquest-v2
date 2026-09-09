-- Applied live 2026-09-09 (migration fix_get_course_progress_flat_courses).
-- Re-runnable. Recorded here per the repo's own convention.
--
-- Bug: get_course_progress counts items with
--   JOIN course_units cu ON cu.id = ui.unit_id
--   JOIN course_levels cl ON cl.id = cu.level_id
-- an INNER join through course_levels. Flat courses (courses.has_levels = FALSE)
-- store their units with course_units.level_id IS NULL, so the join drops every
-- row and the RPC returns total = 0, completed = 0, percent = 0 for them —
-- permanently. Every flat course on /student/courses renders a 0% progress bar
-- no matter how much the student has finished.
--
-- Second defect in the same function: completed_items had no
-- ui.is_published = TRUE filter while total_items did. A student who completed
-- an item that was later unpublished could score completed > total, i.e. a
-- percent above 100.
--
-- Fix: count through course_units.course_id directly (correct for both leveled
-- and flat courses) and apply the same published filter to both counts.
-- Authorization logic is carried over verbatim from
-- fix_get_course_progress_cross_tenant_idor_migration.sql — unchanged.

CREATE OR REPLACE FUNCTION public.get_course_progress(p_course_id uuid, p_student_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  total_items     INTEGER;
  completed_items INTEGER;
  _course_tenant  uuid;
  _student_tenant uuid;
BEGIN
  SELECT tenant_id INTO _course_tenant  FROM public.courses WHERE id = p_course_id;
  SELECT tenant_id INTO _student_tenant FROM public.users   WHERE id = p_student_id;

  IF NOT (
    auth.uid() = p_student_id
    OR public.current_user_role() = 'super_admin'
    OR ( public.current_user_role() IN ('teacher','university_admin')
         AND public.current_tenant_id() IS NOT NULL
         AND public.current_tenant_id() = _course_tenant
         AND public.current_tenant_id() = _student_tenant )
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  -- course_units.course_id is NOT NULL for both leveled and flat units, so
  -- this counts flat courses correctly where the course_levels join did not.
  SELECT COUNT(*) INTO total_items
  FROM public.unit_items ui
  JOIN public.course_units cu ON cu.id = ui.unit_id
  WHERE cu.course_id = p_course_id
    AND ui.is_published = TRUE;

  SELECT COUNT(*) INTO completed_items
  FROM public.student_progress sp
  JOIN public.unit_items ui   ON ui.id = sp.unit_item_id
  JOIN public.course_units cu ON cu.id = ui.unit_id
  WHERE cu.course_id = p_course_id
    AND sp.student_id = p_student_id
    AND ui.is_published = TRUE;

  RETURN json_build_object(
    'total',     total_items,
    'completed', completed_items,
    'percent',   CASE WHEN total_items = 0 THEN 0
                      ELSE ROUND((completed_items::NUMERIC / total_items) * 100)
                 END
  );
END;
$function$;

-- Grant matrix unchanged from rpc_execute_lockdown_migration.sql: anon must not
-- reach this function; authenticated callers are gated by the check above.
REVOKE ALL ON FUNCTION public.get_course_progress(uuid, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_course_progress(uuid, uuid) TO authenticated;
