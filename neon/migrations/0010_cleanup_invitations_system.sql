-- 0010 — the daily invitation cleanup runs from a Cloudflare Cron Trigger
-- (step 12), not pg_cron: the Worker calls POST /api/cron/daily, which runs
-- this function as app_system. Same rule as supabase/cron_cleanup.sql: pending
-- invitations that expired more than 30 days ago are deleted.
--
-- Hardened on the way (CLAUDE.md hard rules 1–3): schema-qualified table,
-- pinned search_path, execute revoked from PUBLIC/anon/authenticated and
-- granted to app_system only. Returns how many rows went, for the job's log.
-- Idempotent.

BEGIN;

DROP FUNCTION IF EXISTS public.cleanup_expired_invitations();

CREATE FUNCTION public.cleanup_expired_invitations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM public.invitations
   WHERE status = 'pending'
     AND expires_at < now() - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_invitations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_invitations() TO app_system;

COMMIT;
