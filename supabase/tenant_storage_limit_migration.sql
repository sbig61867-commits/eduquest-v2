-- ============================================================================
-- Per-institution file storage limit (owner's plan limits, 2026-09-29)
-- ============================================================================
-- Supabase free holds 1 GB of files for the WHOLE platform, and it is split
-- between institutions (src/lib/pricing/plans.ts: 150 MB per institution when
-- five are hosted). Until now nothing stopped one institution from filling it.
--
-- tenants.storage_limit_mb  NULL = no cap (every existing tenant ⇒ no change
--                           until the owner sets it on /super-admin/tenants).
-- tenant_storage_bytes(t)   bytes the tenant's files take in the two app
--                           buckets. Every stored path starts with the tenant
--                           id (src/lib/exam-files.ts, api/announcements/upload).
--
-- Enforced before each upload by src/lib/storage-quota.ts (exam-files: task
-- attachments + answer photos; announcement-images). Proctoring evidence is
-- not here: it never touches Supabase.
--
-- Written only by super_admin: tenants_manage is super_admin-only, so an
-- institution admin cannot raise its own limit.
--
-- Idempotent. Rollback: DROP FUNCTION public.tenant_storage_bytes(uuid);
--                       ALTER TABLE public.tenants DROP COLUMN storage_limit_mb;
-- ============================================================================

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS storage_limit_mb INTEGER;

ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_storage_limit_mb_check;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_storage_limit_mb_check
  CHECK (storage_limit_mb IS NULL OR storage_limit_mb >= 0);

COMMENT ON COLUMN public.tenants.storage_limit_mb IS
  'Max MB of files (exam-files + announcement-images) for this institution. NULL = no cap.';

-- Callable by the service role (upload routes) and by super_admin (the owner's
-- institution cards). Uses auth.role(), not auth.uid(): under the service-role
-- client auth.uid() is NULL (see fix_start_exam_attempt_migration.sql).
CREATE OR REPLACE FUNCTION public.tenant_storage_bytes(p_tenant uuid)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND public.current_user_role() IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT COALESCE(SUM((o.metadata->>'size')::bigint), 0)
    FROM storage.objects o
    WHERE o.bucket_id IN ('exam-files', 'announcement-images')
      AND o.name LIKE p_tenant::text || '/%'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.tenant_storage_bytes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_storage_bytes(uuid) TO authenticated, service_role;
