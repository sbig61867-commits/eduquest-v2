-- Neon only (Cloudflare + Neon migration, step 5). Never run on Supabase.
-- Idempotent: safe to run more than once.

BEGIN;

-- 1. The "temporary password, must choose a new one" flag lived in Supabase
--    auth app_metadata. Neon Auth has no such field, so it becomes a column.
--    Staff-created accounts and staff password resets set it to true; the
--    user's own password change sets it back to false (service role only).
--    Step 15 copies the current values from Supabase app_metadata.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- 2. Column-level update rights, as on production
--    (users_column_update_lockdown_migration.sql): a user may change only
--    their own name and language. The trial copy had lost this grant. Every
--    other column, must_change_password included, is service-role only.
REVOKE UPDATE ON public.users FROM authenticated, anon;
GRANT UPDATE (full_name, locale) ON public.users TO authenticated;

-- 3. TRUNCATE ignores RLS. No client path needs it; remove it from the API
--    roles on every table in public.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM authenticated, anon', r.tablename);
  END LOOP;
END $$;

COMMIT;
