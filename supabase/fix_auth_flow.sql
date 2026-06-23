-- ============================================================
-- EduQuest — Auth Flow Fix
-- Fixes 3 issues that cause invitation sign-up to fail:
--   1. handle_new_user trigger: add search_path + safe exception
--   2. sync_user_claims function: push role/is_active/tenant_id to JWT app_metadata
--   3. on_user_update trigger: fires sync after accept_invitation updates users row
-- Run in Supabase SQL Editor.
-- ============================================================

-- ============================================================
-- FIX 1: handle_new_user — add search_path so it can see public.users
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, role, tenant_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'student',
    NULL
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'handle_new_user failed for %: %', NEW.email, SQLERRM;
  RETURN NEW;
END;
$$;

-- Re-attach trigger (idempotent)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- FIX 2: sync_user_claims — push role/is_active/tenant_id into JWT app_metadata
-- Called after accept_invitation updates users table so next sign-in
-- (and existing sessions after refresh) carry the correct role claim.
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_user_claims()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object(
    'user_role',  NEW.role,
    'is_active',  NEW.is_active,
    'tenant_id',  NEW.tenant_id
  )
  WHERE id = NEW.id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'sync_user_claims failed for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- Trigger fires whenever role, is_active, or tenant_id changes
DROP TRIGGER IF EXISTS on_user_claims_change ON public.users;
CREATE TRIGGER on_user_claims_change
  AFTER INSERT OR UPDATE OF role, is_active, tenant_id ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_user_claims();

-- ============================================================
-- FIX 3: Backfill — sync claims for all existing users
-- Touch role column (same value) to fire sync_user_claims trigger
-- ============================================================
UPDATE public.users SET role = role;
