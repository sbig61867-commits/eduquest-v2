-- 0011 — files move to Cloudflare R2 (step 11). Supabase's storage.objects goes
-- away at the cutover, so the per-institution storage quota needs its own
-- record of what each institution has stored:
--
--   public.stored_files   one row per object in the R2 bucket (key, owning
--                         institution, size). Written by the upload routes as
--                         app_service pinned to that institution, in the same
--                         unit as their checks; removed when the file is.
--   tenant_storage_bytes  now sums stored_files instead of storage.objects.
--                         Callable by app_service for its own institution (or
--                         platform scope) and by the platform owner.
--
-- No user policy on stored_files: nobody reads it from a user session.
-- CLAUDE.md hard rules 1–3: schema-qualified, pinned search_path, execute
-- revoked from PUBLIC/anon/authenticated. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.stored_files (
  key          text PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bytes        bigint NOT NULL CHECK (bytes >= 0),
  content_type text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stored_files_tenant_idx ON public.stored_files (tenant_id);

ALTER TABLE public.stored_files ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.stored_files FROM PUBLIC, anon, authenticated, app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stored_files TO app_service;

DROP POLICY IF EXISTS svc_stored_files ON public.stored_files;
CREATE POLICY svc_stored_files ON public.stored_files FOR ALL TO app_service
  USING (public.svc_tenant_ok(tenant_id)) WITH CHECK (public.svc_tenant_ok(tenant_id));

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
       (current_setting('role', true) = 'app_service' AND public.svc_tenant_ok(p_tenant))
    OR public.current_user_role() = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT COALESCE(SUM(f.bytes), 0)::bigint FROM public.stored_files f WHERE f.tenant_id = p_tenant);
END;
$$;

REVOKE ALL ON FUNCTION public.tenant_storage_bytes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_storage_bytes(uuid) TO app_user, app_service;

COMMIT;
