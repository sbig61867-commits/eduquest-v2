-- =============================================================================
-- tenants.student_limit — enforce plan seat caps server-side
-- =============================================================================
-- The pricing plans promise "up to 50 students" (pilot) and "up to 500"
-- (institution), but nothing enforced it: a tenant could add unlimited
-- students. Found in the 2026-09-13 audit (AUDIT/09-billing-plan.md).
--
-- NULL = no cap. The column is NULL for every existing tenant, so applying
-- this migration changes NO behaviour until a super_admin sets a limit on a
-- specific tenant. Enforced in src/lib/student-limit.ts, called from
-- api/admin/create-user and api/auth/accept-invitation (the only two paths
-- that create a student account).
--
-- Idempotent — safe to re-run.
-- =============================================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS student_limit INTEGER
  CHECK (student_limit IS NULL OR student_limit >= 0);

COMMENT ON COLUMN public.tenants.student_limit IS
  'Plan seat cap on ACTIVE students. NULL = unlimited. Enforced in src/lib/student-limit.ts.';
