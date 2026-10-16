-- =============================================================================
-- anon table-write lockdown (post-plan security review 2026-10-16, item P1)
-- =============================================================================
-- Supabase's default privileges hand `anon` every table privilege on each new
-- table. 32 public tables still carried non-SELECT privileges for `anon`
-- (17 of them INSERT/UPDATE/DELETE; all 32 TRUNCATE, REFERENCES, TRIGGER and/or
-- MAINTAIN). RLS blocked every INSERT/UPDATE/DELETE an anonymous caller could
-- send, so nothing here was exploitable — but RLS is then the only wall, and
-- TRUNCATE / TRIGGER / REFERENCES / MAINTAIN are not governed by RLS at all.
-- PostgREST does not expose those four; this is defense in depth.
--
-- Verified before writing (live DB + code, 2026-10-16):
--   * No code path writes as `anon`. Every pre-auth write goes through the
--     service-role client: /api/contact (contact_messages insert),
--     /api/auth/login-id, /api/auth/forgot-password, /api/auth/accept-invitation,
--     /auth/callback, /join/[token], /api/proctor/second-camera/event,
--     src/lib/rate-limit.ts (check_rate_limit RPC). Signed-in pages run as
--     `authenticated`, which this file does not touch.
--   * No anon INSERT/UPDATE/DELETE policy is satisfiable: every write policy
--     needs auth.uid() / current_user_role(), both NULL for anon;
--     contact_messages and platform_settings policies are `TO authenticated`;
--     rate_limits has no policy at all.
--   * No column-level grants to anon; nothing granted through PUBLIC.
--
-- Deliberately NOT changed here:
--   * SELECT stays. Reads are governed by RLS; anon can today read exactly the
--     global feature_flags rows (tenant_id IS NULL) and nothing else.
--   * EXECUTE on public.current_*() stays for anon. The RLS policies anon's
--     SELECTs evaluate call those helpers, so revoking EXECUTE turns an empty
--     result into "permission denied for function" (verified in the dry-run).
--     They return NULL for anon, so nothing leaks.
--   * `authenticated` grants, RLS policies, default privileges.
--
-- Idempotent: revoking a privilege that is not held is a no-op.
-- Rollback: supabase/anon_table_write_lockdown_rollback.sql
-- Check:    supabase/tests/anon_table_write_lockdown_check.sql
-- =============================================================================

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON
  public.announcement_groups,
  public.announcements,
  public.attendance_records,
  public.attendance_sessions,
  public.contact_messages,
  public.course_enrollments,
  public.course_levels,
  public.course_units,
  public.courses,
  public.exam_appeals,
  public.exam_retake_permissions,
  public.exam_submissions,
  public.exams,
  public.feature_flags,
  public.grades,
  public.group_students,
  public.groups,
  public.invitations,
  public.lessons,
  public.platform_settings,
  public.rate_limits,
  public.request_messages,
  public.schedule_slots,
  public.schedules,
  public.staff_requests,
  public.student_progress,
  public.survey_responses,
  public.surveys,
  public.tenants,
  public.unit_items,
  public.unit_quiz_submissions,
  public.users
FROM anon;
