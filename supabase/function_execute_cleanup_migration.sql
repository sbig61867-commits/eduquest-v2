-- =============================================================================
-- Function EXECUTE cleanup (read-only audit of the 65 public functions, 2026-10-16)
-- =============================================================================
-- Hygiene, not an exploitable fix: every function below already authorizes
-- inside (or holds no data). It narrows who may call them.
--
-- 1. member_role_letter(text) — pure IMMUTABLE helper (role -> one letter),
--    SECURITY INVOKER. Its only caller is the assign_member_code() trigger,
--    SECURITY DEFINER owned by postgres, so it runs as postgres whatever role
--    inserted the user. PUBLIC / anon / authenticated never need it.
--    service_role keeps EXECUTE (the platform pattern).
--
-- 2. Five functions with no caller anywhere — not in src/, not in another
--    function, policy, view or cron job (verified live + git grep; only
--    comments and the perf-contract ban list mention them):
--      get_admin_exams()      superseded by get_admin_exams_page()   (P-02)
--      get_admin_lessons()    superseded by get_admin_lessons_page() (P-02)
--      exam_live_role(text)   superseded by exam_topic_role(text) in the
--                             realtime.messages policies (live thumbnails)
--      get_tenant_ai_usage()  superseded by get_ai_usage_report()
--      get_student_exams()    superseded by get_student_exam_list(); it uses
--                             auth.uid(), which is NULL for service_role
--                             (hard rule 2), so the service_role grant that
--                             student_exam_list_lockdown_migration.sql kept
--                             can only ever return nothing.
--    EXECUTE is revoked from every API role (owner `postgres` keeps it). The
--    functions are NOT dropped, so the rollback is a pure GRANT.
--
-- Known side effect: three historical check scripts call these as
-- authenticated / read L10 and will report errors or FAIL after this:
-- tests/content_feeds_check.sql, tests/scale_baseline_check.sql,
-- tests/student_exam_list_check.sql (L10). They measure migrations that are
-- already applied and are not part of the regression set.
--
-- schema.sql does not define 5 of these 6. Its realtime.messages policies were
-- moved to exam_topic_role() (matching live) on the same branch, so nothing in
-- a fresh build depends on exam_live_role() any more; its schema.sql grants are
-- updated together with this migration when it is applied.
--
-- Not changed: the 7 current_*() helpers anon can execute (anon's RLS-evaluated
-- SELECTs need them — revoking returns 42501), all other grants, policies.
--
-- Idempotent. Rollback: supabase/function_execute_cleanup_rollback.sql
-- Check:    supabase/tests/function_execute_cleanup_check.sql
-- =============================================================================

REVOKE ALL ON FUNCTION public.member_role_letter(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_role_letter(text) TO service_role;

REVOKE ALL ON FUNCTION public.get_admin_exams()        FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_admin_lessons()      FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.exam_live_role(text)     FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_tenant_ai_usage()    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_student_exams()      FROM PUBLIC, anon, authenticated, service_role;
