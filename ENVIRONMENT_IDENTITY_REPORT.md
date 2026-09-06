# Environment Identity Report

**Date:** 2026-09-06
**Purpose:** Prove, read-only, whether the Supabase project this session has been
auditing (`ubngpsdzjoeqfxfbdtxc`) is the same one backing the live production
deployment at `https://eduquest-v2.vercel.app`, before running any Tenant A/B
write tests. No writes were performed to reach these conclusions.

---

## 1. Evidence table

| Check | Repository | Local Env (`.env.local`) | Supabase Live (MCP) | Vercel (live deployment) | Status |
|---|---|---|---|---|---|
| Project ref string | `scripts/run-migration.mjs:61` hardcodes `db.ubngpsdzjoeqfxfbdtxc.supabase.co` | `NEXT_PUBLIC_SUPABASE_URL=https://ubngpsdzjoeqfxfbdtxc.supabase.co` | `list_projects` → single project, `ref: "ubngpsdzjoeqfxfbdtxc"`, name `eduquest-v2` | Production JS bundle (`/_next/static/immutable/chunks/0iak68d_0ks5b.js`, fetched live) contains literal string `ubngpsdzjoeqfxfbdtxc.supabase.co` | **MATCH — all four sources agree** |
| Note on the ref you asked me to compare against, `ubngpsdzjoeqfxfbdtxc3` | — | — | — | — | That string has a trailing `3` not present anywhere in the repo, `.env.local`, the live Supabase project list, or the deployed bundle. Every real reference found is `ubngpsdzjoeqfxfbdtxc` (24 chars, no `3`). I'm treating the `3` as a transcription artifact in your message, not a second real project — I found no evidence anywhere of a project by that name. |
| Supabase branches | — | — | `list_branches` → `[]` (empty) | — | **No branches exist.** This is not a preview-branch-vs-production mismatch; there is exactly one Postgres instance for this project, period. |
| Other Supabase projects on this account | — | — | `list_projects` → **exactly one project total** (`eduquest-v2`, created 2026-06-21, org `erdrioxleiroxluppqfz`) | — | Confirmed there is no second/staging Supabase project this session could have accidentally connected to instead. |
| Vercel → Supabase linkage | `vercel.json` only sets `{"regions":["fra1"]}` — no project linkage info (that lives in Vercel's dashboard, not the repo) | — | — | Fetched the live production login page (`GET /login`), extracted its JS chunk URLs, downloaded them, and grepped for a 20-char lowercase-alphanumeric `*.supabase.co` string. Found it in exactly one chunk, value `ubngpsdzjoeqfxfbdtxc.supabase.co` | **CONFIRMED via live artifact inspection** — this is the strongest evidence available without Vercel API/CLI login (the CLI is installed but not authenticated in this session — `vercel whoami` returned no session, so Vercel's own env-var listing could not be queried directly; the bundle-grep is the independent alternative and it's conclusive because `NEXT_PUBLIC_*` vars are baked into the client JS at build time — there's no way for the deployed bundle to contain a different project's URL than the one actually configured in Vercel at build time) |
| Migration history | `supabase/*.sql` — files match names in the live migration table | — | `list_migrations` → 11 tracked migrations, most recent `revoke_trigger_function_public_execute` at `2026-09-06 15:33:37` (applied by me, this session) | — | **Consistent, no gap or reset marker.** The chain matches `CLAUDE.md`'s documented history (`admin_metadata_only` → `staff_requests` → `rpc_execute_lockdown_part_a/b` → `phase2_permissions_announcements` → `fk_covering_indexes` → `rls_initplan_optimization` → `phase3_schedules` → `users_update_pin_capability_columns` → today's fix). No `db reset`, no destructive-migration marker, no unexplained version jump. |
| Schema presence + RLS | `supabase/*.sql` defines these tables | — | Queried `pg_tables` + `pg_policies` directly: **19/19** expected tables present (`tenants, users, groups, group_students, courses, course_enrollments, lessons, exams, exam_submissions, grades, invitations, staff_requests, announcements, schedules, schedule_slots, surveys, survey_responses, exam_retake_permissions, rate_limits`), **all 19 have RLS enabled**, all but `rate_limits` (intentionally policy-less, documented) have ≥1 policy | — | **Schema matches repository expectations, no drift detected.** (Note: `exam_attempts` and `notifications` as standalone tables were not found — this matches the codebase too: there is no dedicated `exam_attempts` table, attempt state lives on `exam_submissions` via the `start_exam_attempt` RPC, and student notifications are served through `get_student_announcements()`, not a separate `notifications` table. Not a discrepancy.) |
| `git log` for `.env*` changes | `.env.local`/`.env.production` are gitignored — **zero commits touch them** (expected; secrets should never be committed) | — | — | — | No evidence either way from git history (by design — this file is correctly never committed) |
| Seed/reset scripts in repo | `scripts/verify-system.mjs` — creates a **throwaway, timestamp-named** tenant/admin/teacher/student (`test-uni-<ts>`, `teacher-<ts>-xxxx@test.local`), runs assertions, then explicitly deletes only the IDs it created itself in `finish()` | — | — | — | **Read the full script.** Its cleanup is scoped to self-tracked IDs (`created.tenants/users/groups/lessons`) — it does **not** perform a blanket `DELETE FROM tenants` or similar. It cannot explain a wipe of a previously-populated production tenant; at most, an abnormal process kill mid-run could leave one orphaned `*-<timestamp>-xxxx@test.local` row, which is **not** what's present (see next row). |
| The single row in `public.users` right now | — | — | `id=622217fa-...`, `email=sbig61867@gmail.com`, `role=super_admin`, `tenant_id=NULL`, `created_at=2026-06-21 19:25:05` (i.e., the day the project was created) | — | This is **your own real account**, the one used earlier in this same session to configure Google OAuth in Google Cloud Console. It is not a test/seed artifact — its email and creation date (matching project creation day) are consistent with it being the original owner account created when the project was set up. |
| `auth.users` total row count | — | — | `1` (matches `public.users` count exactly — 1:1, no orphans either direction) | — | No `@eduquest.local` or `*test*` email exists in `auth.users` **right now**. |

