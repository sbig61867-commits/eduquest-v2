-- ============================================================
-- PRODUCTION RESET — delete all demo/test data, keep the owner
-- Written 2026-09-11. DESTRUCTIVE AND IRREVERSIBLE.
-- Run in the Supabase SQL Editor. Take a backup first.
-- ============================================================
--
-- WHAT SURVIVES
--   • the single super_admin account (owner) — auth identity + profile
--   • public.platform_settings — configuration, not data
--
-- WHAT IS DELETED
--   • every other auth.users identity, and everything that cascades from it:
--     public.users, groups, lessons, exams, exam_submissions, courses and
--     their units/items/enrolments, student_progress, staff_requests,
--     request_messages, announcements, schedules, schedule_slots, surveys,
--     survey_responses, grades
--   • every tenant (university) and its feature_flags
--   • all invitations, contact_messages, rate_limits
--
-- WHY DELETE FROM auth.users AND NOT public.users
--   public.users.id is a FK onto auth.users(id) ON DELETE CASCADE. Deleting
--   only the public row would strip the profile but leave a live auth
--   identity that can still authenticate — and log in to a half-created
--   account. Deleting the auth identity removes both, and every downstream
--   FK cascades from public.users.

BEGIN;

-- ── Guard 1: there must be exactly one super_admin ──────────
-- If a second one was ever created, the "keep the owner" intent is ambiguous
-- and this script must not guess. If there is none, something is very wrong
-- and deleting everything else would lock the platform out entirely.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.users WHERE role = 'super_admin';
  IF n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 super_admin, found %. Aborting — resolve this first.', n;
  END IF;
END $$;

-- ── 1. Invitations ──────────────────────────────────────────
-- Cleared first: invited_by / accepted_by reference users we are about to
-- delete, and clearing them up front avoids depending on how those specific
-- FK constraints happen to be configured.
DELETE FROM public.invitations;

-- ── 2. Every non-owner identity (cascades the whole domain) ─
DELETE FROM auth.users
WHERE id <> (SELECT id FROM public.users WHERE role = 'super_admin');

-- ── 3. Tenants ──────────────────────────────────────────────
-- The owner is cross-tenant (tenant_id IS NULL), so no university needs to
-- survive. feature_flags cascade from here.
DELETE FROM public.tenants;

-- ── 4. Standalone tables with no user FK ────────────────────
DELETE FROM public.contact_messages;   -- landing-page enquiries
DELETE FROM public.rate_limits;        -- throttling counters, safe to reset

-- public.platform_settings is intentionally NOT touched: it holds the
-- owner-configured invitation expiry and AI rate limits, not test data.

-- ── Guard 2: confirm the owner is still here ────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.users WHERE role = 'super_admin';
  IF n <> 1 THEN
    RAISE EXCEPTION 'Owner account did not survive the cleanup (found %). Rolling back.', n;
  END IF;
END $$;

COMMIT;

-- ── Verification ────────────────────────────────────────────
-- Expect: users = 1 (the owner), auth.users = 1, everything else 0 except
-- platform_settings.
--
--   SELECT 'auth.users' t, count(*) FROM auth.users
--   UNION ALL SELECT 'users', count(*) FROM public.users
--   UNION ALL SELECT 'tenants', count(*) FROM public.tenants
--   UNION ALL SELECT 'groups', count(*) FROM public.groups
--   UNION ALL SELECT 'exams', count(*) FROM public.exams
--   UNION ALL SELECT 'exam_submissions', count(*) FROM public.exam_submissions
--   UNION ALL SELECT 'invitations', count(*) FROM public.invitations
--   UNION ALL SELECT 'staff_requests', count(*) FROM public.staff_requests
--   UNION ALL SELECT 'platform_settings', count(*) FROM public.platform_settings
--   ORDER BY 1;
--
--   SELECT email, role, tenant_id, is_active FROM public.users;
