-- Batch 2 — Owner Counts: per-institution role counts for /super-admin/users.
--
-- The page read every non-owner row of public.users (tenant_id, role) and counted them in the app:
-- 25 729 rows / 1 834 KB per load on a 25 000-user platform, and — if PostgREST's max-rows cap applies —
-- silently WRONG counts once the platform passes that cap. This returns one row per institution.
--
-- Semantics unchanged: every account of the institution whatever its status (active AND disabled — the
-- page always counted both), `university_admin` as «admins» (centre managers are not counted, as before).
--
-- Additive and idempotent: creates ONE function, changes no table, no row, no policy, no index.
-- Owner only (super_admin; everyone else 42501), anon cannot execute. Returns counts only — no user row.
-- SECURITY INVOKER (owner's decision): it runs with the caller's rights, so RLS on public.users still
-- applies — the owner already reads every user through users_select; the explicit role check is an extra
-- gate with a clear error. search_path is still pinned (valid for any function) and every table is
-- schema-qualified.
-- Rollback: DROP FUNCTION IF EXISTS public.get_tenant_role_counts();  (the app falls back to the old read).

CREATE OR REPLACE FUNCTION public.get_tenant_role_counts()
RETURNS TABLE (tenant_id uuid, admins bigint, teachers bigint, students bigint)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (SELECT public.current_user_role()) IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT u.tenant_id,
         count(*) FILTER (WHERE u.role = 'university_admin'),
         count(*) FILTER (WHERE u.role = 'teacher'),
         count(*) FILTER (WHERE u.role = 'student')
  FROM public.users u
  WHERE u.tenant_id IS NOT NULL
    AND u.role IN ('university_admin', 'teacher', 'student')
  GROUP BY u.tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_tenant_role_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_role_counts() TO authenticated;

COMMENT ON FUNCTION public.get_tenant_role_counts() IS
  'Owner only: per-institution counts of university_admin / teacher / student accounts (any status). Batch 2.';