---

## 2. What this does and does NOT resolve

**RESOLVED — environment identity:** Four independent, mutually corroborating
signals (repo hardcoded host, `.env.local`, the Supabase account's own project
list, and the literal string baked into the live production JS bundle) all
point to the exact same single project, `ubngpsdzjoeqfxfbdtxc`. There is no
branch, no second project, and no plausible way for Vercel's live bundle to
contain this project's URL unless it was actually built with these env vars.

**NOT RESOLVED — why tenants/test-accounts are absent:** I found no read-only
evidence explaining why `tenants` (0 rows) and `@eduquest.local` test accounts
(0 rows) are missing. Concretely, three possibilities remain **consistent with
the evidence and cannot be distinguished without information outside this
session's read-only reach**:

1. Prior memory (`teacher.test@eduquest.local`, "QOU" tenant, "5 live accounts
   in daily use") described a real past state that someone (you, or an earlier
   session using the service-role key manually) later deleted.
2. Those accounts were created and deleted by an interrupted or manual run of
   a script/console session not captured in this repo's tracked migration
   history (migration tracking only covers `apply_migration`-applied DDL, not
   ad-hoc `DELETE`/`auth.admin.deleteUser` calls).
3. That memory was inaccurate from the start — written from an assumption or
   an earlier local/dev database that was never actually this production
   project.

I am not asserting any of these three as fact — they are equally consistent
with the evidence I have. This is logged as **UNKNOWN — root cause of empty
tenant/test-account state**, separate from (and not blocking on) the
environment-identity question above, which is settled.

---

## 3. Conclusion

# `CONFIRMED SAME ENVIRONMENT`

The Supabase project queried throughout this audit (`ubngpsdzjoeqfxfbdtxc`) is
the same project backing `https://eduquest-v2.vercel.app` in production. This
conclusion rests on independent, read-only, externally-verifiable evidence
(live bundle inspection), not on trusting `.env.local` or memory alone.

**Practical consequence for Tenant A/B testing:** there is currently only
**one** real tenant-worth of data in production — none, in fact (0 tenants) —
and only one real user (the super_admin owner). There is no second real
tenant to test cross-tenant isolation against without creating one, and you
have explicitly withheld permission to create tenants/users in production.
**Tenant A/B adversarial testing against real production data is therefore
`NOT TESTABLE` right now** — not because of an environment mismatch, but
because there is no second tenant to attack. This will be logged as such in
`SECURITY_TEST_MATRIX.md`, and I'll proceed to the sections that don't require
a second tenant (RPC enumeration, service-role audit, API audit, storage,
AI, LiveKit, infrastructure, DB performance, load-test planning) as you
directed.
