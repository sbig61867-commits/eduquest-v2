# Final Audit Status

**Date:** 2026-09-07
**Scope:** Application-security audit + targeted remediation of EduQuest,
performed by live database introspection (Supabase Management API + SQL),
full-content code review of every service-role file and API route, and live
HTTP testing against production. Scalability/load-testing is **prepared but
not executed** (see §3) and is reported separately from security — a secure
application is not the same claim as a production-scale-ready one.

---

## 1. Coverage & evidence table

| Area | Coverage | Evidence Level | Findings | Fixed | Unknown | Risk |
|---|---:|---|---:|---:|---:|---|
| PostgreSQL functions (SECURITY DEFINER) | 27/27 (100%) | VERIFIED BY LIVE DATABASE (`pg_get_functiondef` read for all 27) | 5 (trust gaps in client-supplied params) | 5 | 0 | LOW (post-fix) |
| Service-role code usages | 44/44 (100%) | VERIFIED BY CODE REVIEW (full file content read, not pattern-matched) | 1 confirmed HIGH (`get_course_progress` cross-tenant IDOR — DB function, counted above) + R-1 family (4 functions) | all fixed | 0 | LOW (post-fix) |
| API endpoints (`app/api/**/route.ts`) | 48/48 (100%) | VERIFIED BY CODE REVIEW (39 fully traced end-to-end; 9 auth-confirmed but IDOR-check not explicitly grepped, since they carry no cross-user ID input) | 0 additional beyond the DB-layer findings above | n/a | 9 rows marked PARTIALLY VERIFIED, not FAIL | LOW |
| Storage buckets | 2/2 | VERIFIED BY CODE REVIEW + prior-session live re-query | 1 (missing size/MIME limit at storage layer) | 1 | 0 | LOW |
| LiveKit endpoints | 1/1 | VERIFIED BY CODE REVIEW (token gen, room grants, publish/subscribe asymmetry) | 0 | — | Cross-tenant room access | NOT TESTABLE (no 2nd tenant, no live session) |
| AI endpoints | 8/8 (6 with direct provider calls + `aiRateLimit` applied to all 8) | VERIFIED BY CODE REVIEW + VERIFIED BY AUTOMATED TEST (11 new unit tests) | 2 (no request timeout; fail-open rate limiter had no bounded emergency behavior) | 2 (layers 1+2; layer 3/full-fail-closed explicitly left as a product decision) | — | LOW-MEDIUM |
| Security regression tests | 17 Playwright (live) + 63 Vitest (unit/mocked) = 80 | VERIFIED BY AUTOMATED TEST — **17/17 Playwright tests actually executed live against production this session**, not assumed | 1 test-suite bug found and fixed (false-negative: expected bare 401, actual behavior is a stronger 307 proxy-level block) | 1 | — | — |
| Cross-tenant live isolation (SELECT/INSERT/UPDATE/DELETE, IDOR/BOLA across 2 real tenants) | 0% executed | NOT TESTABLE | — | — | Whether the *fixed* code holds under a live two-tenant adversarial run | REQUIRES a second real tenant, which was explicitly withheld this session |
| Database performance (indexes, RLS cost, query plans under load) | Structural review only | VERIFIED BY CODE REVIEW (index shape matches RLS/query patterns) for structure; **UNKNOWN** for real-world behavior | 0 structural issues; pagination gap on 3 admin RPCs (R-10, low priority) | — | Real query-plan/connection behavior under load | REQUIRES PRODUCTION DATA VOLUME |
| Scalability / load behavior | 0% executed | NOT DONE — k6 suite prepared, not run | — | — | First real bottleneck at any concurrency level | REQUIRES EXTERNAL INFRASTRUCTURE |
| Infrastructure (Supabase plan, connection pooling, Vercel limits) | Partial | UNKNOWN for plan-tier specifics (inferred Free tier from one Management API response) | — | — | Actual connection pooling config, Vercel concurrency limits | REQUIRES DASHBOARD/ACCOUNT ACCESS this session doesn't have |

---

## 2. Findings fixed this session (chronological)

