# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Next.js dev server (http://localhost:3000)
npm run build    # production build
npm run start    # serve the production build
npm run lint     # eslint (flat config, eslint-config-next)
npm test         # vitest run — unit/component specs (src/__tests__/**)
npm run test:watch
```

Vitest + Testing Library + Playwright are configured (`vitest.config.ts`, `src/__tests__/**`, `tests/*.spec.ts`) — coverage is still thin, but this is no longer a zero-test repo. As of 2026-09-07: 63 Vitest unit/component tests, plus `tests/security-auth.spec.ts` (17 Playwright tests, run live against production — auth redirects, role isolation with a real test account, API-route access control, security headers). `npx vitest run --pool=threads` avoids a fork-pool sandbox flake seen in this environment; `npm test`'s default pool can intermittently fail to start a worker. Broader verification is still done by running the app against a live Supabase project — see `SECURITY_TEST_MATRIX.md` for exactly what each test does and does not prove (e.g. none of the current tests exercise cross-tenant isolation, since only one real tenant exists in production).

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · Supabase (Postgres + Auth + Storage) · Zustand. AI via Groq (text generation) and Google Gemini (lesson fallback + scanned-file extraction). Exam proctoring uses **no AI provider** — it runs on the student's device (MediaPipe + TensorFlow.js). Email via Resend.

## Architecture

### Multi-tenant, role-based SaaS
Five roles (`src/types`): `super_admin`, `university_admin`, `center_manager`, `teacher`, `student`. `center_manager` is the continuing-education centre manager / admin assistant, whose actual abilities are per-user capability flags (see **Staff collaboration** below). Every domain row carries a `tenant_id` (a "university"); tenant isolation is enforced by Postgres **Row Level Security**, not application code. `super_admin` is cross-tenant; everyone else is scoped to their `tenant_id`.

App routes are organized by role into route groups, each with its own layout/sidebar:
`src/app/(super-admin)`, `src/app/(admin)` (= university_admin), `src/app/(center)` (= center_manager), `src/app/(teacher)`, `src/app/(student)`, plus `src/app/(auth)` (login + `/join/[token]` invitation acceptance).

### Auth & routing gate — `src/proxy.ts`
Next.js 16 renames middleware to **`proxy.ts`** (exports `proxy()` + `config.matcher`). This is the single auth/RBAC gate. It calls `updateSession()` (`src/lib/supabase/middleware.ts`) to refresh the session, then enforces login, account-active status, tenant presence, and role-to-route-prefix mapping (`ROLE_ROUTES`).

**Identity lives in the JWT.** `role`, `is_active`, and `tenant_id` are mirrored into `auth.users.app_metadata` by the `sync_user_claims` trigger, so the proxy reads them from `getUser()` with **no per-request DB query**. A one-time DB fallback covers users whose claims were never backfilled. When changing a user's role/status/tenant, that change must flow through `public.users` so the trigger re-syncs the JWT.

### Supabase client selection (pick by context)
- `src/lib/supabase/client.ts` — browser (`createBrowserClient`), anon key, subject to RLS. Used in `'use client'` components for reads/writes the user is allowed to do.
- `src/lib/supabase/server.ts` — RSC / route handlers (`createServerClient` + cookies), anon key, subject to RLS, runs as the logged-in user.
- **Service-role admin client** — `createClient` from `@supabase/supabase-js` with `SUPABASE_SERVICE_ROLE_KEY`, **bypasses RLS**. Instantiated locally inside route handlers that need privileged writes (see `src/app/api/admin/*`, `accept-invitation`, `rate-limit.ts`).

**Privileged-write pattern** (used in `api/admin/toggle-user`, `create-user`, `accept-invitation`): authenticate + authorize with the *user* session, verify the target belongs to the caller's tenant, then perform the actual write with the *admin* client. Never use the admin client for authorization decisions.

### RLS helper functions — pin `search_path`
RLS policies call `current_user_role()` and `current_tenant_id()` (`SECURITY DEFINER`, query `public.users` by `auth.uid()`). **These — and any other `SECURITY DEFINER` function — must schema-qualify their tables (`public.users`) and set `SET search_path = public, pg_temp`.** Without it, PostgREST runs them under a restricted `search_path`, the unqualified table is "not found", the function returns NULL, and *every* policy that calls it silently denies writes with **403**. This presents as "teacher can't create a group/lesson/exam" while the same SQL works in the SQL Editor (whose session has `public` on the path). See `supabase/fix_helper_search_path.sql`.

### Staff collaboration (requests · announcements · schedules)
Three staff subsystems share one shape: **capability-gated writes**. `users.permissions` (JSONB) holds per-user
capability flags whose role defaults are resolved in `src/lib/permissions.ts` (`university_admin` default-ON,
`center_manager` default-OFF); `users_update`'s WITH CHECK pins `permissions`/`role`/`can_create_courses`
so nobody can self-grant. Route handlers check the capability with the **user session**, then write with the
**service-role** client, so these tables intentionally have SELECT policies only.
- **Requests** (`staff_requests`/`request_messages`) — teacher↔admin request inbox with a message thread.
- **Announcements** (`announcements`) — student-facing cards; students read `get_student_announcements()`.
- **Schedules** (`schedules`/`schedule_slots`) — weekly timetables, gated by `manage_schedules`. One official
  timetable per group (publishable to its students) or one private timetable per teacher (informal exams,
  never shown to students). Students have **no** direct row read — `get_student_schedule()` applies
  publication state and group enrolment. Day numbering is 0=Sunday…6=Saturday.

### Exam integrity (server-authoritative)
Exam timing and grading never trust the client:
- `POST /api/exam/start` → `start_exam_attempt` RPC records the authoritative server start time (idempotent; refresh resumes).
- `POST /api/exam/submit` → grades server-side from the DB (`correct_answer` never leaves the server), merges server-written proctoring events, then `finalize_exam_submission`.
- Proctoring runs **entirely on the student's device**: MediaPipe (face/gaze, `use-face-detection.ts`) and TensorFlow.js COCO-SSD (phone/book/extra person, `use-object-detection.ts`), plus audio/tab/fullscreen listeners. No camera frame is sent anywhere for analysis. `use-proctor-recorder.ts` batches + dedupes detections to `POST /api/proctor/events` (→ `append_proctoring_events`); `use-evidence-capture.ts` sends a capped number of snapshots for severe violations only. A detector that fails to load records a `detector_unavailable` event (not a violation). The former Gemini frame layer (`/api/proctor/analyze`, `use-server-proctoring.ts`, `NEXT_PUBLIC_SERVER_PROCTORING`) was removed 2026-09-13 — don't reintroduce server-side frame analysis (free-tier Gemini capped real concurrency at single digits and failed silently).

### AI
`src/lib/ai/groq.ts` exports `groqChat(prompt, systemPrompt?)` — the shared Groq entry point for `api/ai/generate-exam` and `generate-lesson`. `src/lib/ai/gemini.ts` is a lesson-generation fallback (and `src/lib/ai/extract.ts` uses Gemini vision for scanned files) — it is not used for proctoring. Don't re-implement the provider fetch in route handlers; call the shared helper.

### Rate limiting
`src/lib/rate-limit.ts` `rateLimit(key, {limit, windowSecs})` is backed by the Postgres `check_rate_limit` RPC (survives serverless cold starts; fails **open** if the limiter errors). Apply it in AI/expensive route handlers keyed by `feature:userId`.

## Database / migrations

The schema and all changes live as SQL files in `supabase/`, applied **manually in the Supabase SQL Editor** (no migration CLI). `schema.sql` is the base; the other files are ordered, idempotent migrations (e.g. `invitations_migration.sql`, `rls_performance_migration.sql`, `courses_migration.sql`, `phase1_migration.sql`, `platform_hardening_migration.sql`). When you change DB behavior: update `schema.sql` to reflect the new state **and** add a standalone re-runnable migration file. Triggers `handle_new_user` (placeholder profile on signup) and `sync_user_claims` (JWT claim sync) are central — both use exception handlers so they don't block auth.

**Run `supabase/fix_all_search_path_migration.sql` on the live DB** (in addition to the already-applied `fix_helper_search_path.sql`) — it pins `search_path` on `check_rate_limit`, `start_exam_attempt`, `append_proctoring_events`, `finalize_exam_submission`, `cleanup_expired_invitations`, and `get_invitation_by_token`, which were found missing it (same class of bug: unqualified table refs under PostgREST's restricted search_path → silent 403/failure).

Once that migration is applied, RLS-scoped reads work correctly again, so route/page code should read through the **user session client** (`src/lib/supabase/server.ts`), not the service-role admin client — the admin client bypassed RLS as a workaround and is no longer needed for plain reads. Keep manual `.eq('tenant_id', ...)` / `.eq('teacher_id', ...)` filters as defense-in-depth even though RLS now enforces them. The service-role client remains correct for: privileged writes that need cross-tenant verification first (`api/admin/*`, `accept-invitation`), tables with **no** SELECT policy at all (currently only `rate_limits` — RLS enabled, zero policies), and any write path that must bypass RLS after app-level authorization.

> Verified 2026-09-05: `group_students` **does** now have select/insert/delete policies, so it is readable through the user-session client. (This file previously claimed it had zero policies — that was stale and led to unnecessary admin-client use.)

## Applied migrations (already on live DB — do NOT re-run)

- `fix_helper_search_path.sql` — pins search_path on RLS helper functions
- `fix_all_search_path_migration.sql` — pins search_path on all SECURITY DEFINER RPCs
- `soft_delete_archive_migration.sql` — adds deleted_at soft-delete columns + archive RPC
- `hide_archived_rls_migration.sql` — wraps SELECT policies with deleted_at IS NULL
- `rls_performance_migration.sql` — performance-optimized RLS policies + hot-path indexes
- `security_rls_fix_migration.sql` — patches users_update / grades_select / lessons_select vulnerabilities ✅ 2026-07-11
- `performance_indexes_migration.sql` — idx_lessons_teacher_live, idx_exams_teacher_live, idx_grades_exam_id ✅ 2026-07-11
- `survey_migration.sql` — surveys / survey_responses tables + RLS for the in-platform pilot feedback survey (feeds the "pilot" report scope) ✅ 2026-07-12 — full flow (teacher creates → student answers → pilot report renders survey averages + quotes) verified end-to-end on production 2026-07-12
- `admin_metadata_only_migration.sql` — university_admin loses direct read on lessons/exams/submissions/grades; adds `get_admin_lessons()` / `get_admin_exams()` metadata feeds ✅ 2026-09-04
- `staff_requests_migration.sql` — `staff_requests` + `request_messages` (teacher↔admin request inbox + thread) ✅ 2026-09-04
- `phase2_permissions_announcements_migration.sql` — `center_manager` role, `users.permissions` JSONB, announcements tables + `get_student_announcements()`, public `announcement-images` bucket ✅ 2026-09-05
- `fk_covering_indexes_migration.sql` — 22 covering indexes for unindexed foreign keys ✅ 2026-09-05
- `rpc_execute_lockdown_migration.sql` — **PART A + PART B both applied** ✅ 2026-09-05. Part A gives authoritative in-DB grading (kills grade forgery) and completes the `get_student_exams` revoke (the original `REVOKE ... FROM anon` was ineffective — anon inherits EXECUTE via PUBLIC). Part B revoked EXECUTE on `finalize_exam_submission` / `start_exam_attempt` / `append_proctoring_events` after the service-role-client code shipped. Verified grant matrix: `anon` false everywhere; `authenticated` true only for the internally-guarded read feeds.
- `rls_initplan_optimization_migration.sql` — wraps `auth.uid()` / `current_user_role()` / `current_tenant_id()` in `(SELECT …)` across 16 policies so they evaluate once per query instead of once per row (`auth_rls_initplan`: 16 → 0). Semantics proven unchanged by stripping the wrappers and diffing against a pre-change snapshot (16/16 identical). ✅ 2026-09-05
- `phase3_schedules_migration.sql` — weekly timetables: `schedules` (one per group, or one private per teacher) + `schedule_slots` over a 7-day week, RLS for staff/teachers, and the `get_student_schedule()` feed (published + enrolled only, `anon` revoked). ✅ 2026-09-05
- `revoke_trigger_function_public_execute_migration.sql` — revokes EXECUTE on 4 trigger-only SECURITY DEFINER functions from PUBLIC/anon/authenticated (defense-in-depth; Postgres already blocks direct invocation of trigger functions). ✅ 2026-09-06
- `fix_get_course_progress_cross_tenant_idor_migration.sql` — fixes a real cross-tenant IDOR: `get_course_progress` authorized any teacher/university_admin globally with no tenant check on the target course/student. ✅ 2026-09-06
- `r1_defense_in_depth_service_role_rpcs_migration.sql` — `start_exam_attempt`, `soft_delete_entity`, `restore_entity` (gains a new required `p_actor` param), `append_proctoring_events` no longer trust caller-supplied tenant_id/actor/student_id at face value; each re-derives the real fact from `public.users`/`public.exams`/the target entity and rejects on mismatch. `restore_entity`'s old 3-arg signature is dropped. ✅ 2026-09-06 — see `SECURITY_DEFINER_PROOF.md` for the full per-function proof.
- `fix_get_course_progress_flat_courses_migration.sql` — `get_course_progress` counted items through an INNER join on `course_levels`, so flat courses (`has_levels = FALSE`, units with `level_id IS NULL`) always reported 0%. Now counts through `course_units.course_id`, which is NOT NULL for both shapes, and applies the `is_published` filter to the completed count as well as the total. ✅ 2026-09-09
- `fix_submission_insert_grade_forgery_migration.sql` — **CRITICAL.** `rpc_execute_lockdown` closed the RPC path to grade forgery but left the *table* path open: `exam_submissions` had an INSERT policy whose WITH CHECK only pinned `student_id`/`tenant_id`, and `authenticated` held an INSERT grant, so any student could `POST /rest/v1/exam_submissions` with `score: 100, grading_status: 'published'` for an exam they never sat. Verified exploitable live, then closed by dropping the INSERT policy and revoking write grants on `exam_submissions`, `unit_quiz_submissions` and `grades` (all writes already go through the service-role client). `student_progress` keeps its INSERT policy — the course player writes it from the browser and it has no score column. ✅ 2026-09-11
- `fix_student_pii_overexposure_migration.sql` — a full security audit created two real test tenants + 7 real accounts in production and live-verified 9 cross-tenant attack attempts were all blocked (see `AUDIT/11-security-isolation-tests.md`), but found a real *intra-tenant* gap along the way: `users_select`/`groups_select`/`group_students_select` had no role check beyond `tenant_id = current_tenant_id()`, so any student account could enumerate every user's email/name/role in their own university (not another tenant's) plus every group's full roster, via a plain `GET /rest/v1/users?tenant_id=eq.<own tenant>`. Fixed for the `student` role only — `teacher`/`university_admin`/`center_manager`/`super_admin` keep tenant-wide read (traced against every client-side `users`/`groups`/`group_students` query in `src/app` first; `teacher/groups/page.tsx`'s "Manage Students" modal genuinely depends on a teacher browsing the whole tenant's student body). Adds `current_student_group_ids()` (SECURITY DEFINER, breaks an RLS-recursion cycle between `groups_select` and `group_students_select` — hit and confirmed live while drafting the fix). Verified live before AND after via a rolled-back test transaction and the `tests/tenant-isolation.spec.ts` suite (all 9 cases still pass; the PII case specifically flips from "leaks 3+ rows" to "≤2 rows, never includes the tenant admin"). ✅ 2026-09-13
- `tenant_student_limit_migration.sql` — `tenants.student_limit` (NULL = unlimited, NULL for every existing tenant, so no behaviour change until set). Enforced in `src/lib/student-limit.ts`, called from `api/admin/create-user` and `api/auth/accept-invitation`. Verified live on a throwaway tenant (cap 0 → 403, cap 1 → first join 200 / second 403, refused join creates no auth user). ✅ 2026-09-13
- `exam_appeals_migration.sql` — `exam_appeals` table (student dispute of a proctoring flag → exam teacher → admin report), SELECT policy only, writes via `api/appeals/*` with the service-role client, denormalized name/title snapshots. Verified end-to-end live with real logins (file 201, duplicate 409, teacher resolve persisted, admin JSON + xlsx report), all test data removed. ✅ 2026-09-13

## Pending migrations (written + tested in a rolled-back transaction — NOT applied)

- `fix_rls_write_path_migration.sql` — **CRITICAL.** The 2026-09-13 audit re-verification found the write path was never tested: `invitations_update` let a teacher turn their own invitation into `role='university_admin'` (and `accept_invitation` trusts `inv.role`), plus five cross-tenant write paths (invitation into a foreign group, lesson moved / exam inserted into a foreign group, foreign student enrolled, student self-enrolment into a foreign course readable via `get_student_exams`) and two intra-tenant ones (request state-machine bypass, enrolling other students). Fix: drop write policies + revoke writes on tables only written by service-role routes, owner-scope the course-builder tables via `can_edit_course()`, tenant checks in `lessons_select`/`get_student_exams`/`accept_invitation`, `pg_temp` on the remaining SECURITY DEFINER functions. Regression check: `supabase/tests/rls_write_path_check.sql`.

## Conventions

- Supabase joined-query results often need typed casts; the codebase uses `as unknown as RowType[]` with explicit interfaces rather than `as any`.
- Role display/routing helpers (`getRoleLabel`, `getRoleDashboardPath`) live in `src/lib/utils.ts` — reuse them, don't redefine per-component.
- Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, plus Gemini/Resend keys. App base URL resolves from `NEXT_PUBLIC_APP_URL` → `VERCEL_URL` → `localhost`.
