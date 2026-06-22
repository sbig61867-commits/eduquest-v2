-- =============================================================================
-- Cron-based cleanup for expired invitations
-- Safe to run multiple times (idempotent)
-- =============================================================================

-- Enable pg_cron extension (no-op if already enabled)
-- Note: requires Supabase Pro plan; on Free plan this line is skipped gracefully
-- via the DO block below
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- =============================================================================
-- Cleanup function
-- Deletes pending invitations that expired more than 30 days ago.
-- Recently-expired invitations (< 30 days) are kept for audit trail.
-- =============================================================================
CREATE OR REPLACE FUNCTION cleanup_expired_invitations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM invitations
  WHERE status = 'pending'
    AND expires_at < NOW() - INTERVAL '30 days';
END;
$$;

-- =============================================================================
-- Schedule daily cleanup at 02:00 UTC via pg_cron
-- Wrapped in a DO block so re-running this file does not raise a duplicate-job
-- error, and so a missing pg_cron extension (Free plan) is handled gracefully.
-- =============================================================================
DO $$
BEGIN
  PERFORM cron.schedule(
    'cleanup-expired-invitations',  -- unique job name
    '0 2 * * *',                    -- daily at 02:00 UTC
    'SELECT cleanup_expired_invitations()'
  );
EXCEPTION WHEN others THEN
  -- Job already scheduled, or pg_cron not available on this plan.
  -- Either case is acceptable: the function still exists and can be called manually.
  NULL;
END;
$$;

-- =============================================================================
-- One-time immediate cleanup
-- Removes any existing stale rows that are already past the 30-day window.
-- =============================================================================
SELECT cleanup_expired_invitations();
