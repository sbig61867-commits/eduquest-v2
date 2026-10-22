-- Neon only (Cloudflare + Neon migration, step 4). Never run on Supabase.
-- Idempotent: safe to run more than once.
--
-- Identity moves from the Supabase-compat table auth.users to Neon Auth
-- (neon_auth."user"). The RLS helpers keep working unchanged: they read
-- public.users by auth.uid(), and auth.uid() is the token's `sub`, which is the
-- Neon Auth user id (uuid). So public.users.id must equal neon_auth."user".id.

BEGIN;

-- 1. public.users.id follows the Neon Auth user (deleting the auth user still
--    removes the profile, as before).
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_id_fkey;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_id_neon_auth_fkey;
ALTER TABLE public.users
  ADD CONSTRAINT users_id_neon_auth_fkey
  FOREIGN KEY (id) REFERENCES neon_auth."user"(id) ON DELETE CASCADE;

-- 2. A new Neon Auth user gets a profile row, like handle_new_user did for
--    auth.users: a student with no institution until an admin or an invitation
--    sets the rest.
CREATE OR REPLACE FUNCTION public.handle_new_neon_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, role, tenant_id)
  VALUES (NEW.id, NEW.email, COALESCE(NULLIF(NEW.name, ''), NEW.email), 'student', NULL)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'handle_new_neon_auth_user failed for %: %', NEW.email, SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_neon_auth_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_neon_auth_user_created ON neon_auth."user";
CREATE TRIGGER on_neon_auth_user_created
  AFTER INSERT ON neon_auth."user"
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_neon_auth_user();

-- 3. Roles are read from public.users inside each query, not from the token,
--    so copying them into token metadata is no longer needed.
DROP TRIGGER IF EXISTS on_user_claims_change ON public.users;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 4. A deactivated account has no role, institution or groups, so every
--    policy built on these helpers denies it from its next query. On Supabase
--    the proxy blocked it using the token's is_active claim; a Neon Auth token
--    has no such claim, so the database enforces it instead.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.users WHERE id = auth.uid() AND is_active IS NOT FALSE;
$$;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT tenant_id FROM public.users WHERE id = auth.uid() AND is_active IS NOT FALSE;
$$;

CREATE OR REPLACE FUNCTION public.current_student_group_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT gs.group_id FROM public.group_students gs
  JOIN public.users u ON u.id = gs.student_id AND u.is_active IS NOT FALSE
  WHERE gs.student_id = auth.uid();
$$;

COMMIT;
