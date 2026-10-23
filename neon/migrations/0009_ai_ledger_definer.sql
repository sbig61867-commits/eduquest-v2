-- 0009 (Neon only, idempotent): the AI ledger functions run as their owner.
--
-- On Supabase, check_ai_allowance and record_ai_usage were SECURITY INVOKER and
-- called by service_role, which bypasses RLS. On Neon they are called by
-- app_service, which does not: as invoker they hit RLS on ai_usage_log /
-- ai_usage_daily / ai_usage_alerts / tenants (42501) — the allowance check
-- failed closed (503) and no usage was recorded.
--
-- Rather than give app_service table rights on the ledger, the two functions
-- become SECURITY DEFINER. They are already safe to run that way: every table
-- is schema-qualified, search_path is pinned, and the institution is
-- re-derived from public.users inside the function (never taken from the
-- caller). Execution stays with app_service only.

BEGIN;

ALTER FUNCTION public.check_ai_allowance(uuid) SECURITY DEFINER;
ALTER FUNCTION public.check_ai_allowance(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.record_ai_usage(uuid, text, text, text, text, integer, integer, bigint, bigint, boolean, numeric, numeric, integer, jsonb) SECURITY DEFINER;
ALTER FUNCTION public.record_ai_usage(uuid, text, text, text, text, integer, integer, bigint, bigint, boolean, numeric, numeric, integer, jsonb) SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.check_ai_allowance(uuid) FROM PUBLIC, anon, authenticated, app_user, app_system;
REVOKE ALL ON FUNCTION public.record_ai_usage(uuid, text, text, text, text, integer, integer, bigint, bigint, boolean, numeric, numeric, integer, jsonb) FROM PUBLIC, anon, authenticated, app_user, app_system;
GRANT EXECUTE ON FUNCTION public.check_ai_allowance(uuid) TO app_service;
GRANT EXECUTE ON FUNCTION public.record_ai_usage(uuid, text, text, text, text, integer, integer, bigint, bigint, boolean, numeric, numeric, integer, jsonb) TO app_service;

COMMIT;
