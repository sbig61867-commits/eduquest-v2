-- Applied live 2026-09-06 (migration 20260906171753). Recorded here per the
-- repo's own convention.
--
-- get_course_progress authorized any 'teacher'/'university_admin'/'super_admin'
-- role globally without checking tenant ownership of p_course_id/p_student_id.
-- A teacher in Tenant B could call get_course_progress(courseA, studentA) and
-- read Tenant A's student progress. Fix: teacher/university_admin must share
-- the tenant of BOTH the course and the target student; super_admin unchanged.
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
  SELECT tenant_id INTO _course_tenant FROM public.courses WHERE id = p_course_id;
  SELECT tenant_id INTO _student_tenant FROM public.users WHERE id = p_student_id;

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

  SELECT COUNT(*) INTO total_items
  FROM unit_items ui
  JOIN course_units cu ON cu.id = ui.unit_id
  JOIN course_levels cl ON cl.id = cu.level_id
  WHERE cl.course_id = p_course_id
    AND ui.is_published = TRUE;

  SELECT COUNT(*) INTO completed_items
  FROM student_progress sp
  JOIN unit_items ui ON ui.id = sp.unit_item_id
  JOIN course_units cu ON cu.id = ui.unit_id
  JOIN course_levels cl ON cl.id = cu.level_id
  WHERE cl.course_id = p_course_id
    AND sp.student_id = p_student_id;

  RETURN json_build_object(
    'total',     total_items,
    'completed', completed_items,
    'percent',   CASE WHEN total_items = 0 THEN 0
                      ELSE ROUND((completed_items::NUMERIC / total_items) * 100)
                 END
  );
END;
$function$;