| ID | Finding | Severity | Fix | Verification |
|---|---|---|---|---|
| D-1 | 4 trigger-only SECURITY DEFINER functions had `EXECUTE` grantable to `PUBLIC`/`anon`/`authenticated` | LOW (Postgres blocks direct trigger-function calls regardless) | `REVOKE ALL ... FROM PUBLIC, anon, authenticated` | VERIFIED BY LIVE DATABASE (`information_schema.routine_privileges` re-queried: zero rows for anon/authenticated) |
| D-2 | `get_course_progress` — any teacher/university_admin in **any tenant** could read any student's progress on any course, no tenant check at all | **HIGH** (confirmed cross-tenant IDOR at the DB-function level) | Added tenant-match requirement for the teacher/university_admin branch | FIX VERIFIED BY CODE/SQL REVIEW — function body re-read post-fix; **NOT a live cross-tenant exploit re-test** |
| D-3 | `start_exam_attempt`, `soft_delete_entity`, `restore_entity`, `append_proctoring_events` trusted caller-supplied `tenant_id`/`actor`/`student_id` with zero internal validation | MEDIUM (safe in practice only because every current caller happened to derive params correctly — no defense if that ever changed) | Each function now re-derives the real fact from `public.users`/`public.exams`/the target entity | FIX VERIFIED BY CODE/SQL REVIEW |
| D-4 | `/api/admin/restore` blocked `super_admin` outright (`tenant_id` is legitimately NULL for that role) before ever reaching the RPC | MEDIUM (functional/authorization bug — a declared-allowed role could never actually use the feature) | Root-caused against the codebase's own established pattern (`/api/admin/create-user`): `super_admin` now explicitly supplies the target tenant in the request body; `university_admin` unaffected, still scoped to their own tenant only | VERIFIED BY CODE REVIEW; identical pattern bug also found (and documented, not changed) in the archive page's own guard clause |
| D-5 | No timeout on any outbound AI-provider call (Groq `fetch`, 5× Gemini SDK call sites) | MEDIUM (hung request could hold a serverless invocation open indefinitely) | `AI_TIMEOUT_MS` (configurable via `AI_REQUEST_TIMEOUT_MS`, 25s default) applied to all 6 call sites | VERIFIED BY AUTOMATED TEST (6 new unit tests) — **and a real bug was caught while writing the test**: `isAbortError()` used `instanceof Error`, which a real `DOMException` abort fails (DOMException is not a subclass of Error) — fixed before it ever shipped silently broken |
| D-6 | Rate limiter fails open unconditionally, including for AI endpoints — a sustained DB outage means unlimited AI generation for as long as it lasts | MEDIUM | Layer 1: 3s timeout on the rate-limit RPC itself. Layer 2: new `aiRateLimit()` — after 3 consecutive dependency failures, opens a 30s circuit that denies AI requests outright, then half-opens. Applied to all 8 AI/expensive endpoints. `rateLimit()` (login, session-check, dashboards) is untouched — still fails open unconditionally, so a DB blip can never become a platform-wide outage | VERIFIED BY AUTOMATED TEST (5 new unit tests) |
| D-7 | 4 new DB migrations this session existed live but had no corresponding file in `supabase/`, violating the repo's own documented convention | LOW (repo hygiene / auditability, not a live vulnerability) | Added 3 migration files mirroring exactly what was applied live | VERIFIED BY LIVE DATABASE (function bodies match the files verbatim) |
| D-8 | `tests/security-auth.spec.ts`'s 5 API-401 tests asserted a bare 401; live run revealed the real (stronger) behavior is a 307 proxy-level redirect, causing a false-negative test result | LOW (test-suite bug, not an app bug — the app's real behavior is *more* protective than the test expected) | Test now accepts either a 401 or a 307-to-/login as valid "blocked," inspecting the route's own immediate response (`maxRedirects: 0`) instead of the followed redirect's target | VERIFIED BY AUTOMATED TEST — re-run live against production, 5/5 pass |

---

## 3. Explicit separation: VERIFIED BY LIVE DATABASE / CODE REVIEW / AUTOMATED TEST / NOT TESTABLE / UNKNOWN / REQUIRES EXTERNAL INFRASTRUCTURE

### VERIFIED BY LIVE DATABASE
- All RLS policies quoted in `SECURITY_AUDIT.md` (read via `pg_policies`, not migration files)
- All 27 function bodies (read via `pg_get_functiondef`, not migration files or comments)
- All grants for all 27 functions across `anon`/`authenticated`/`service_role`/`PUBLIC` (via `information_schema.routine_privileges`)
- Environment identity (project ref match across repo/`.env.local`/Supabase account/live Vercel JS bundle)
- Migration history continuity (`list_migrations` — no gap, no reset marker)
- Schema presence + RLS-enabled status for 19 core tables

