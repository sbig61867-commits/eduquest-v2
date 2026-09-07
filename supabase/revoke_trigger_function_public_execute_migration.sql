-- Applied live 2026-09-06 (migration 20260906153337 in Supabase's tracked
-- history). Recorded here per the repo's own convention: every DB change
-- gets a standalone re-runnable file, not just a live apply_migration call.
--
-- Trigger functions (RETURNS trigger) have no legitimate reason to be
-- directly PostgREST-callable via /rest/v1/rpc/<name>. Postgres already
-- blocks direct SELECT-style invocation of trigger functions ("trigger
-- functions can only be called as triggers"), so this is defense-in-depth
-- + silences the security advisor, not a fix for an exploitable path.
-- Revoking EXECUTE does NOT affect trigger firing (trigger invocation is
-- not gated by the caller's EXECUTE grant on the function).
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_user_claims() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cascade_tenant_active_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.deactivate_users_on_tenant_delete() FROM PUBLIC, anon, authenticated;
