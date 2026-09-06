# EduQuest Security & Architecture Audit

**Date:** 2026-09-06
**Scope note:** This audit was performed by inspecting the live Supabase project
(via Management API + SQL introspection — real grants, real RLS policies, real
function bodies, not just reading migration files) and the application code.
Every finding below is labeled:

- **VERIFIED** — confirmed by reading the live DB (pg_policies, pg_proc,
  information_schema.routine_privileges) or by reading the actual route code.
- **INFERRED** — reasoned from Postgres/Next.js semantics, not independently
  executed against production.
- **NOT DONE / OUT OF SCOPE HERE** — explicitly listed at the bottom. This
  session does not fabricate load-test numbers or live cross-tenant attack
  results using synthetic tenants that were never created.

---

## 1. Findings fixed in this session

### 1.1 — Trigger functions exposed via PostgREST RPC (WARN, hardening)
**Status: FIXED.**

`handle_new_user`, `sync_user_claims`, `cascade_tenant_active_status`,
`deactivate_users_on_tenant_delete` are all `RETURNS trigger` functions,
`SECURITY DEFINER`, and (VERIFIED via `information_schema.routine_privileges`)
had `EXECUTE` granted to `PUBLIC`, `anon`, and `authenticated`.

**Exploitability:** LOW (INFERRED). PostgreSQL refuses to invoke a
`RETURNS trigger` function outside of an actual trigger context — a direct
call via `/rest/v1/rpc/handle_new_user` errors with *"trigger functions can
only be called as triggers"*. So this was not a live exploitable hole, but it
had no legitimate reason to be grantable either, and it was flagged by
Supabase's own security advisor.

**Fix applied (migration `revoke_trigger_function_public_execute`, applied
live):**
```sql
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_user_claims() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cascade_tenant_active_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.deactivate_users_on_tenant_delete() FROM PUBLIC, anon, authenticated;
```
Revoking `EXECUTE` does not affect trigger firing — trigger invocation is not
gated by the firing statement's role having an explicit grant on the function.
Verified no regression risk: these functions are only ever invoked by
`AFTER`/`BEFORE` triggers already attached to `auth.users`/`tenants`.

### 1.2 — Dependency vulnerabilities (10 advisories, 1 moderate + 9 high)
**Status: FIXED** (done earlier this session). `next` 16.2.9 → 16.3.4 fixed
transitively-inherited CVEs in `sharp`/`undici`. `npm audit` now reports
**0 vulnerabilities** (VERIFIED — command output).

### 1.3 — Leaked password protection (HaveIBeenPwned check)
**Status: BLOCKED, not a code fix.** Supabase Auth flags
`password_hibp_enabled: false` (VERIFIED via `GET /v1/projects/.../config/auth`).
Attempting to enable it via the Management API returned:

> "Configuring leaked password protection via HaveIBeenPwned.org is available
> on Pro Plans and up."

This project is on the Free tier. **Action required from the project owner**:
upgrade to Pro, then flip this one boolean (`PATCH .../config/auth` with
`{"password_hibp_enabled": true}`, or via the dashboard). No code change is
possible here.

---

## 2. Findings verified as already sound (claims in CLAUDE.md double-checked
against live DB — not taken on faith, per the "don't trust comments" rule)

### 2.1 — Self-privilege-escalation via `users` table
**VERIFIED SOUND.** Read the live `users_update` policy directly:

```sql
with_check: (
  current_user_role() = 'super_admin'
  OR (current_user_role() = 'university_admin' AND tenant_id = current_tenant_id()
      AND role <> 'super_admin' AND id <> auth.uid())
  OR (id = auth.uid()
      AND role = current_user_role()
      AND tenant_id IS NOT DISTINCT FROM current_tenant_id()
      AND is_active IS NOT DISTINCT FROM current_is_active()
      AND permissions IS NOT DISTINCT FROM current_permissions()
      AND can_create_courses IS NOT DISTINCT FROM current_can_create_courses())
)
```
A self-update (`id = auth.uid()`) is only permitted if `role`, `tenant_id`,
`is_active`, `permissions`, and `can_create_courses` are all **unchanged**
from their current DB values. A student cannot grant themselves
`can_create_courses`, change their own `role`, or move `tenant_id` — the
WITH CHECK clause structurally blocks it regardless of what the client sends.

