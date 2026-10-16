-- =============================================================================
-- get_course_progress: teacher scope (security review 2026-10-16, item P4)
-- =============================================================================
-- Before: any teacher could read the progress of ANY student of their
-- institution in ANY course of it — the only check was "same tenant".
-- After: a teacher reads a student's progress in a course only when they
--   (a) own the course (courses.teacher_id), or
--   (b) teach a live group linked to that course in which the student is a member.
-- Unchanged: the student reading their own progress, super_admin, and
-- university_admin within their institution (progress is a count, which the
-- metadata-only admin rule allows). Both tenant checks stay for every role.
--
-- Callers (2026-10-16): src/lib/data/student-courses.ts only, always for the
-- signed-in student's own id — the teacher branch has no app caller today, so
-- this narrows an API surface without changing any screen.
--
-- Body, counting rule, signature, SECURITY DEFINER, search_path and grants are
-- identical to the live definition; only the IF NOT (...) block changes.
-- CREATE OR REPLACE keeps the existing ACL; the REVOKE/GRANT restate it.
--
-- Idempotent. Rollback: supabase/get_course_progress_teacher_scope_rollback.sql
-- Check:    supabase/tests/get_course_progress_teacher_scope_check.sql
-- =============================================================================

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
  _course_teacher uuid;
  _student_tenant uuid;
  _role           text := public.current_user_role();
BEGIN
  SELECT tenant_id, teacher_id INTO _course_tenant, _course_teacher FROM public.courses WHERE id = p_course_id;
  SELECT tenant_id INTO _student_tenant FROM public.users WHERE id = p_student_id;

  IF NOT (
    auth.uid() = p_student_id
    OR _role = 'super_admin'
    OR ( public.current_tenant_id() IS NOT NULL
         AND public.current_tenant_id() = _course_tenant
         AND public.current_tenant_id() = _student_tenant
         AND ( _role = 'university_admin'
               OR ( _role = 'teacher'
                    AND ( _course_teacher = auth.uid()
                          OR EXISTS (
                               SELECT 1
                               FROM public.groups g
                               JOIN public.group_students gs ON gs.group_id = g.id
                               WHERE g.course_id   = p_course_id
                                 AND g.teacher_id  = auth.uid()
                                 AND g.deleted_at IS NULL
                                 AND gs.student_id = p_student_id ) ) ) ) )
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  -- course_units.course_id is NOT NULL for both leveled and flat units, so this
  -- counts flat courses correctly where the course_levels join did not.
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

REVOKE ALL ON FUNCTION public.get_course_progress(uuid, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_course_progress(uuid, uuid) TO authenticated, service_role;
