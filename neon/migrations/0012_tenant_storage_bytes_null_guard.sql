-- 0012 — fix for 0011 (found by file-store-trial): in a service context
-- current_user_role() is NULL, so `IF NOT (false OR NULL)` was NULL and PL/pgSQL
-- treated it as false — the FORBIDDEN branch never ran, and one institution's
-- service scope could read another institution's storage total. The guard is
-- now a strict boolean. Same body otherwise. Idempotent.

BEGIN;

CREATE OR REPLACE FUNCTION public.tenant_storage_bytes(p_tenant uuid)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- the caller's role before SECURITY DEFINER: app_service for its own
  -- institution (or platform scope), or the platform owner's session
  IF NOT (
       coalesce(current_setting('role', true) = 'app_service' AND public.svc_tenant_ok(p_tenant), false)
    OR coalesce(public.current_user_role() = 'super_admin', false)
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT COALESCE(SUM(f.bytes), 0)::bigint FROM public.stored_files f WHERE f.tenant_id = p_tenant);
END;
$$;

REVOKE ALL ON FUNCTION public.tenant_storage_bytes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_storage_bytes(uuid) TO app_user, app_service;

COMMIT;