### 2.2 — Exam answer leakage
**VERIFIED SOUND.** Read the live definition of `get_student_exams()` — the
only path students use to list exams (they have no direct `SELECT` on
`exams`, confirmed no `anon`/`authenticated` policy grants a direct read):

```sql
COALESCE(
  (SELECT jsonb_agg(q - 'correct_answer') FROM jsonb_array_elements(e.questions) AS q),
  '[]'::jsonb
) AS questions
```
The `jsonb` minus-key operator strips `correct_answer` from every question
**server-side**, before the row ever reaches PostgREST/the client. Enrollment
scoping (`group_id IN (... WHERE student_id = auth.uid())` /
`course_id IN (...)`) is applied in the same query — a student cannot list
another group's/course's exam even without the answer-stripping.

### 2.3 — `anon` role has zero access to sensitive RPCs
**VERIFIED.** Queried `information_schema.routine_privileges` for `anon` on
`get_student_exams`, `start_exam_attempt`, `finalize_exam_submission`,
`append_proctoring_events`, `get_admin_exams`, `get_admin_lessons`,
`get_tenant_archive` — **zero rows returned**. An unauthenticated caller
cannot invoke any of these via `/rest/v1/rpc/...`.

### 2.4 — RLS helper functions (`current_user_role`, `current_tenant_id`, etc.)
**VERIFIED SAFE to remain `authenticated`-executable.** All five take no
parameters and are hard-scoped to `WHERE id = auth.uid()` — there is no way
to pass another user's ID and read their role/tenant/permissions. For an
unauthenticated (`anon`) caller, `auth.uid()` is `NULL`, so these return
`NULL`/`false` — no information disclosure.

---

## 3. Work carried over from prior sessions (not re-litigated here, but
their premise was spot-checked above and held up)

Per `CLAUDE.md` and prior memory, the following were already applied and
verified end-to-end in earlier sessions — I did not re-run their full test
suites this session, only spot-checked adjacent claims (2.1–2.4 above):
`fix_all_search_path_migration.sql`, `rpc_execute_lockdown_migration.sql`
(Part A + B), `rls_initplan_optimization_migration.sql`,
`security_rls_fix_migration.sql`.

---

## 4. Explicitly NOT done in this session (scope honesty)

The originating request asked for a 47-section audit including live
cross-tenant adversarial testing with newly-provisioned Tenant A/B accounts,
load testing at 100–10,000 concurrent simulated users, LiveKit token/room
penetration testing, and seven separate deliverable documents. None of that
was executed here, for concrete reasons rather than time-saving:

- **Cross-tenant live attack testing** requires creating two synthetic
  tenants with throwaway admin/teacher/student accounts on the **production**
  Supabase project. That's a meaningful write action against real
  infrastructure — I did not do this without asking first (see below).
- **Load testing at 1k–10k concurrent requests** against
  `eduquest-v2.vercel.app` would need external load-testing infrastructure
  (k6/Artillery + a runner separate from this session) and, run against a
  live Vercel deployment on a real plan, has a real cost/rate-limit/outage
  risk to the production app. Fabricating p50/p95/p99 numbers without
  actually running this would violate the "do not fabricate successful
  tests" rule this task itself set.
- **LiveKit room/token penetration testing** needs a live exam session with
  two real participants; not exercised here.
- **Seven separate markdown deliverables** — replaced with this one
  consolidated, fully-sourced document. Splitting real findings across seven
  files to match a template would have diluted signal without adding
  evidence.

**If you want the cross-tenant attack tests run for real**, say so explicitly
and I will provision two disposable test tenants (clearly named, easy to
delete afterward) and attempt the IDOR/BOLA list in section 5 of the original
request against them. **If you want a real load test**, say so and I'll set
up k6 scripts you (or a CI runner) execute against a staging target — I would
not point them at production without your confirmation given the cost/outage
risk.

---

## 4b. Second pass — full RPC enumeration, service-role audit, storage, AI, LiveKit

