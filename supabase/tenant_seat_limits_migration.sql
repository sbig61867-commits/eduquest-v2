-- ════════════════════════════════════════════════════════════════════════
-- Plan seat limits: students AND teachers, enforced in the database (2026-09-28)
-- ════════════════════════════════════════════════════════════════════════
-- Owner's rule: a limit the owner sets on an institution is binding the moment
-- it is saved. Once an institution has as many ACTIVE students (or teachers) as
-- its limit, nobody may add another one — by invitation link, by creating the
-- account, by re-enabling a disabled account, by Google sign-in with a link —
-- until the owner raises the limit (or the institution frees a seat).
--
-- Before this file, tenants.student_limit was only checked by two route
-- handlers (create-user, accept-invitation). Three paths skipped it:
--   • re-enabling a disabled student (/api/admin/toggle-user),
--   • joining through Google with an invitation (auth/callback calls the
--     accept_invitation RPC directly),
--   • two people joining at the same moment (check-then-insert race).
-- And there was no teacher limit at all.
--
-- The trigger below is the one gate every path goes through: a users row that
-- ENTERS the counted set (active student/teacher of a tenant) is refused when
-- the set is already full. The tenant row is locked while counting, so
-- concurrent joins to the same institution are serialised and can never
-- overshoot. The route handlers keep their own friendly pre-checks
-- (src/lib/seat-limit.ts) — this is the guarantee behind them.
--
-- Semantics:
--   NULL limit      = no limit (every existing tenant ⇒ no behaviour change).
--   Lowering a limit below current usage never switches anyone off; it only
--   stops new additions until usage falls below the limit or the owner raises it.
--   Restoring a suspended institution gives back the seats it already held
--   (suspended_by_tenant, fix_admin_user_escalation_migration.sql).
--
-- Idempotent / re-runnable. Apply AFTER fix_admin_user_escalation_migration.sql.
-- Regression check: supabase/tests/tenant_seat_limits_check.sql
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS teacher_limit INTEGER;

-- (student_limit already carries tenants_student_limit_check.)
ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_teacher_limit_check;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_teacher_limit_check
  CHECK (teacher_limit IS NULL OR teacher_limit >= 0);

COMMENT ON COLUMN public.tenants.teacher_limit IS
  'Plan cap on ACTIVE teachers. NULL = no cap. Enforced by trigger users_enforce_seat_limit.';

CREATE OR REPLACE FUNCTION public.enforce_tenant_seat_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit INTEGER;
  v_used  INTEGER;
BEGIN
  -- Only an active student/teacher of a tenant occupies a seat.
  IF NEW.tenant_id IS NULL OR NOT COALESCE(NEW.is_active, TRUE)
     OR NEW.role NOT IN ('student', 'teacher') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Already held this seat before the change: nothing new is taken.
    IF OLD.tenant_id IS NOT DISTINCT FROM NEW.tenant_id AND OLD.role = NEW.role
       AND COALESCE(OLD.is_active, TRUE) THEN
      RETURN NEW;
    END IF;
    -- The owner restoring a suspended institution hands back seats it held.
    IF OLD.suspended_by_tenant AND NOT NEW.suspended_by_tenant
       AND OLD.tenant_id IS NOT DISTINCT FROM NEW.tenant_id AND OLD.role = NEW.role THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Lock the institution row: concurrent joins to it queue here, so the
  -- count below cannot be read by two of them at once.
  SELECT CASE NEW.role WHEN 'student' THEN t.student_limit ELSE t.teacher_limit END
    INTO v_limit
  FROM public.tenants t
  WHERE t.id = NEW.tenant_id
  FOR UPDATE;

  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_used
  FROM public.users u
  WHERE u.tenant_id = NEW.tenant_id AND u.role = NEW.role
    AND u.is_active AND u.id <> NEW.id;

  IF v_used >= v_limit THEN
    RAISE EXCEPTION '%', CASE NEW.role WHEN 'student' THEN 'STUDENT_LIMIT_REACHED' ELSE 'TEACHER_LIMIT_REACHED' END
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END $$;

-- Trigger-only function: nobody calls it directly.
REVOKE ALL ON FUNCTION public.enforce_tenant_seat_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS users_enforce_seat_limit ON public.users;
CREATE TRIGGER users_enforce_seat_limit
  BEFORE INSERT OR UPDATE OF role, tenant_id, is_active ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_seat_limit();

COMMIT;
