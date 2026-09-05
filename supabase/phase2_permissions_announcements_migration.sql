-- ============================================================
-- phase2_permissions_announcements_migration.sql — 2026-09-05
-- Idempotent + re-runnable. Apply in the Supabase SQL Editor.
--
-- Phase 2 of the staff-collaboration build:
--   1. New role `center_manager` (continuing-education centre manager /
--      admin assistant) — extends the users + invitations role CHECKs.
--   2. Per-user capability flags (`users.permissions` JSONB). The owner
--      (super_admin) configures what each university_admin may do; the
--      university_admin configures what each center_manager may do, and
--      may never grant a capability they don't hold themselves (enforced
--      in the API — see src/lib/permissions.ts).
--      Defaults are resolved in TS, NOT in the DB, so existing admins keep
--      every capability unless the owner explicitly turns one off
--      (non-breaking).
--   3. Announcements: tenant-branded, optionally image-backed cards shown
--      on the student home page to market courses / open enrolment.
--
-- Grants follow the convention set by rpc_execute_lockdown_migration.sql:
-- user-session RPCs are EXECUTE-able by `authenticated` only (never anon /
-- PUBLIC) and carry their own in-function authorization guard.
-- ============================================================

-- ── 1. New role ─────────────────────────────────────────────
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('super_admin','university_admin','center_manager','teacher','student'));

ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_role_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_role_check
  CHECK (role IN ('university_admin','center_manager','teacher','student'));

-- ── 2. Per-user capability flags ────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── 3. Announcements ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS announcements (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by   uuid NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  title        text NOT NULL,
  body         text,
  image_url    text,
  link_url     text,
  cta_label    text,
  audience     text NOT NULL DEFAULT 'all' CHECK (audience IN ('all','groups')),
  is_published boolean NOT NULL DEFAULT false,
  starts_at    timestamptz,
  ends_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS announcement_groups (
  announcement_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  group_id        uuid NOT NULL REFERENCES groups(id)        ON DELETE CASCADE,
  PRIMARY KEY (announcement_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_announcements_tenant ON announcements(tenant_id, is_published);

ALTER TABLE announcements       ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_groups ENABLE ROW LEVEL SECURITY;

-- Staff read their tenant's announcements. Students get NO direct row read;
-- they receive a filtered feed from get_student_announcements() below, which
-- applies publication state, the date window and audience targeting.
DROP POLICY IF EXISTS "announcements_select" ON announcements;
CREATE POLICY "announcements_select" ON announcements FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin'
  OR (
    tenant_id = (SELECT current_tenant_id())
    AND (SELECT current_user_role()) IN ('university_admin','center_manager','teacher')
  )
);

DROP POLICY IF EXISTS "announcement_groups_select" ON announcement_groups;
CREATE POLICY "announcement_groups_select" ON announcement_groups FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.announcements a
    WHERE a.id = announcement_groups.announcement_id
      AND (
        (SELECT current_user_role()) = 'super_admin'
        OR (a.tenant_id = (SELECT current_tenant_id())
            AND (SELECT current_user_role()) IN ('university_admin','center_manager','teacher'))
      )
  )
);

-- Writes go through the service-role client in the API after the capability
-- check, so no INSERT/UPDATE/DELETE policies are granted here (deny by default).

-- ── 4. Student-facing announcement feed ─────────────────────
CREATE OR REPLACE FUNCTION get_student_announcements()
RETURNS TABLE (
  id         uuid,
  title      text,
  body       text,
  image_url  text,
  link_url   text,
  cta_label  text,
  created_at timestamptz,
  ends_at    timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.id, a.title, a.body, a.image_url, a.link_url, a.cta_label, a.created_at, a.ends_at
  FROM announcements a
  WHERE a.is_published = true
    AND auth.uid() IS NOT NULL
    AND a.tenant_id = (SELECT u.tenant_id FROM users u WHERE u.id = auth.uid())
    AND (a.starts_at IS NULL OR a.starts_at <= now())
    AND (a.ends_at   IS NULL OR a.ends_at   >= now())
    AND (
      a.audience = 'all'
      OR EXISTS (
        SELECT 1
        FROM announcement_groups ag
        JOIN group_students gs ON gs.group_id = ag.group_id
        WHERE ag.announcement_id = a.id
          AND gs.student_id = auth.uid()
      )
    )
  ORDER BY a.created_at DESC
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION public.get_student_announcements() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_announcements() TO authenticated;

-- ── 5. Least-privilege grants for the admin metadata feeds ──
-- (added by admin_metadata_only_migration.sql; they carry an in-function
--  university_admin guard but still had Supabase's default anon/PUBLIC grant)
REVOKE ALL ON FUNCTION public.get_admin_lessons() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_lessons() TO authenticated;
REVOKE ALL ON FUNCTION public.get_admin_exams()   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_exams() TO authenticated;

-- ── 6. Public bucket for announcement images ────────────────
-- Uploads happen server-side through the service-role client (which bypasses
-- storage RLS) after the capability check + file validation; the bucket is
-- public so the <img> in the student feed resolves without a signed URL.
INSERT INTO storage.buckets (id, name, public)
VALUES ('announcement-images','announcement-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "announcement_images_public_read" ON storage.objects;
CREATE POLICY "announcement_images_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'announcement-images');