### VERIFIED BY CODE REVIEW
- 44/44 service-role files (full content read)
- 48/48 API routes (39 fully traced; 9 auth-confirmed, IDOR-check implicit given no cross-user ID input)
- LiveKit token/room authorization logic
- AI fail-open impact analysis (quantified from the actual `rate-limit.ts` code, not assumed)
- All fix verifications (D-2 through D-6) — re-reading the post-fix function/route bodies, **not** re-running a live exploit

### VERIFIED BY AUTOMATED TEST
- 63 Vitest unit tests (11 new this session: 6 AI-timeout, 5 AI-circuit-breaker) — all passing, run locally against mocked dependencies
- **17 Playwright tests, run live against `https://eduquest-v2.vercel.app` this session** — auth redirects (5), API-route access control (5), login-page smoke tests (3, non-security), real-account role isolation (2), security headers (2). All 17 currently pass.

### NOT TESTABLE (this session, for stated reasons — not skipped for convenience)
- Live cross-tenant SELECT/INSERT/UPDATE/DELETE/IDOR attacks across two real tenants — only one real tenant exists in production, and creating a second was explicitly withheld
- LiveKit cross-tenant room/token exploitation — same reason, plus no live proctored session
- Whether the D-2/D-3 fixes hold under an actual adversarial two-tenant run (only proven by code/SQL re-review, not by attacking it)

### UNKNOWN
- Root cause of why `tenants`/test accounts were absent from production at one point mid-session and present again later (three explanations were equally consistent with available evidence; none could be confirmed read-only — see `ENVIRONMENT_IDENTITY_REPORT.md` §2)
- Exact Supabase plan tier (inferred Free from one Management API rejection message, not independently confirmed)
- Whether Supavisor/PgBouncer connection pooling is active for the app's actual connection path
- Real query-plan/connection behavior under production-scale data volume (current DB is near-empty)
- Vercel plan tier and platform concurrency limits (`vercel whoami` not authenticated in this session)

### REQUIRES EXTERNAL INFRASTRUCTURE
- Any real load test (100 → 50,000 concurrent users) — `load-tests/` (k6) is prepared, not run; no load-test numbers are reported anywhere in this audit
- A true cross-instance rate-limit circuit breaker (the implemented one is correctly documented as per-warm-instance only)
- Leaked-password protection (blocked by Supabase Free-tier plan limit, not a code fix)

---

## 4. Numeric summary (as requested)

- PostgreSQL functions examined: **27 / 27**
- Service-role usages examined: **44 / 44** (corrected from an earlier "42" miscount)
- API endpoints examined: **48 / 48**
- Storage buckets: **2**
- LiveKit endpoints: **1**
- AI endpoints: **8** (5 generation routes + extract-file + proctor/analyze + courses/generate-item-content)
- Security tests that passed: **80** (17 live Playwright + 63 Vitest unit) — corrected from an earlier "13" miscount
- Security tests that failed (before fix): **1** (the D-8 test-suite false-negative — not an app vulnerability)
- Findings fixed: **8** (D-1 through D-8)

---

## 5. Explicit statement on production readiness

**This audit does not claim EduQuest is "production-ready."** It separates
two different questions:

1. **Application security** (this audit's actual scope): the code paths
   examined are sound, 5 real defects were found and fixed with evidence, and
   the fixes are verified by code/SQL review — with the explicit caveat that
   no live cross-tenant exploit was ever attempted, because only one real
   tenant exists.
2. **Operational / scalability readiness** (explicitly NOT claimed here):
   unknown connection-pooling configuration, unmeasured query performance
   under real data volume, and zero executed load tests mean **no concurrency
   number is claimed for this system** — not 1,000, not 10,000. `load-tests/`
   is ready to run when the owner chooses to, ideally against a staging
   target first.

**Highest-priority next action:** decide whether to (a) run the prepared k6
load tests against a staging environment, and/or (b) authorize provisioning
two disposable test tenants specifically to execute the live cross-tenant
adversarial matrix that this session could not run without that permission.
