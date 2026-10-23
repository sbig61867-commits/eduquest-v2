-- Neon only (Cloudflare + Neon migration, step 9). Never run on Supabase.
-- Idempotent: safe to run more than once.
--
-- Sign-in accounts moved from Supabase auth.users to Better Auth (ba."user").
-- Two functions still read auth.users (empty on Neon): accept_invitation, to
-- check that a private invitation is accepted by its invitee's email, and
-- check_email_in_auth. They now read ba."user"; nothing else in them changes
-- (bodies copied from the live trial definitions). sync_user_claims wrote
-- roles into Supabase token metadata; its trigger was dropped in 0001 and the
-- function is removed here.

BEGIN;

CREATE OR REPLACE FUNCTION public.check_email_in_auth(p_email text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'auth', 'public', 'pg_temp'
AS $function$ SELECT EXISTS (SELECT 1 FROM ba."user" WHERE lower(email) = lower(p_email)); $function$;

CREATE OR REPLACE FUNCTION public.accept_invitation(p_token text, p_user_id uuid, p_full_name text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  inv          RECORD;
  _target      RECORD;
  _group       RECORD;
  _members     INTEGER;
  _email       TEXT;
BEGIN
  -- K-2: the target account must exist AND still be uninitialised — never
  -- re-provision or upgrade an existing account, and never the owner. The two
  -- routes only ever pass a freshly-created, tenant-less account; this is the
  -- independent DB boundary.
  SELECT role, tenant_id INTO _target FROM public.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_PROFILE_NOT_FOUND';
  END IF;
  IF _target.tenant_id IS NOT NULL OR _target.role = 'super_admin' THEN
    RAISE EXCEPTION 'INVITATION_INVALID_OR_EXPIRED';
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

  -- K-2: a PRIVATE invitation is bound to its invitee's email; the account
  -- accepting it must own that email (case-insensitive, as the routes compare).
  -- Public links carry no email and are unchanged. Checked before anything is
  -- written, so a rejection does not consume the invitation.
  IF NOT inv.is_public THEN
    SELECT email INTO _email FROM ba."user" WHERE id = p_user_id;
    IF inv.email IS NULL OR lower(_email) IS DISTINCT FROM lower(inv.email) THEN
      RAISE EXCEPTION 'INVITATION_INVALID_OR_EXPIRED';
    END IF;
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

DROP FUNCTION IF EXISTS public.sync_user_claims();

-- Accepting an invitation happens before any account or institution context
-- exists, so the route runs these two as app_system (pre-sign-in work only).
GRANT EXECUTE ON FUNCTION public.get_invitation_by_token(text) TO app_system;
GRANT EXECUTE ON FUNCTION public.accept_invitation(text, uuid, text) TO app_system;

COMMIT;
