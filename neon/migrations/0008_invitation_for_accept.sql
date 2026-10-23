-- Neon only (Cloudflare + Neon migration, step 9). Never run on Supabase.
-- Idempotent: safe to run more than once.
--
-- Accepting an invitation starts before anyone is known: the token is the only
-- credential. This function answers what the accept route needs to check a
-- token — including its institution, so the rest of the work can run as
-- app_service pinned to that institution — and only app_system may call it.
-- A token that is unknown, used up, expired or no longer pending returns NULL.

BEGIN;

CREATE OR REPLACE FUNCTION public.invitation_for_accept(p_token text)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT json_build_object(
           'id', i.id,
           'role', i.role,
           'tenant_id', i.tenant_id,
           'email', i.email,
           'is_public', i.is_public,
           'max_uses', i.max_uses,
           'use_count', i.use_count,
           'is_university_student', i.is_university_student,
           'tenant_active', t.is_active
         )
    FROM public.invitations i
    JOIN public.tenants t ON t.id = i.tenant_id
   WHERE i.token = p_token
     AND i.status = 'pending'
     AND i.expires_at > now()
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.invitation_for_accept(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invitation_for_accept(text) TO app_system;

COMMIT;
