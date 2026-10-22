-- Neon only (Cloudflare + Neon migration, step 7). Run once, at cutover.
--
-- Production has one real account: the owner (super_admin); everything else
-- was test data. So no accounts or password hashes are copied from Supabase.
-- The owner creates their Neon Auth account themselves (their own password,
-- or Google), which gives them a profile row as a student; this script then
-- makes that account the platform owner.
--
-- Usage:
--   psql "<neon connection string>" -v owner_email='owner@example.com' -f neon/seed/promote-owner.sql
--
-- Refuses (and changes nothing) when a super_admin already exists, or when the
-- email does not match exactly one account.

SELECT set_config('bootstrap.owner_email', :'owner_email', false);

DO $$
DECLARE
  v_email text := current_setting('bootstrap.owner_email');
  v_count int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.users WHERE role = 'super_admin') THEN
    RAISE EXCEPTION 'a super_admin already exists; nothing changed';
  END IF;

  UPDATE public.users
     SET role = 'super_admin',
         tenant_id = NULL,
         is_active = true,
         must_change_password = false
   WHERE lower(email) = lower(v_email);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly one account with email %, found %; nothing changed', v_email, v_count;
  END IF;
END $$;
