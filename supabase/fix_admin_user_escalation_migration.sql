-- ════════════════════════════════════════════════════════════════════════
-- Admin → user privilege escalation + suspended-tenant hardening  (2026-09-27)
-- ════════════════════════════════════════════════════════════════════════
-- Findings from the 2026-09-27 security review:
--
-- F1  users_update let a university_admin UPDATE any other row in their tenant
--     with only `role <> 'super_admin'` pinned. Straight through PostgREST
--     (PATCH /rest/v1/users?id=eq.<x>) an admin could promote any teacher /
--     student to university_admin with `permissions = {}` (= every capability,
--     role default ON), hand a centre manager capabilities the admin does not
--     hold (bypassing ungrantableCapabilities in /api/admin/permissions), or
--     demote / disable a peer admin. Every owner-set capability restriction
--     on an admin was therefore bypassable.
--     Fix: the university_admin branch is removed. Every admin write to
--     another user already goes through a route handler that authorizes with
--     the user session and writes with the service role (create-user,
--     toggle-user, permissions, teacher-permissions, student-affiliation) —
--     the one browser-side write (admin/teachers toggle) now uses
--     /api/admin/toggle-user. Self-update and super_admin are unchanged.
--
-- F1b users_insert allowed a university_admin to INSERT a users row with any
--     role/tenant (exploitable only for an auth.users id that has no profile
--     row, e.g. after handle_new_user swallowed an error). Nothing in the app
--     inserts users through the user session; now super_admin only.
--
-- F3  Suspending an institution was not enforced server-side for NEW
--     accounts: accept_invitation never checked tenants.is_active, so a
--     pending (public) link minted an ACTIVE account inside a suspended
--     tenant. And restoring a tenant re-activated EVERY user in it, including
--     accounts disabled individually before the suspension.
--     Fix: accept_invitation refuses a suspended tenant; the tenant cascade
--     marks the accounts it switches off (users.suspended_by_tenant) and a
--     restore re-activates only those.
--
-- Idempotent / re-runnable. Apply AFTER student_affiliation_announcements_migration.sql
-- (current users_update) and fix_rls_write_path_migration.sql (current accept_invitation).
-- Regression check: supabase/tests/admin_user_escalation_check.sql
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. users.suspended_by_tenant ────────────────────────────────────────
-- TRUE = this account was switched off by its institution's suspension (not
-- by an individual decision), so restoring the institution switches it back on.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS suspended_by_tenant BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill for institutions suspended before this migration. Their users were
-- switched off in bulk, so the old behaviour (restore re-activates everyone)
-- is preserved for them; only suspensions from now on tell the two apart.
UPDATE public.users u
SET suspended_by_tenant = TRUE
FROM public.tenants t
WHERE t.id = u.tenant_id AND t.is_active = FALSE
  AND u.is_active = FALSE AND u.role <> 'super_admin'
  AND u.suspended_by_tenant = FALSE;

-- Pin helper, same idiom as current_is_active(): during an UPDATE it observes
-- the pre-update row, so comparing NEW against it detects a change. Must stay
-- executable by `authenticated` (called inside users_update).
CREATE OR REPLACE FUNCTION public.current_suspended_by_tenant()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT suspended_by_tenant FROM public.users WHERE id = auth.uid() $$;

REVOKE ALL ON FUNCTION public.current_suspended_by_tenant() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_suspended_by_tenant() TO authenticated;

-- ── 2. users_update: no admin branch; self-update pins every authz column ──
DROP POLICY IF EXISTS users_update ON public.users;

CREATE POLICY users_update ON public.users FOR UPDATE
USING (
  (SELECT current_user_role()) = 'super_admin'
  OR id = (SELECT auth.uid())
)
WITH CHECK (
  (SELECT current_user_role()) = 'super_admin'
  OR (
    -- Self-update: profile fields only. RLS gates rows, NOT columns — EVERY
    -- identity/authorization column must be pinned here. ANY new such column
    -- on `users` must be added to this list.
    id = (SELECT auth.uid())
    AND role = (SELECT current_user_role())
    AND NOT (tenant_id             IS DISTINCT FROM (SELECT current_tenant_id()))
    AND NOT (is_active             IS DISTINCT FROM (SELECT current_is_active()))
    AND NOT (permissions           IS DISTINCT FROM (SELECT current_permissions()))
    AND NOT (can_create_courses    IS DISTINCT FROM (SELECT current_can_create_courses()))
    AND NOT (is_university_student IS DISTINCT FROM (SELECT current_is_university_student()))
    AND NOT (suspended_by_tenant   IS DISTINCT FROM (SELECT current_suspended_by_tenant()))
  )
);

-- ── 3. users_insert: owner only (profiles are created by handle_new_user
--       and the service-role routes, never through a user session) ────────
DROP POLICY IF EXISTS users_insert ON public.users;
CREATE POLICY users_insert ON public.users FOR INSERT
WITH CHECK ((SELECT current_user_role()) = 'super_admin');

-- ── 4. Tenant suspension cascade: remember whom it switched off ──────────
CREATE OR REPLACE FUNCTION public.cascade_tenant_active_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    IF NEW.is_active THEN
      -- Restore: only the accounts the suspension itself switched off.
      UPDATE public.users
      SET is_active = TRUE, suspended_by_tenant = FALSE
      WHERE tenant_id = NEW.id AND role <> 'super_admin' AND suspended_by_tenant;
    ELSE
      -- Suspend: switch off the active accounts and mark them. Accounts that
      -- were already disabled keep suspended_by_tenant = FALSE and stay off
      -- after a restore.
      UPDATE public.users
      SET is_active = FALSE, suspended_by_tenant = TRUE
      WHERE tenant_id = NEW.id AND role <> 'super_admin' AND is_active;
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.cascade_tenant_active_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_tenant_active_change ON public.tenants;
CREATE TRIGGER on_tenant_active_change
  AFTER UPDATE OF is_active ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.cascade_tenant_active_status();

-- ── 5. accept_invitation: never into a suspended institution ─────────────
-- Identical to fix_rls_write_path_migration.sql except the tenant check.
-- Reuses INVITATION_INVALID_OR_EXPIRED so both callers (api/auth/accept-invitation,
-- auth/callback) already map it and roll the fresh auth user back.
CREATE OR REPLACE FUNCTION public.accept_invitation(p_token text, p_user_id uuid, p_full_name text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  inv          RECORD;
  _user_exists BOOLEAN;
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

-- CREATE OR REPLACE keeps the ACL, but re-assert the lockdown
-- (rpc_execute_lockdown_migration A4): service role only.
REVOKE ALL ON FUNCTION public.accept_invitation(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_invitation(text, uuid, text) TO service_role;

COMMIT;
