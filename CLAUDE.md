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

Vitest + Testing Library + Playwright are configured (`vitest.config.ts`, `src/__tests__/**`, `tests/*.spec.ts`) — coverage is still thin, but this is no longer a zero-test repo. Broader verification is still done by running the app against a live Supabase project.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · Supabase (Postgres + Auth + Storage) · Zustand. AI via Groq (text generation) and Google Gemini (vision/proctoring). Email via Resend.

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
- Proctoring: client-side TensorFlow/MediaPipe vision feeds `POST /api/proctor/analyze`, which calls Gemini (with a timeout) and appends events via `append_proctoring_events`.

### AI
`src/lib/ai/groq.ts` exports `groqChat(prompt, systemPrompt?)` — the shared Groq entry point for `api/ai/generate-exam` and `generate-lesson`. `src/lib/ai/gemini.ts` is used for proctoring vision analysis. Don't re-implement the provider fetch in route handlers; call the shared helper.

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

## Conventions

- Supabase joined-query results often need typed casts; the codebase uses `as unknown as RowType[]` with explicit interfaces rather than `as any`.
- Role display/routing helpers (`getRoleLabel`, `getRoleDashboardPath`) live in `src/lib/utils.ts` — reuse them, don't redefine per-component.
- Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, plus Gemini/Resend keys. App base URL resolves from `NEXT_PUBLIC_APP_URL` → `VERCEL_URL` → `localhost`.