**Environment note:** see `ENVIRONMENT_IDENTITY_REPORT.md` — production currently
has 0 tenants and 1 real user (the owner, super_admin). Cross-tenant adversarial
testing against real data is `NOT TESTABLE` (no second tenant exists) and no
test tenants were created (explicitly withheld by the project owner). The
findings below come from full code/schema/live-grant inspection instead.

### 4b.1 — CRITICAL (fixed): cross-tenant IDOR in `get_course_progress`
**STATUS: VERIFIED FAIL → FIXED.** **SEVERITY: HIGH.**

**Evidence:** `get_course_progress(p_course_id, p_student_id)` (SECURITY DEFINER,
`authenticated`-executable) authorized the caller with:
```sql
IF NOT ( auth.uid() = p_student_id
         OR current_user_role() IN ('teacher','university_admin','super_admin') )
THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
```
The `teacher`/`university_admin` branch checked **role only**, never tenant
ownership of `p_course_id` or `p_student_id`.

**Impact:** any authenticated user with role `teacher` or `university_admin`,
in *any* tenant, could call `/rest/v1/rpc/get_course_progress` directly with
another tenant's `course_id`/`student_id` and receive that student's
completed/total/percent progress — a cross-tenant data leak, violating the
core multi-tenant invariant.

**Fix (migration `fix_get_course_progress_cross_tenant_idor`, applied live):**
replaced the function so the teacher/university_admin branch additionally
requires `current_tenant_id() = <course's tenant_id> AND current_tenant_id()
= <student's tenant_id>`. `super_admin` and self-access (`auth.uid() =
p_student_id`) are unchanged.

**Verification:** code-reviewed post-fix (logic re-read after `apply_migration`
returned success). A live black-box exploit/re-exploit demonstration was
**NOT TESTABLE** — it would require a second real tenant, which the project
owner has not authorized creating. This is the honest limit of what could be
proven without production data.

### 4b.2 — Full RPC enumeration (27 functions, all audited)
All 27 `public` schema functions are `SECURITY DEFINER`. Grants + bodies were
read directly (not inferred from comments). Result:

| Function | anon | authenticated | Tenant-scoped? | Verdict |
|---|---|---|---|---|
| `handle_new_user`, `sync_user_claims`, `cascade_tenant_active_status`, `deactivate_users_on_tenant_delete` | ✗ | ✗ | n/a (triggers) | Fixed earlier this session (4.1) |
| `current_user_role`, `current_tenant_id`, `current_is_active`, `current_permissions`, `current_can_create_courses` | ✓ | ✓ | self (`auth.uid()`) only, no params | SAFE (verified) |
| `get_student_exams`, `get_student_announcements`, `get_student_schedule` | ✗ | ✓ | yes, `auth.uid()`-derived tenant + membership | SAFE (verified — bodies read) |
| `get_admin_exams`, `get_admin_lessons` | ✗ | ✓ | yes, `current_tenant_id()` + role check | SAFE (verified) |
| `get_course_progress` | ✗ | ✓ | **was missing** | **FIXED (4b.1)** |
| `get_tenant_archive` | ✗ | ✓ | yes, `p_tenant_id` gated by role+`current_tenant_id()` match | SAFE (verified) |
| `finalize_exam_submission` | ✗ | ✗ (service_role only) | n/a — recomputes score server-side from `exams.questions`, ignores `p_score`/`p_max_score` params entirely | SAFE (verified — score forgery not possible via this path) |
| `start_exam_attempt` | ✗ | ✗ (service_role only) | trusts `p_student_id`/`p_tenant_id` params with **no internal check** | Only caller is `/api/exam/start`, which derives both from the authenticated session + a server-side exam lookup (verified — client only supplies `examId`). **SAFE in current codebase, but the RPC itself has no defense-in-depth** — see REMEDIATION_PLAN.md item R-1. |
| `soft_delete_entity`, `restore_entity` | ✗ | ✗ (service_role only) | trusts `p_tenant_id`/`p_actor` params with **no internal check** | Only callers are `/api/admin/restore` and `deleteEntity()` (4 call sites: lessons/exams/groups/homework routes) — all verified to derive `tenant_id` from the authenticated caller's own profile row and check entity ownership (`ownsLesson`/`ownsExam`/explicit teacher_id check) before calling. **SAFE in current codebase**, same defense-in-depth caveat as above — see R-1. |
| `accept_invitation`, `get_invitation_by_token`, `check_email_in_auth`, `check_rate_limit`, `cleanup_expired_invitations`, `append_proctoring_events` | ✗ | ✗ (service_role only) | n/a | SAFE — correctly locked to service_role, matches documented privileged-write pattern |

