-- ============================================================
-- EduQuest — Schema Fixes Migration
-- Run AFTER invitations_migration.sql
-- Fixes 5 issues identified in schema audit:
--   1. trigger privilege escalation (schema.sql not updated in prod)
--   2. invited_by CASCADE → SET NULL (audit record preservation)
--   3. get_invitation_by_token SELECT * → explicit columns (no data leak)
--   4. grades as single source of truth + submission_id FK
--   5. group_name_snapshot for audit trail in invitations
-- ============================================================

-- ============================================================
-- FIX 1: Secure the handle_new_user trigger
-- The version in schema.sql trusted raw_user_meta_data for role/tenant.
-- This replaces it with the hardened version.
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO users (id, email, full_name, role, tenant_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'student',
    NULL
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FIX 2: Change invited_by FK from CASCADE to SET NULL
-- Deleting an inviter must not cascade-delete invitation audit records.
-- ============================================================

ALTER TABLE invitations
  DROP CONSTRAINT IF EXISTS invitations_invited_by_fkey;

ALTER TABLE invitations
  ADD CONSTRAINT invitations_invited_by_fkey
  FOREIGN KEY (invited_by)
  REFERENCES users(id)
  ON DELETE SET NULL;

-- ============================================================
-- FIX 3: Harden get_invitation_by_token — explicit column SELECT
-- Prevents accidental future data leaks if new columns are added.
-- ============================================================

-- ============================================================
-- FIX 4: grades as single source of truth for scores
-- ============================================================

ALTER TABLE grades
  ADD COLUMN IF NOT EXISTS submission_id UUID
  REFERENCES exam_submissions(id) ON DELETE SET NULL;

ALTER TABLE exam_submissions DROP COLUMN IF EXISTS score;

CREATE INDEX IF NOT EXISTS idx_grades_submission_id ON grades(submission_id);

-- ============================================================
-- FIX 5: group_name_snapshot in invitations for audit trail
-- ============================================================

ALTER TABLE invitations ADD COLUMN IF NOT EXISTS group_name_snapshot TEXT;

-- ============================================================
-- FIX 3: Harden get_invitation_by_token — explicit column SELECT
-- ============================================================

CREATE OR REPLACE FUNCTION get_invitation_by_token(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  inv RECORD;
BEGIN
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

  RETURN json_build_object(
    'email',       inv.email,
    'role',        inv.role,
    'tenant_name', inv.tenant_name,
    'expires_at',  inv.expires_at
  );
END;
$$;
