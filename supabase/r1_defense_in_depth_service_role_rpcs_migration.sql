-- Applied live 2026-09-06 (migrations 20260906180509 + 20260906182236,
-- combined here into one file). Recorded per the repo's own convention.
--
-- R-1: start_exam_attempt, soft_delete_entity, restore_entity, and
-- append_proctoring_events are service_role-only (not directly
-- PostgREST-callable), so auth.uid() is NOT usable inside them for
-- re-authorization — the service-role client carries no end-user JWT.
-- Defense-in-depth here instead means: never trust a caller-supplied
-- tenant_id/actor/student_id at face value — re-derive the real facts
-- (exam's real tenant, real enrollment, actor's real role+tenant) from
-- authoritative tables and enforce internally, so a bug in ANY current or
-- future caller cannot silently produce a cross-tenant or unauthorized write.

-- 1) start_exam_attempt: ignore p_tenant_id, derive the exam's real
--    tenant_id; verify the exam exists/is published/is within its time
--    window; verify p_student_id is actually enrolled in the exam's group.
CREATE OR REPLACE FUNCTION public.start_exam_attempt(p_exam_id uuid, p_student_id uuid, p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _row  RECORD;
  _exam RECORD;
BEGIN
  SELECT tenant_id, group_id, is_published, starts_at, ends_at
    INTO _exam
  FROM public.exams
  WHERE id = p_exam_id;
  IF NOT FOUND OR NOT _exam.is_published THEN
    RAISE EXCEPTION 'EXAM_NOT_FOUND';
  END IF;

  IF p_tenant_id IS DISTINCT FROM _exam.tenant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.group_students
    WHERE group_id = _exam.group_id AND student_id = p_student_id
  ) THEN
    RAISE EXCEPTION 'NOT_ENROLLED';
  END IF;

  IF _exam.starts_at IS NOT NULL AND now() < _exam.starts_at THEN
    RAISE EXCEPTION 'EXAM_NOT_OPEN';
  END IF;
  IF _exam.ends_at IS NOT NULL AND now() > _exam.ends_at THEN
    RAISE EXCEPTION 'EXAM_CLOSED';
  END IF;

  SELECT status, started_at INTO _row FROM public.exam_submissions
  WHERE exam_id = p_exam_id AND student_id = p_student_id;
  IF FOUND THEN
    IF _row.status = 'submitted' THEN RAISE EXCEPTION 'ALREADY_SUBMITTED'; END IF;
    RETURN jsonb_build_object('started_at', _row.started_at, 'resumed', true);
  END IF;

  INSERT INTO public.exam_submissions (exam_id, student_id, tenant_id, answers, proctoring_events, status, started_at)
  VALUES (p_exam_id, p_student_id, _exam.tenant_id, '{}'::jsonb, '[]'::jsonb, 'in_progress', now());
  RETURN jsonb_build_object('started_at', now(), 'resumed', false);
END $function$;

