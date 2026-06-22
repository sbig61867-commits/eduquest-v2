-- ============================================================
-- EduQuest — JWT Claims Migration
-- Run AFTER schema.sql + invitations_migration.sql
--
-- Moves role / tenant_id / is_active into auth.users.raw_app_meta_data so they
-- ride inside the JWT (app_metadata). The proxy/middleware then reads identity
-- straight from the validated token instead of querying public.users on every
-- request — removing one DB round-trip per navigation.
--
-- app_metadata is writable only by the service role, so a client cannot forge
-- its own role. getUser() returns LIVE app_metadata, so a role/is_active change
-- propagates on the very next request (no waiting for token expiry).
-- ============================================================

CREATE OR REPLACE FUNCTION sync_user_claims()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object(
         'user_role', NEW.role,
         'tenant_id', NEW.tenant_id,
         'is_active', COALESCE(NEW.is_active, true)
       )
  WHERE id = NEW.id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_user_claims_change ON public.users;
CREATE TRIGGER on_user_claims_change
  AFTER INSERT OR UPDATE OF role, tenant_id, is_active ON public.users
  FOR EACH ROW EXECUTE FUNCTION sync_user_claims();

-- One-time backfill for users that existed before the trigger
UPDATE auth.users au
SET raw_app_meta_data = COALESCE(au.raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('user_role', u.role, 'tenant_id', u.tenant_id, 'is_active', COALESCE(u.is_active, true))
FROM public.users u
WHERE u.id = au.id;
