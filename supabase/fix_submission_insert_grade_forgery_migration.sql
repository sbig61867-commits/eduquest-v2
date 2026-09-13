-- ============================================================
-- FIX: grade forgery via direct INSERT into exam_submissions
-- Severity: CRITICAL — verified exploitable on the live DB 2026-09-11
-- Re-runnable / idempotent. Apply in the Supabase SQL Editor.
-- ============================================================
--
-- THE HOLE
-- --------
-- `rpc_execute_lockdown_migration.sql` closed the RPC path to grade forgery:
-- finalize_exam_submission recomputes the score in-DB and EXECUTE was revoked
-- from anon/authenticated. But it left the *table* path wide open.
--
-- `exam_submissions` carried an INSERT policy whose only WITH CHECK was:
--     student_id = auth.uid() AND tenant_id = current_tenant_id()
-- and `authenticated` held a plain INSERT grant. Nothing constrained `score`,
-- `max_score`, `is_graded` or `grading_status`, and nothing verified that the
-- student had ever started the exam — or was even enrolled in its group.
--
-- So any student, holding only the public anon key and their own session,
-- could do:
--     POST /rest/v1/exam_submissions
--     { "exam_id": "...", "student_id": "<self>", "tenant_id": "<own>",
--       "score": 100, "max_score": 100, "is_graded": true,
--       "grading_status": "published" }
-- and mint a perfect, published grade for an exam they never sat — including
-- an exam that is not published at all. Proven live (rolled back) against
-- exam 479980ff-… with the student test account: the row was created with
-- score 100/100, grading_status 'published'.
--
-- THE FIX
-- -------
-- Every legitimate write to exam_submissions in this codebase already goes
-- through the service-role client:
--     api/exam/start          → start_exam_attempt
--     api/exam/submit         → finalize_exam_submission
--     api/homework/submissions → admin .update() after teacher ownership check
-- There is NO client-side insert anywhere in src/. So the direct table write
-- path can be removed outright with zero behaviour change: drop the INSERT
-- policy and revoke the write grants. SELECT is untouched, so students keep
-- reading their own grades and teachers keep reading their own exams'.
--
-- Defence in depth, not a replacement: the RPCs remain the only writers, and
-- they already re-derive student_id/tenant_id from public.users rather than
-- trusting the caller (r1_defense_in_depth_service_role_rpcs_migration.sql).

BEGIN;

-- ── 1. exam_submissions ─────────────────────────────────────
-- Remove the forgeable client INSERT path.
DROP POLICY IF EXISTS submissions_insert ON public.exam_submissions;

-- Belt and braces: even if a policy is re-added by accident later, the role
-- has no write privilege to exercise it. RLS and GRANTs are independent gates;
-- a write needs BOTH, so revoking here is a second, separate lock.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.exam_submissions FROM anon, authenticated;

-- SELECT stays: students read their own submissions, teachers read the
-- submissions of exams they own, super_admin reads all (submissions_select).
GRANT SELECT ON public.exam_submissions TO authenticated;

-- ── 2. unit_quiz_submissions ────────────────────────────────
-- Identical shape, identical hole: student-writable `score` / `max_score`
-- behind a WITH CHECK that only pins student_id + tenant_id. This table has
-- zero references in src/ (the in-course quiz feature is not wired up) and
-- zero rows, so locking it down cannot break anything. Left open, it becomes
-- the same forgery the moment the feature ships.
DROP POLICY IF EXISTS unit_quiz_submissions_insert ON public.unit_quiz_submissions;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.unit_quiz_submissions FROM anon, authenticated;
GRANT SELECT ON public.unit_quiz_submissions TO authenticated;

-- ── 3. grades ───────────────────────────────────────────────
-- Not student-writable (insert requires teacher/university_admin/super_admin),
-- so not a forgery path. But `university_admin` is metadata-only by design
-- (admin_metadata_only_migration.sql) and must not author grades, and no code
-- in src/ writes this table at all — every grade lives in exam_submissions.
-- Close the unused write path rather than leave a second, weaker grade store.
DROP POLICY IF EXISTS grades_insert ON public.grades;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.grades FROM anon, authenticated;
GRANT SELECT ON public.grades TO authenticated;

-- ── 4. student_progress — deliberately NOT locked ───────────
-- This one IS written from the browser (src/app/(student)/student/courses/[id]/
-- course-player-client.tsx marks an item complete). It has no score column —
-- the worst a student can do is mark their own lesson items complete, which is
-- self-inflicted and carries no grade weight. The existing policy already pins
-- student_id = auth.uid() and tenant_id = current_tenant_id(). Left as is.

-- `anon` should never write any of these regardless of policy.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.student_progress FROM anon;

COMMIT;

-- ── Verification ────────────────────────────────────────────
-- Expect: exam_submissions / unit_quiz_submissions / grades show SELECT only
-- for authenticated, and nothing at all for anon.
--
--   SELECT table_name, grantee,
--          string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
--   FROM information_schema.role_table_grants
--   WHERE table_schema = 'public'
--     AND grantee IN ('anon','authenticated')
--     AND table_name IN ('exam_submissions','unit_quiz_submissions','grades')
--   GROUP BY 1,2 ORDER BY 1,2;
--
-- Expect: no INSERT ('a') policy remains on those three tables.
--
--   SELECT c.relname, p.polname, p.polcmd
--   FROM pg_policy p
--   JOIN pg_class c ON c.oid = p.polrelid
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public'
--     AND c.relname IN ('exam_submissions','unit_quiz_submissions','grades')
--   ORDER BY 1, 3;
--
-- Expect: the exploit now fails with "new row violates row-level security
-- policy" (or a permission-denied on the grant), instead of returning a row.
