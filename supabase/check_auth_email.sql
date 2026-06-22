-- Function: check_email_in_auth
-- Checks whether an email address already exists in auth.users.
-- Used by /api/invitations POST to catch orphaned accounts (auth record exists
-- but no corresponding row in the public.users table).
-- Must be run with a role that has access to the auth schema (service role).

CREATE OR REPLACE FUNCTION check_email_in_auth(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users WHERE email = p_email
  );
$$;
