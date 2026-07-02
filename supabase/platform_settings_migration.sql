-- ============================================================
-- Platform settings — key/value store editable by super_admin
-- Idempotent: safe to re-run.
-- Task 1 of the settings roadmap: invitation defaults.
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

-- Any authenticated user may READ settings (API routes read defaults with the
-- caller's session client); only super_admin may write.
DROP POLICY IF EXISTS "settings_read_authenticated" ON platform_settings;
CREATE POLICY "settings_read_authenticated" ON platform_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "settings_write_super_admin" ON platform_settings;
CREATE POLICY "settings_write_super_admin" ON platform_settings
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'super_admin')
  WITH CHECK (public.current_user_role() = 'super_admin');

-- Seed invitation defaults (per-role expiry hours + hard cap)
INSERT INTO platform_settings (key, value) VALUES (
  'invitation_defaults',
  '{"university_admin": 72, "teacher": 48, "student": 168, "max_expiry_hours": 720}'::jsonb
) ON CONFLICT (key) DO NOTHING;
