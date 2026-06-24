-- ============================================================
-- Migration: lock down direct access to the rate_limits table
-- ------------------------------------------------------------
-- The rate_limits table had no RLS enabled, so in Supabase it was
-- directly reachable via the PostgREST API by any authenticated
-- user. That let a user read other users' rate-limit keys
-- (feature:userId) and delete/reset their own counter to bypass
-- the limiter entirely (e.g. unlimited AI calls).
--
-- All legitimate access goes through the check_rate_limit RPC,
-- which is SECURITY DEFINER and bypasses RLS. Enabling RLS with NO
-- policies therefore denies every direct table operation while the
-- limiter keeps working unchanged.
--
-- Idempotent / re-runnable.
-- ============================================================

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
