-- ============================================================
-- EduQuest — Invitation System Migration
-- Run this in Supabase SQL Editor AFTER the main schema.sql
-- ============================================================

-- ============================================================
-- 1. INVITATIONS TABLE
-- ============================================================

CREATE TABLE invitations (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- The cryptographic token that goes in the invitation URL.
  -- 256-bit random hex — impossible to brute force.
  token        TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),

  -- Who is being invited
  email        TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('university_admin', 'teacher', 'student')),

  -- Where they are being invited
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  group_id     UUID REFERENCES groups(id) ON DELETE SET NULL, -- only for student→group invites

  -- Who created this invitation (for audit + revoke ownership)
  -- SET NULL on delete: invitations are audit records; deleting the creator must not erase them
  invited_by   UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Lifecycle state machine: pending → accepted | revoked
  -- "expired" is derived from expires_at < NOW() — never stored as state
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'accepted', 'revoked')),

  expires_at   TIMESTAMPTZ NOT NULL,

  -- Filled when a user accepts
  accepted_at  TIMESTAMPTZ,
  accepted_by  UUID REFERENCES users(id) ON DELETE SET NULL,

  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. INDEXES
-- ============================================================

-- Primary lookup path: every join page validates token
CREATE UNIQUE INDEX idx_invitations_token ON invitations(token);

-- Admin UI: list all invitations for a tenant
CREATE INDEX idx_invitations_tenant_id ON invitations(tenant_id);

-- Find invitations by email (check for existing pending before creating new)
CREATE INDEX idx_invitations_email ON invitations(email);

-- Prevent duplicate pending invitations for the same email in the same tenant.
-- Once accepted or revoked, a new pending invitation can be created for the same email.
CREATE UNIQUE INDEX idx_invitations_pending_unique
  ON invitations(email, tenant_id)
  WHERE status = 'pending';

-- Efficient cleanup queries: find all expired pending invitations
CREATE INDEX idx_invitations_expires ON invitations(expires_at)
  WHERE status = 'pending';

-- ============================================================
-- 3. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- Read: super_admin sees all; others see invitations for their tenant
CREATE POLICY "invitations_select" ON invitations FOR SELECT USING (
  current_user_role() = 'super_admin'
  OR tenant_id = current_tenant_id()
);

-- Create: super_admin, university_admin, teacher can create invitations
-- Role ceiling and tenant scoping enforced in the API layer
CREATE POLICY "invitations_insert" ON invitations FOR INSERT WITH CHECK (
  current_user_role() IN ('super_admin', 'university_admin', 'teacher')
);

-- Revoke (update status): only the creator or a higher role in the same tenant
CREATE POLICY "invitations_update" ON invitations FOR UPDATE USING (
  current_user_role() = 'super_admin'
  OR invited_by = auth.uid()
  OR (current_user_role() = 'university_admin' AND tenant_id = current_tenant_id())
);

-- ============================================================
-- 4. FIX handle_new_user TRIGGER
--    Previously read role from user metadata — privilege escalation risk.
--    Now always defaults to 'student'/NULL. Role is set explicitly by:
--    - accept_invitation() RPC (invitation flow)
--    - /api/admin/create-user (admin flow, via explicit UPDATE)
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO users (id, email, full_name, role, tenant_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'student',  -- always safe default, never trust user-provided role
    NULL        -- always NULL, set explicitly after creation
  )
  ON CONFLICT (id) DO NOTHING; -- safe re-entrancy if row already exists
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 5. accept_invitation() RPC
--    Called server-side after auth user is created.
--    Runs entirely in a single transaction:
--      a) Atomically consumes the token (race-condition proof)
--      b) Updates user profile with correct role + tenant
--      c) Auto-enrolls student in group (if group_id present)
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
  -- Step 1: Verify user profile exists in public.users BEFORE touching invitations.
  -- Without this check, the FK on accepted_by fires a raw 23503 error when the
  -- handle_new_user trigger failed, bypassing our custom USER_PROFILE_NOT_FOUND error
  -- and leaving confusing 500s for the client.
  SELECT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) INTO _user_exists;

  IF NOT _user_exists THEN
    RAISE EXCEPTION 'USER_PROFILE_NOT_FOUND';
  END IF;

  -- Step 2: Atomic token consumption — only one concurrent request can succeed.
  -- accepted_by FK is safe now: user existence verified above.
  UPDATE invitations
  SET status      = 'accepted',
      accepted_at = NOW(),
      accepted_by = p_user_id
  WHERE token      = p_token
    AND status     = 'pending'
    AND expires_at > NOW()
  RETURNING * INTO inv;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_INVALID_OR_EXPIRED';
  END IF;

  -- Step 3: Set correct role + tenant — overrides safe trigger defaults.
  UPDATE users
  SET role      = inv.role,
      tenant_id = inv.tenant_id,
      full_name = p_full_name
  WHERE id = p_user_id;

  -- Step 4: Auto-enroll student in group if invitation targeted a specific group.
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
-- 6. get_invitation_by_token() — safe public read
--    Returns invitation details WITHOUT requiring auth.
--    Used by the /join page to show invitation info before registration.
--    Only returns data for pending + non-expired invitations.
-- ============================================================

CREATE OR REPLACE FUNCTION get_invitation_by_token(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  inv  RECORD;
BEGIN
  -- Select only the fields the registration page needs.
  -- Never use SELECT i.* here — future columns (e.g. internal UUIDs) must not leak to a public page.
  SELECT i.email, i.role, i.expires_at, i.group_id, t.name AS tenant_name
  INTO inv
  FROM invitations i
  JOIN tenants t ON t.id = i.tenant_id
  WHERE i.token      = p_token
    AND i.status     = 'pending'
    AND i.expires_at > NOW();

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Return only what the registration page needs — never expose internal IDs via token
  RETURN json_build_object(
    'email',       inv.email,
    'role',        inv.role,
    'tenant_name', inv.tenant_name,
    'expires_at',  inv.expires_at
  );
END;
$$;