-- 2) soft_delete_entity: verify p_actor's real role+tenant (from `users`)
--    matches p_tenant_id (or is super_admin), and for a `teacher` actor,
--    verify they actually own the target entity (teacher_id match) before
--    soft-deleting.
CREATE OR REPLACE FUNCTION public.soft_delete_entity(p_kind text, p_id uuid, p_actor uuid, p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _now TIMESTAMPTZ := now();
  _actor_role text;
  _actor_tenant uuid;
  _entity_tenant uuid;
  _entity_teacher uuid;
BEGIN
  SELECT role, tenant_id INTO _actor_role, _actor_tenant
  FROM public.users WHERE id = p_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACTOR_NOT_FOUND'; END IF;

  IF _actor_role <> 'super_admin' AND _actor_tenant IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'ACTOR_TENANT_MISMATCH';
  END IF;
  IF _actor_role NOT IN ('teacher', 'university_admin', 'center_manager', 'super_admin') THEN
    RAISE EXCEPTION 'FORBIDDEN_ROLE';
  END IF;

  IF p_kind = 'group' THEN
    SELECT tenant_id, teacher_id INTO _entity_tenant, _entity_teacher FROM public.groups WHERE id = p_id;
  ELSIF p_kind = 'lesson' THEN
    SELECT tenant_id, teacher_id INTO _entity_tenant, _entity_teacher FROM public.lessons WHERE id = p_id;
  ELSIF p_kind = 'exam' THEN
    SELECT tenant_id, teacher_id INTO _entity_tenant, _entity_teacher FROM public.exams WHERE id = p_id;
  ELSIF p_kind = 'course' THEN
    SELECT tenant_id, teacher_id INTO _entity_tenant, _entity_teacher FROM public.courses WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'UNKNOWN_KIND';
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'ENTITY_NOT_FOUND'; END IF;
  IF _entity_tenant IS DISTINCT FROM p_tenant_id THEN RAISE EXCEPTION 'ENTITY_TENANT_MISMATCH'; END IF;
  IF _actor_role = 'teacher' AND _entity_teacher IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'NOT_OWNER';
  END IF;

  IF p_kind = 'group' THEN
    UPDATE groups  SET deleted_at = _now, deleted_by = p_actor
      WHERE id = p_id AND tenant_id = p_tenant_id AND deleted_at IS NULL;
    UPDATE lessons SET deleted_at = _now, deleted_by = p_actor
      WHERE group_id = p_id AND deleted_at IS NULL;
    UPDATE exams   SET deleted_at = _now, deleted_by = p_actor
      WHERE group_id = p_id AND deleted_at IS NULL;

  ELSIF p_kind = 'lesson' THEN
    UPDATE lessons SET deleted_at = _now, deleted_by = p_actor
      WHERE id = p_id AND tenant_id = p_tenant_id AND deleted_at IS NULL;
    UPDATE exams   SET deleted_at = _now, deleted_by = p_actor
      WHERE lesson_id = p_id AND deleted_at IS NULL;

  ELSIF p_kind = 'exam' THEN
    UPDATE exams   SET deleted_at = _now, deleted_by = p_actor
      WHERE id = p_id AND tenant_id = p_tenant_id AND deleted_at IS NULL;

  ELSIF p_kind = 'course' THEN
    UPDATE courses SET deleted_at = _now, deleted_by = p_actor
      WHERE id = p_id AND tenant_id = p_tenant_id AND deleted_at IS NULL;
  END IF;

  RETURN jsonb_build_object('ok', true, 'kind', p_kind, 'id', p_id, 'deleted_at', _now);
END $function$;

-- 3) restore_entity: add p_actor (new param — caller updated in the same
--    commit) and verify actor's real role+tenant the same way.
CREATE OR REPLACE FUNCTION public.restore_entity(p_kind text, p_id uuid, p_tenant_id uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _actor_role text;
  _actor_tenant uuid;
  _entity_tenant uuid;
BEGIN
  SELECT role, tenant_id INTO _actor_role, _actor_tenant
  FROM public.users WHERE id = p_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACTOR_NOT_FOUND'; END IF;

  IF _actor_role NOT IN ('university_admin', 'super_admin') THEN
    RAISE EXCEPTION 'FORBIDDEN_ROLE';
  END IF;
  IF _actor_role = 'university_admin' AND _actor_tenant IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'ACTOR_TENANT_MISMATCH';
  END IF;

  IF    p_kind = 'group'  THEN SELECT tenant_id INTO _entity_tenant FROM groups  WHERE id = p_id;
  ELSIF p_kind = 'lesson' THEN SELECT tenant_id INTO _entity_tenant FROM lessons WHERE id = p_id;
  ELSIF p_kind = 'exam'   THEN SELECT tenant_id INTO _entity_tenant FROM exams   WHERE id = p_id;
  ELSIF p_kind = 'course' THEN SELECT tenant_id INTO _entity_tenant FROM courses WHERE id = p_id;
  ELSE RAISE EXCEPTION 'UNKNOWN_KIND';
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'ENTITY_NOT_FOUND'; END IF;
  IF _entity_tenant IS DISTINCT FROM p_tenant_id THEN RAISE EXCEPTION 'ENTITY_TENANT_MISMATCH'; END IF;

  IF    p_kind = 'group'  THEN UPDATE groups  SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id AND tenant_id = p_tenant_id;
  ELSIF p_kind = 'lesson' THEN UPDATE lessons SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id AND tenant_id = p_tenant_id;
  ELSIF p_kind = 'exam'   THEN UPDATE exams   SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id AND tenant_id = p_tenant_id;
  ELSIF p_kind = 'course' THEN UPDATE courses SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id AND tenant_id = p_tenant_id;
  END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- Old restore_entity(text, uuid, uuid) 3-arg signature no longer used by
-- the app (caller updated to pass p_actor) — drop it so a stale caller
-- can't silently keep hitting the unguarded version.
DROP FUNCTION IF EXISTS public.restore_entity(text, uuid, uuid);

REVOKE ALL ON FUNCTION public.start_exam_attempt(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.soft_delete_entity(text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.restore_entity(text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_exam_attempt(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.soft_delete_entity(text, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_entity(text, uuid, uuid, uuid) TO service_role;

-- 4) append_proctoring_events: same class as above — verify enrollment
--    internally instead of trusting p_student_id outright. Lower severity
--    than the three above (UPDATE-only against a pre-existing row, no
--    read/leak was ever possible), added here for consistency.
CREATE OR REPLACE FUNCTION public.append_proctoring_events(p_exam_id uuid, p_student_id uuid, p_events jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE _group_id uuid;
BEGIN
  SELECT group_id INTO _group_id FROM public.exams WHERE id = p_exam_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.group_students
    WHERE group_id = _group_id AND student_id = p_student_id
  ) THEN
    RETURN;
  END IF;

  UPDATE public.exam_submissions
  SET proctoring_events = COALESCE(proctoring_events, '[]'::jsonb) || COALESCE(p_events, '[]'::jsonb)
  WHERE exam_id = p_exam_id AND student_id = p_student_id AND status = 'in_progress';
END $function$;

REVOKE ALL ON FUNCTION public.append_proctoring_events(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_proctoring_events(uuid, uuid, jsonb) TO service_role;
