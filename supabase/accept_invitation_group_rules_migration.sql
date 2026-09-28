-- ============================================================
-- accept_invitation: apply the group rules from group_course_transfer_migration
--
-- Joining a group by invitation skipped the two rules every other path
-- enforces (/api/group-students, transfer_student_group()):
--   1. groups.max_students — a public multi-use link let unlimited students
--      into a capped group.
--   2. groups.course_id    — a group that is a section of a course also
--      enrols its students in that course; invitees got the group only.
--
-- Now, for a student invitation with a group:
--   * the group row is locked FOR UPDATE (serialises concurrent joins, so N
--     racing accepts cannot overshoot the cap) and a full group raises
--     GROUP_FULL — the whole transaction rolls back, the invitation use is
--     NOT consumed;
--   * the group's linked course (if any) gets a course_enrollments row.
--
-- Built on the definition from fix_admin_user_escalation_migration.sql
-- (suspended-tenant refusal, finding F3) — keep that check. An earlier draft
-- of this file was built on the pre-F3 definition and, applied on
-- 2026-09-28, briefly dropped the suspended-tenant check; this version
-- restores it.
-- Callers: api/auth/accept-invitation (maps GROUP_FULL → 409) and
-- auth/callback (any RPC error falls through to its reject path).
-- Apply AFTER fix_admin_user_escalation_migration.sql. Idempotent / re-runnable.
-- ============================================================

CREATE OR REPLACE FUNCTION public.accept_invitation(p_token text, p_user_id uuid, p_full_name text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  inv          RECORD;
  _user_exists BOOLEAN;
  _group       RECORD;
  _members     INTEGER;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) INTO _user_exists;
  IF NOT _user_exists THEN
    RAISE EXCEPTION 'USER_PROFILE_NOT_FOUND';
  END IF;

  SELECT * INTO inv
  FROM public.invitations
  WHERE token     = p_token
    AND status    = 'pending'
    AND expires_at > NOW()
    AND (max_uses IS NULL OR use_count < max_uses)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_INVALID_OR_EXPIRED';
  END IF;

  -- Added 2026-09-27 (finding F3): a suspended institution admits nobody.
  IF NOT EXISTS (
    SELECT 1 FROM public.tenants t WHERE t.id = inv.tenant_id AND t.is_active
  ) THEN
    RAISE EXCEPTION 'INVITATION_INVALID_OR_EXPIRED';
  END IF;

  -- Added 2026-09-13 (finding T03): a group/course on the invitation must
  -- belong to the invitation's own tenant.
  IF inv.group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.groups g WHERE g.id = inv.group_id AND g.tenant_id = inv.tenant_id
  ) THEN
    RAISE EXCEPTION 'INVITATION_INVALID_OR_EXPIRED';
  END IF;
  IF inv.course_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.courses c WHERE c.id = inv.course_id AND c.tenant_id = inv.tenant_id
  ) THEN
    RAISE EXCEPTION 'INVITATION_INVALID_OR_EXPIRED';
  END IF;

  -- Group seat cap (NULL = no cap). Checked before anything is written.
  IF inv.group_id IS NOT NULL AND inv.role = 'student' THEN
    SELECT id, max_students, course_id INTO _group
      FROM public.groups WHERE id = inv.group_id
      FOR UPDATE;
    IF _group.max_students IS NOT NULL THEN
      SELECT count(*) INTO _members FROM public.group_students WHERE group_id = inv.group_id;
      IF _members >= _group.max_students THEN
        RAISE EXCEPTION 'GROUP_FULL';
      END IF;
    END IF;
  END IF;

  IF inv.is_public THEN
    UPDATE public.invitations
    SET use_count = use_count + 1,
        status    = CASE
                      WHEN max_uses IS NOT NULL AND (use_count + 1) >= max_uses THEN 'revoked'
                      ELSE 'pending'
                    END
    WHERE id = inv.id;
  ELSE
    UPDATE public.invitations
    SET status = 'accepted', accepted_at = NOW(), accepted_by = p_user_id
    WHERE id = inv.id;
  END IF;

  UPDATE public.users
  SET role = inv.role, tenant_id = inv.tenant_id, full_name = p_full_name
  WHERE id = p_user_id;

  IF inv.group_id IS NOT NULL AND inv.role = 'student' THEN
    INSERT INTO public.group_students (group_id, student_id)
    VALUES (inv.group_id, p_user_id)
    ON CONFLICT DO NOTHING;

    -- A group that is a section of a course also enrols its students in it.
    IF _group.course_id IS NOT NULL THEN
      INSERT INTO public.course_enrollments (course_id, student_id, tenant_id)
      VALUES (_group.course_id, p_user_id, inv.tenant_id)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  IF inv.course_id IS NOT NULL AND inv.role = 'student' THEN
    INSERT INTO public.course_enrollments (course_id, student_id, tenant_id)
    VALUES (inv.course_id, p_user_id, inv.tenant_id)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN json_build_object('role', inv.role, 'tenant_id', inv.tenant_id,
                           'group_id', inv.group_id, 'course_id', inv.course_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_invitation(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_invitation(text, uuid, text) TO service_role;
