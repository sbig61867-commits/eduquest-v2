-- K — invitation privilege-escalation + email-exposure fix (security review 2026-10-04).
--
-- Two independent controls; K is only remediated with BOTH (see the K Gate 1 audit).
--
-- K-1 — token discovery. invitations_select was `role=super_admin OR tenant_id=current_tenant_id()`, so EVERY
--   user in a tenant — including a student — could read every invitation row of that tenant, with its `token`
--   (a bearer secret) and the invitee `email`. A student could lift an active PUBLIC teacher link's token and
--   create a teacher account (privilege escalation), and read the invitee emails of admin / centre-manager links.
--   Now: super_admin → all; university_admin / center_manager → their institution (unchanged); everyone else →
--   only invitations they created (invited_by = auth.uid()). A student creates no invitations, so sees none. The
--   GET /api/invitations screen already scoped a teacher to invited_by = self and showed no screen to a student,
--   so no application behaviour changes. Helper calls are wrapped in (SELECT …) (init-plan, P-09).
--
-- K-2 — token use. accept_invitation() (service-role only) trusted its p_user_id and never checked the invitee
--   email, so a valid token used with any supplied account id would provision/upgrade it (defence-in-depth: the
--   two routes never pass such an account, but the DB boundary must stand on its own). Added, BEFORE the
--   invitation is consumed (so a rejection modifies nothing):
--     * the target account must be uninitialised — tenant_id IS NULL and role <> 'super_admin';
--     * a PRIVATE invitation requires the target's auth.users.email to equal the invitation email (case-insensitive,
--       as the routes already compare). Public links carry no email and are unchanged.
--   Every existing check (expiry, max_uses, suspended institution, group capacity, seat limits via the users
--   trigger, linked-course enrolment) and the error contract (INVITATION_INVALID_OR_EXPIRED) are unchanged.
--   Rebuilt from the live body (md5 9994b594e75c58bfd84875b8303284bd); only the two guards and the target lookup
--   are added. SECURITY DEFINER, service-role-only EXECUTE and SET search_path = public, pg_temp are preserved.
--
-- One migration. No other policy, function, grant or index is touched. No application-code change.
-- schema.sql is NOT updated: it does not contain the invitations table, invitations_select or accept_invitation
-- (they live only in migration files and were never backfilled) — there is nothing there to mirror.
--
-- Idempotent (ALTER POLICY / CREATE OR REPLACE FUNCTION). Rollback: supabase/k_invitations_hardening_rollback.sql.

-- ── K-1 ──────────────────────────────────────────────────────────────────────
ALTER POLICY invitations_select ON public.invitations USING (
  (SELECT public.current_user_role()) = 'super_admin'
  OR (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      (SELECT public.current_user_role()) IN ('university_admin', 'center_manager')
      OR invited_by = (SELECT auth.uid())
    )
  )
);

-- ── K-2 ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.accept_invitation(p_token text, p_user_id uuid, p_full_name text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
    SELECT email INTO _email FROM auth.users WHERE id = p_user_id;
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
