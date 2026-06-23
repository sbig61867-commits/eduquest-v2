-- ============================================================
-- EduQuest Phase 1 Migration
-- Run in Supabase SQL Editor AFTER invitations_migration.sql
-- ============================================================

-- ============================================================
-- 1. PUBLIC INVITATION LINKS
-- Add is_public, max_uses, use_count to invitations table
-- ============================================================

ALTER TABLE invitations
  ALTER COLUMN email DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS is_public  BOOLEAN  NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS max_uses   INTEGER  CHECK (max_uses IS NULL OR max_uses > 0),
  ADD COLUMN IF NOT EXISTS use_count  INTEGER  NOT NULL DEFAULT 0;

-- Drop old unique index that required email for all invitations
DROP INDEX IF EXISTS idx_invitations_pending_unique;

-- New index: unique pending private invitation per email+tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_pending_private_unique
  ON invitations(email, tenant_id)
  WHERE status = 'pending' AND is_public = FALSE AND email IS NOT NULL;

-- Index for public invitations lookup
CREATE INDEX IF NOT EXISTS idx_invitations_public
  ON invitations(tenant_id, role)
  WHERE is_public = TRUE AND status = 'pending';

-- ============================================================
-- 2. UPDATED get_invitation_by_token RPC
-- Returns is_public flag so the /join page knows what to show
-- ============================================================

CREATE OR REPLACE FUNCTION get_invitation_by_token(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  inv RECORD;
BEGIN
  SELECT
    i.email,
    i.role,
    i.expires_at,
    i.group_id,
    i.is_public,
    i.max_uses,
    i.use_count,
    t.name AS tenant_name
  INTO inv
  FROM invitations i
  JOIN tenants t ON t.id = i.tenant_id
  WHERE i.token     = p_token
    AND i.status    = 'pending'
    AND i.expires_at > NOW()
    AND (i.max_uses IS NULL OR i.use_count < i.max_uses);

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN json_build_object(
    'email',       inv.email,
    'role',        inv.role,
    'tenant_name', inv.tenant_name,
    'expires_at',  inv.expires_at,
    'is_public',   inv.is_public,
    'max_uses',    inv.max_uses,
    'use_count',   inv.use_count
  );
END;
$$;

-- ============================================================
-- 3. UPDATED accept_invitation RPC
-- Handles both private (single-use) and public (multi-use) links
-- ============================================================

CREATE OR REPLACE FUNCTION accept_invitation(
  p_token     TEXT,
  p_user_id   UUID,
  p_full_name TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  inv          RECORD;
  _user_exists BOOLEAN;
BEGIN
  -- Verify user profile exists (handle_new_user trigger may have run)
  SELECT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) INTO _user_exists;
  IF NOT _user_exists THEN
    RAISE EXCEPTION 'USER_PROFILE_NOT_FOUND';
  END IF;

  -- Lock the invitation row for update (prevents race conditions on public links)
  SELECT * INTO inv
  FROM invitations
  WHERE token     = p_token
    AND status    = 'pending'
    AND expires_at > NOW()
    AND (max_uses IS NULL OR use_count < max_uses)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_INVALID_OR_EXPIRED';
  END IF;

  IF inv.is_public THEN
    -- Public link: increment use_count, auto-revoke if max_uses reached
    UPDATE invitations
    SET use_count = use_count + 1,
        status    = CASE
                      WHEN max_uses IS NOT NULL AND (use_count + 1) >= max_uses
                      THEN 'revoked'
                      ELSE 'pending'
                    END
    WHERE id = inv.id;
  ELSE
    -- Private link: single-use — mark as accepted
    UPDATE invitations
    SET status      = 'accepted',
        accepted_at = NOW(),
        accepted_by = p_user_id
    WHERE id = inv.id;
  END IF;

  -- Set role + tenant on the user profile
  UPDATE users
  SET role      = inv.role,
      tenant_id = inv.tenant_id,
      full_name = p_full_name
  WHERE id = p_user_id;

  -- Auto-enroll student into group if specified
  IF inv.group_id IS NOT NULL AND inv.role = 'student' THEN
    INSERT INTO group_students (group_id, student_id)
    VALUES (inv.group_id, p_user_id)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN json_build_object(
    'role',      inv.role,
    'tenant_id', inv.tenant_id,
    'group_id',  inv.group_id
  );
END;
$$;

-- ============================================================
-- 4. TENANT FREEZE CASCADE
-- When super_admin deactivates a tenant, all users in that
-- tenant are also deactivated. The existing middleware
-- is_active check then blocks them from accessing the platform.
-- ============================================================

CREATE OR REPLACE FUNCTION cascade_tenant_active_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    UPDATE public.users
    SET is_active = NEW.is_active
    WHERE tenant_id = NEW.id
      AND role != 'super_admin';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_tenant_active_change ON tenants;
CREATE TRIGGER on_tenant_active_change
  AFTER UPDATE OF is_active ON tenants
  FOR EACH ROW EXECUTE FUNCTION cascade_tenant_active_status();

-- ============================================================
-- 5. DEACTIVATE USERS WHEN TENANT IS DELETED
-- When a tenant is hard-deleted, set all its users is_active=false
-- so they see a clear error instead of a broken dashboard.
-- (tenant_id becomes NULL via ON DELETE SET NULL — this trigger
--  fires BEFORE that to capture the tenant_id while it still exists)
-- ============================================================

CREATE OR REPLACE FUNCTION deactivate_users_on_tenant_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.users
  SET is_active = FALSE
  WHERE tenant_id = OLD.id
    AND role != 'super_admin';
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS on_tenant_delete ON tenants;
CREATE TRIGGER on_tenant_delete
  BEFORE DELETE ON tenants
  FOR EACH ROW EXECUTE FUNCTION deactivate_users_on_tenant_delete();