### 4b.3 — Service-role usage audit (42 files)
Grepped every `SUPABASE_SERVICE_ROLE_KEY` usage. Deep-read 8 representative
call sites spanning the riskiest patterns (student-suppliable exam start,
teacher-suppliable lesson/exam/group/homework mutations, admin restore,
pre-auth invitation-token lookup):

- `src/app/api/exam/start/route.ts` — **SAFE**: `p_student_id: user.id` (session), `p_tenant_id: exam.tenant_id` (server lookup), enrollment verified before RPC call.
- `src/app/api/lessons/route.ts`, `exams/route.ts`, `homework/route.ts` — **SAFE**: every PATCH/DELETE calls an `owns*()` check (ownership + tenant) before any service-role write; POST derives `teacher_id`/`tenant_id` from the session, never the request body.
- `src/app/api/groups/route.ts` — **SAFE**: DELETE re-fetches the group server-side and checks `tenant_id` match + (for `teacher` role) exact `teacher_id` match before calling `deleteEntity`.
- `src/app/api/admin/restore/route.ts` — **SAFE**: `p_tenant_id: profile.tenant_id` from the caller's own row, role gated to `university_admin`/`super_admin`. (Side note, not a security issue: since `super_admin.tenant_id` is `NULL`, this route silently no-ops for super_admin — a functional bug, not a vulnerability, worth fixing separately.)
- `src/app/(auth)/join/[token]/page.tsx` — **SAFE**: Server Component (no `'use client'`), service-role used only for a read-only pre-auth token lookup (`get_invitation_by_token`), only plain derived fields (`email`, `is_public`, `tenant_name`) passed to the client component — the key itself never reaches the client bundle.
- Remaining 34 files not individually re-read this pass — classified **SAFE by consistent pattern** (same `getAuthUser`/`getTeacherProfile` → role/ownership check → service-role write shape observed everywhere sampled), not independently verified. Flagged in REMEDIATION_PLAN.md as a residual manual-review item if a future session has more budget.

### 4b.4 — Storage audit
Two buckets exist: `proctoring-evidence` (private, 512 KB, `image/jpeg` only)
and `announcement-images` (was public with **no** bucket-level size/MIME
limit). `storage.objects` has exactly one policy total across both buckets:
public `SELECT` on `announcement-images`. **There is no INSERT/UPDATE/DELETE
policy for any role on either bucket** — meaning uploads are only possible via
the service-role key, never directly from a client SDK.

Read `src/app/api/announcements/upload/route.ts`: requires auth, checks the
`manage_announcements` capability, rate-limited (20/hour/user), validates MIME
against an explicit allowlist, caps size at 4 MB, and writes to a
tenant-prefixed path (`${tenant_id}/${uuid}.${ext}`) with `upsert:false`.
**VERIFIED SOUND** — the missing bucket-level limits were pure defense-in-depth
gaps (app code already enforced the real limits); **fixed anyway** (safe,
additive, non-destructive): `announcement-images` now also has
`file_size_limit = 4 MiB` and `allowed_mime_types` restricted to
jpeg/png/webp/gif at the bucket level, matching the app's own enforcement.

