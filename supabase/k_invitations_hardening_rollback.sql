-- Rollback for k_invitations_hardening_migration.sql — restores the exact pre-K live definitions.
-- WARNING: this re-opens the privilege-escalation + email-exposure holes. Use only to recover.

-- K-1: back to tenant-wide visibility (rls_performance_migration.sql form).
ALTER POLICY invitations_select ON public.invitations USING (
  (SELECT current_user_role()) = 'super_admin' OR tenant_id = (SELECT current_tenant_id())
);

-- K-2: back to the pre-K accept_invitation body (md5 9994b594e75c58bfd84875b8303284bd).
CREATE OR REPLACE FUNCTION public.accept_invitation(p_token text, p_user_id uuid, p_full_name text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
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

  IF NOT EXISTS (
    SELECT 1 FROM public.tenants t WHERE t.id = inv.tenant_id AND t.is_active
  ) THEN
    RAISE EXCEPTION 'INVITATION_INVALID_OR_EXPIRED';
  END IF;

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
