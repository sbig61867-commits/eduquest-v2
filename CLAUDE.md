# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Next.js dev server (http://localhost:3000)
npm run build    # production build
npm run start    # serve the production build
npm run lint     # eslint (flat config, eslint-config-next)
```

There is **no test framework** configured in this repo. Verification is done by running the app against a live Supabase project.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · Supabase (Postgres + Auth + Storage) · Zustand. AI via Groq (text generation) and Google Gemini (vision/proctoring). Email via Resend.

## Architecture

### Multi-tenant, role-based SaaS
Four roles (`src/types`): `super_admin`, `university_admin`, `teacher`, `student`. Every domain row carries a `tenant_id` (a "university"); tenant isolation is enforced by Postgres **Row Level Security**, not application code. `super_admin` is cross-tenant; everyone else is scoped to their `tenant_id`.

App routes are organized by role into route groups, each with its own layout/sidebar:
`src/app/(super-admin)`, `src/app/(admin)` (= university_admin), `src/app/(teacher)`, `src/app/(student)`, plus `src/app/(auth)` (login + `/join/[token]` invitation acceptance).

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

Once that migration is applied, RLS-scoped reads work correctly again, so route/page code should read through the **user session client** (`src/lib/supabase/server.ts`), not the service-role admin client — the admin client bypassed RLS as a workaround and is no longer needed for plain reads. Keep manual `.eq('tenant_id', ...)` / `.eq('teacher_id', ...)` filters as defense-in-depth even though RLS now enforces them. The service-role client remains correct for: privileged writes that need cross-tenant verification first (`api/admin/*`, `accept-invitation`), tables with **no** SELECT policy at all (e.g. `group_students` — RLS enabled, zero policies, so admin is the only way to read it), and the rate-limit table.

## Applied migrations (already on live DB — do NOT re-run)

- `fix_helper_search_path.sql` — pins search_path on RLS helper functions
- `fix_all_search_path_migration.sql` — pins search_path on all SECURITY DEFINER RPCs
- `soft_delete_archive_migration.sql` — adds deleted_at soft-delete columns + archive RPC
- `hide_archived_rls_migration.sql` — wraps SELECT policies with deleted_at IS NULL
- `rls_performance_migration.sql` — performance-optimized RLS policies + hot-path indexes
- `security_rls_fix_migration.sql` — patches users_update / grades_select / lessons_select vulnerabilities ✅ 2026-07-11
- `performance_indexes_migration.sql` — idx_lessons_teacher_live, idx_exams_teacher_live, idx_grades_exam_id ✅ 2026-07-11

## Conventions

- Supabase joined-query results often need typed casts; the codebase uses `as unknown as RowType[]` with explicit interfaces rather than `as any`.
- Role display/routing helpers (`getRoleLabel`, `getRoleDashboardPath`) live in `src/lib/utils.ts` — reuse them, don't redefine per-component.
- Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, plus Gemini/Resend keys. App base URL resolves from `NEXT_PUBLIC_APP_URL` → `VERCEL_URL` → `localhost`.