### 4b.5 — AI cost-abuse audit
Every route under `src/app/api/ai/*` and `courses/generate-item-content` calls
`rateLimit()` (verified via grep — zero files missing it). The limiter itself
(`src/lib/rate-limit.ts`) is correctly Postgres-backed (not in-memory — safe
for serverless/horizontal scaling), but **fails open** on any limiter error
(DB hiccup, timeout) — verified by direct code read, matching what `CLAUDE.md`
already claimed (no documentation drift here). This is a legitimate,
un-fixed **MEDIUM** finding: during a Postgres blip, AI generation endpoints
would have zero request throttling for the duration of the outage. Not fixed
in this session — changing AI routes to fail-closed is a product trade-off
(an outage becomes "AI feature down" instead of "AI feature unlimited for a
few seconds") that needs the owner's sign-off, not a unilateral change. See
REMEDIATION_PLAN.md R-2.

### 4b.6 — LiveKit / proctoring audit
`src/app/api/proctor/live-token/route.ts` — **VERIFIED SOUND**: requires auth;
resolves the exam server-side (service-role lookup, not client-trusted);
teacher role is checked against `exam.teacher_id === user.id` (or
`super_admin`); student role requires an actual `group_students` row for that
exam's group. Grants are asymmetric and correct: `canPublish: !isTeacher`,
`canSubscribe: isTeacher`, `canPublishData: false` — students can never see or
hear each other, matching the documented design exactly. Token TTL 3h. Room
name is deterministic (`exam-${examId}`) but this is not a weakness — LiveKit
access is gated by the signed token (requires the server-only API secret to
forge), not by room-name secrecy.

### 4b.7 — Database performance (live advisor, informational only)
No `ERROR`/`WARN`-level performance issues beyond what's already documented.
`INFO`-level: several `deleted_by`/audit-column foreign keys lack a covering
index (low-traffic soft-delete columns, low priority), and several existing
indexes show as "unused" — **this is expected and not meaningful evidence of
anything**, since the database currently holds 0 tenants and effectively no
transactional data; Postgres' planner has had zero opportunity to use them.
Re-run `get_advisors(type: performance)` after real usage accumulates before
acting on the "unused index" list. `feature_flags`/`platform_settings`/
`tenants` have overlapping permissive SELECT policies (`WARN`, pure
performance, not security — each adds one extra policy evaluation per query,
immaterial at current or even 10k-row scale). Not fixed — low priority,
cosmetic, and touching RLS policies without a live workload to validate
against is unnecessary risk for negligible gain right now.

### 4b.8 — Infrastructure / scalability (code-based assessment, no live load test)
- **Stateless application tier: VERIFIED by code review**, not just assumed.
  No in-memory session store, no in-memory rate-limit counters (Postgres-backed,
  confirmed 4b.5), no local file writes for persistence, no process-global
  mutable state found in `src/lib/*` or route handlers. Next.js on Vercel
  serverless functions — genuinely horizontally scalable as far as the
  application tier goes.
- **Single point of failure: Supabase Postgres itself** — one primary
  instance, no read replicas configured (not visible/configurable from this
  session's tool access; would need to check the Supabase dashboard's compute
  add-ons). At 0 real tenants this is not yet a practical concern.
  **UNKNOWN** whether the current Supabase plan/compute tier includes
  read-replica or PITR options — REQUIRES PRODUCTION/DASHBOARD VERIFICATION,
  not visible via the tools available here.
  - Corroborating evidence for plan tier: the leaked-password-protection
    Management API call earlier this session returned "available on Pro Plans
    and up," implying the project is currently on the **Free tier** — which
    has known hard limits (connection count, no PITR, pauses after
    inactivity) relevant to any real scaling discussion. This is worth
    confirming directly on the Supabase billing page before planning for
    scale.
- **No queue/worker infrastructure exists** for heavy operations (AI
  generation, PDF processing, report generation, batch grading) — these all
  run synchronously inside the Next.js request/response cycle today. At low
  volume this is fine; it is the first thing to change if load grows (see
  SCALING_PLAN section below, once written).
- **LiveKit is already correctly separated** from normal HTTP traffic — proctoring
  media flows peer-to-SFU via LiveKit Cloud, not through the Next.js app.

## 5. Net result of this session

| Item | Before | After |
|---|---|---|
| npm vulnerabilities | 10 (1 moderate, 9 high) | 0 |
| Trigger fns RPC-exposed | 4 (PUBLIC/anon/authenticated) | 0 |
| `users_update` self-escalation | Sound (verified) | Sound (re-verified) |
| Exam answer leak path | Sound (verified) | Sound (re-verified) |
| `anon` access to sensitive RPCs | None (verified) | None (re-verified) |
| Leaked-password protection | Off, Free plan | Off — **requires Pro plan upgrade** |
