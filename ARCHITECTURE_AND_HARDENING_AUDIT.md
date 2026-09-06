# Architecture & Hardening Audit — Part 2

Covers: SECURITY DEFINER necessity (all 27 functions), AI fail-open impact
analysis, LiveKit final code-level audit, infrastructure current-vs-target,
and database indexing/RLS review. Continuation of `SECURITY_AUDIT.md` /
`SECURITY_TEST_MATRIX.md` / `REMEDIATION_PLAN.md`.

---

## 1. SECURITY DEFINER necessity — all 27 functions

**All 27 are `SECURITY DEFINER`. All 27 genuinely need to be** — none can be
safely downgraded to `SECURITY INVOKER` without either breaking the feature
or reopening the exact hole the function exists to close. Verified via
`pg_get_functiondef` body inspection (this session + earlier this session).

| Function(s) | Why DEFINER is required | `search_path` pinned? | Schema-qualified? | Dynamic SQL / `EXECUTE`? | Trusts client params? |
|---|---|---|---|---|---|
| `current_user_role`, `current_tenant_id`, `current_is_active`, `current_permissions`, `current_can_create_courses` | Called **from inside** RLS policies on `public.users` itself. If `INVOKER`, evaluating them would re-trigger the same RLS policy that's calling them → infinite recursion. This is the standard, necessary Supabase pattern for RLS helper functions. | ✓ (`public, pg_temp`) | ✓ | ✗ | No — zero params, self-scoped via `auth.uid()` only |
| `handle_new_user`, `sync_user_claims`, `cascade_tenant_active_status`, `deactivate_users_on_tenant_delete` | Trigger functions that write to `auth.users.raw_app_meta_data` or cascade updates across `public.users` on behalf of the triggering DML — the triggering role (often GoTrue itself, or an admin doing a cross-row cascade) has no direct grant to make these writes as itself. | ✓ | ✓ | ✗ | N/A (trigger context only; `EXECUTE` revoked from anon/authenticated this session) |
| `get_student_exams`, `get_student_announcements`, `get_student_schedule`, `get_admin_exams`, `get_admin_lessons` | Students/admins have **no direct SELECT policy** on `exams`/`lessons`/`announcements`/`schedules` at all (intentional — prevents answer leaks and content exposure even via crafted joins, per `admin-metadata-only-rls` design). These functions are the sole sanctioned exception, and must run with elevated rights to read the base tables, applying their own narrower filter (`correct_answer` stripped, tenant+membership scoped) instead of relying on a table-level RLS policy that doesn't exist. | ✓ | ✓ | ✗ | No params (self-scoped via `auth.uid()`) |
| `get_course_progress` | Reads `unit_items`/`course_units`/`course_levels`/`student_progress` across a join students don't have direct RLS access to in this shape. | ✓ | ✓ | ✗ | **Was** trusting `p_student_id` with only a role check, no tenant check — **fixed this session** (see SECURITY_AUDIT.md §4b.1) |
| `get_tenant_archive` | Reads soft-deleted/archived rows across 2 tables for admin reporting — archived rows are intentionally hidden from normal RLS SELECT policies (`hide_archived_rls_migration`), so an admin-facing archive view must bypass that hiding on purpose. | ✓ | ✓ | ✗ | `p_tenant_id` gated internally by `current_user_role()`/`current_tenant_id()` match — verified sound |
| `accept_invitation`, `get_invitation_by_token` | Pre-authentication flows (invitation acceptance happens before the user has a session, or with a session that has no tenant yet) — the caller has no RLS standing to read the `invitations` table or create/promote a `public.users` row at all. | ✓ | ✓ | ✗ | Locked to `service_role` only; app validates the token server-side before calling |
| `check_email_in_auth` | Reads `auth.users` directly — a schema `anon`/`authenticated` can never query (owned by the `supabase_auth_admin`/GoTrue subsystem, no RLS applies, PostgREST doesn't expose it). | ✓ | ✓ | ✗ | `service_role` only |
| `check_rate_limit`, `cleanup_expired_invitations` | Operate on `rate_limits`, a table with RLS enabled and **zero policies for any role** (intentional total lock — see `SECURITY_AUDIT.md` prior session finding). Only a DEFINER function (or service_role) can touch it at all. | ✓ | ✓ | ✗ | `service_role` only |
| `finalize_exam_submission`, `start_exam_attempt`, `append_proctoring_events` | Write to `grades`/`exam_submissions`, tables students have **no direct INSERT/UPDATE policy** on (grading and attempt-tracking must be server-authoritative, never student-writable). | ✓ | ✓ | ✗ | `p_score`/`p_max_score` explicitly ignored (recomputed server-side); `p_student_id`/`p_tenant_id` **now internally re-verified** (R-1 fix, this session) |
| `soft_delete_entity`, `restore_entity` | Write `deleted_at`/`deleted_by` across 4 different tables in a single call, cascading (e.g., deleting a group also archives its lessons/exams) — no single-table RLS UPDATE policy can express "cascade to 3 other tables in one transaction." | ✓ | ✓ | ✗ | `p_actor`/`p_tenant_id` **now internally re-verified against `public.users`** (R-1 fix, this session) |

**Conclusion: 0 of 27 functions should be downgraded.** Every one either (a)
would recurse into the RLS policy it's evaluated from, (b) is the sanctioned
narrow exception to an intentionally-absent base-table RLS policy, or (c)
needs to touch `auth.users`/`rate_limits`/cross-table cascades that no
`authenticated`/`anon` grant could ever cover safely. All 27 pin
`search_path`, all schema-qualify every table reference, none use dynamic SQL
or `EXECUTE`. Client-controlled-parameter trust has been eliminated in the
three functions that had it (`get_course_progress`, `start_exam_attempt`,
`soft_delete_entity`, `restore_entity`, `append_proctoring_events` — 5 total,
all fixed this session).

---

## 2. AI fail-open — actual security impact, not just "a design choice"

**Direct answer to "what happens if the rate limiter fails":**

`rateLimit()` (`src/lib/rate-limit.ts`) fails open — if the `check_rate_limit`
RPC errors for any reason (DB connectivity blip, timeout, malformed
response), every call site treats the request as **allowed**, with no
secondary check.

| Question | Answer | Evidence |
|---|---|---|
| Can a user generate unlimited requests during a limiter failure? | **Yes**, for the duration of the failure, on whichever specific endpoint they hit. | Direct code read: `if (error \|\| !data) { return { allowed: true, ... } }` |
| Can this drain the AI provider's quota? | **Yes** — Groq/Gemini free-tier daily/monthly quotas are shared across the whole app; a burst during a limiter outage consumes from the same pool every other tenant relies on. | `src/lib/ai/groq.ts`, `src/lib/ai/gemini.ts` — no per-request budget tracking beyond the (now-bypassed) rate limiter |
| Can this cost the provider money? | **Currently no** — Groq/Gemini/Cohere/OpenRouter are used on free tiers per project memory (`feedback-ai-must-stay-free`); a burst would hit a hard quota wall (429s from the provider itself) rather than an invoice. This bounds the blast radius to "feature degraded for everyone" rather than "surprise bill." | Confirmed via `.env.local` keys — no paid-tier billing config found in the repo |
| Is there a per-user limit independent of the DB-backed limiter? | **No** — `rateLimit()` is the only throttle; there is no secondary in-process or edge-level limiter. | grep confirms only one rate-limiting mechanism exists |
| Per-tenant limit? | **No** — limits are keyed per-user (`feature:userId`), not per-tenant. A tenant with many active users could still collectively exceed what one "fair" tenant should get, even with the limiter working normally — this is a **separate, always-present** gap, not specific to the fail-open case. | Every `rateLimit(...)` call site keys by `user.id` only |
| Global circuit breaker? | **No.** | Not found anywhere in `src/lib/ai/*` or route handlers |
| Max tokens / output cap? | **Yes** — `groqChat()` sets `max_tokens: 4096`. Gemini calls in `proctor/analyze` don't set an explicit max-output but the prompt requests a small fixed-shape JSON response, naturally bounding output size. | `src/lib/ai/groq.ts:24` |
| Timeout? | **UNKNOWN** — no explicit `AbortController`/timeout wrapper was found around the `fetch()` calls to Groq or the Gemini SDK calls in the routes reviewed. A provider that hangs would hold a serverless function invocation open until Vercel's own function-timeout kills it (platform-level backstop, not app-level). | Not found in `groq.ts`/`gemini.ts`/AI route handlers |
| Retry limit? | **None found** — no retry logic in the Groq/Gemini call paths; a failure returns an error to the client directly (except the documented Groq→Cohere→Gemini→OpenRouter fallback chain, per project memory, which is a *fallback*, not a retry-with-backoff). | `src/lib/ai/groq.ts` — single `fetch`, no retry wrapper visible |
| Concurrency limit? | **No** — nothing caps how many simultaneous AI requests one user (or the app overall) can have in flight; only the hourly count is limited, not concurrency. | Not found |

### Remediation, ordered by user impact (least → most disruptive)

1. **Lowest impact, do this first:** add a request timeout (e.g., 20–30s
   `AbortController`) around the Groq `fetch` and the Gemini SDK calls, so a
   hung provider can't tie up a function invocation indefinitely. Zero
   behavior change for the success path.
2. **Low impact:** switch the rate-limiter's fail-open to a **short,
   bounded fail-closed** window specifically for `api/ai/*` routes only —
   e.g., "if `check_rate_limit` errors, allow this one request through but
   also set a 60-second local (in-memory, per-instance) cooldown flag for
   that route so a sustained DB outage can't be hammered indefinitely."
   This is a middle ground: doesn't turn one transient error into a hard
   block, but caps the blast radius of a *sustained* outage. Cheap/session
   endpoints (login, dashboards) should keep today's fail-open behavior —
   only the expensive AI-generation routes need this.
3. **Medium impact (needs product sign-off, not applied this session):**
   true fail-closed for `api/ai/*` only — during any limiter error, block
   the AI request with a "please try again shortly" message. Trade-off:
   turns "AI unlimited for a few seconds" into "AI unavailable for a few
   seconds" whenever Postgres has any transient hiccup, however brief. This
   is the one change explicitly deferred to the product owner (REMEDIATION_PLAN.md R-2)
   since it changes user-visible behavior on every DB blip, not just security
   posture.

**Not implemented this session** (all three require either a behavior-affecting
trade-off decision or non-trivial testing against live AI providers this
session cannot safely exercise without spending real quota) — logged in
`REMEDIATION_PLAN.md` as R-2 (expanded) and a new R-9 (timeout).

---

## 3. LiveKit — final code-level audit

**Total LiveKit-related endpoints: 1** (`/api/proctor/live-token`). There is
no separate "create room" endpoint — LiveKit rooms are created implicitly on
first participant join (standard LiveKit Cloud behavior), so "room creation"
as a distinct authorization surface does not exist in this codebase.

| Check | Result | Method |
|---|---|---|
| Token generation is server-side only | **VERIFIED** | `AccessToken` constructed in the route handler using `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`, both server-only env vars (never `NEXT_PUBLIC_*`) |
| API secret never reaches the browser | **VERIFIED** | grep confirms `LIVEKIT_API_SECRET` appears only in `src/app/api/proctor/live-token/route.ts`, never in any client component or `NEXT_PUBLIC_*` var |
| Room names cannot be guessed into unauthorized access | **VERIFIED (design)** — room name is deterministic (`exam-${examId}`) but knowing the name alone grants nothing; LiveKit requires a validly-signed token for that specific room to connect at all, and tokens are only minted after the checks below pass | Code read of `roomName()` + `AccessToken.addGrant({ room: roomName(examId), ... })` |
| Teacher can only get a token for their own exam | **VERIFIED** | `if (exam.teacher_id !== user.id && profile?.role !== 'super_admin') return 403` |
| Student can only get a token if enrolled | **VERIFIED** | `group_students` membership count check before minting |
| Students cannot see/hear each other | **VERIFIED** | `canSubscribe: isTeacher` (false for students) — enforced by LiveKit's SFU itself, not just app logic, so even a modified client can't override it without a token that grants otherwise |
| Teacher cannot publish (can't inject fake video into their own proctoring feed) | **VERIFIED** | `canPublish: !isTeacher` |
| No data-channel abuse | **VERIFIED** | `canPublishData: false` for both roles |
| Token lifetime bounded | **VERIFIED** | `ttl: '3h'` |
| Cross-tenant room access | **UNKNOWN / NOT TESTABLE** — the `examId` → `group_id` → `group_students` chain is tenant-implicit (a group belongs to one tenant), so a cross-tenant attempt would fail the enrollment check the same way an intra-tenant unauthorized attempt would. This logical argument holds up under code review but was **not exercised with two real tenants**, since none exist in production and none may be created. | Code review only |
| Recording permissions | **N/A** — no recording feature found in the codebase (LiveKit is used live-only, per the `canPublish`/`canSubscribe` split; no egress/recording API calls found) | grep for `egress`/`recording` in `src/` — no matches |

**Overall LiveKit verdict: VERIFIED SOUND at the code level. Live exploit
testing (two real concurrent participants attempting to cross tenants or
rooms) is NOT TESTABLE in this session** — would require either two real
tenants (withheld) or a live proctored exam session with the project owner's
own account.

---

## 4. Infrastructure — CURRENT VERIFIED vs. TARGET

### CURRENT VERIFIED (by code/config inspection, not benchmarked)

- **Application tier is genuinely stateless.** No in-memory session store, no
  in-memory rate-limit counters (confirmed Postgres-backed), no local
  filesystem writes for persistence, no module-level mutable state found in
  `src/lib/*` or any route handler. Next.js on Vercel serverless functions.
- **Rate limiting is DB-backed, not per-instance memory** — correctly
  survives serverless cold starts and works identically across concurrently
  running instances.
- **LiveKit media is already architecturally separate** from the Next.js
  HTTP path — proctoring audio/video never transits the app server.
- **AI generation runs synchronously inside the request/response cycle** —
  no queue, no background worker. Confirmed by reading every `api/ai/*`
  route: each does `await groqChat(...)` (or Gemini/PDF-extraction
  equivalent) and returns the result directly in the same HTTP response.
- **Supabase project is very likely on the Free tier** — inferred (not
  directly confirmed) from the Management API's response to the
  leaked-password-protection PATCH attempt this session ("available on Pro
  Plans and up"). Free tier has known hard limits: pooled connection count,
  no point-in-time recovery, project auto-pause after a week of inactivity.
- **Zero real tenants currently onboarded** — so every scaling question
  below is about *future* load, not a currently-measured bottleneck.

### UNKNOWN — requires dashboard/production access this session doesn't have

- Actual Supabase plan tier (inferred Free, not confirmed)
- Whether a read replica or connection pooler (PgBouncer/Supavisor mode) is
  configured
- Actual Postgres `max_connections` and how it interacts with Vercel's
  serverless concurrency (each concurrent function invocation opens its own
  DB connection unless a pooler is in front — **this is the single most
  likely first bottleneck at real scale**, and it cannot be confirmed or
  denied from this session's tool access)
- Vercel plan tier / concurrency limits / region-level DDoS protection
  specifics (Vercel provides platform-level protection by default, but the
  exact limits depend on the plan, which this session could not query —
  `vercel whoami` was not authenticated)

### TARGET architecture — what changes, and at what trigger point

| Component | Current | Target | Trigger to build it |
|---|---|---|---|
| AI generation, PDF extraction, PPTX generation, batch report generation | Synchronous, in the HTTP request | Move to a queue (Postgres-table-backed job queue is the simplest fit, given the DB-centric pattern already used for rate-limiting; a managed queue is the alternative) + a worker process | When P95 latency on these routes becomes user-visible, or when Vercel's serverless function execution-time limit starts truncating a real request (whichever comes first) |
| Postgres connections | Direct, presumably one per invocation | Connection pooling (Supabase's built-in Supavisor "transaction mode" pooler, or PgBouncer) | Before onboarding enough concurrent users that connection count could realistically approach whatever `max_connections` the current plan allows — **this should be verified/configured proactively, not reactively, since connection exhaustion fails ungracefully** |
| Read path (dashboards/reports) | Same primary instance as writes | Read replica, if Supabase plan supports it | Once read-heavy dashboard/report queries measurably compete with the write path (exam submission, grading) for DB CPU — not before, and not measurable at 0 real tenants |
| CDN/WAF/DDoS | Whatever Vercel provides by default | Explicit WAF rules / Cloudflare in front, if abuse is observed | Reactive — only if real abuse traffic is seen; premature to add now |
| Rate limiting | Per-user, DB-backed, fails open | Add per-tenant ceilings + the AI-specific hardening in §2 above | Before onboarding a second real tenant, so one tenant's usage pattern can't degrade another's AI availability |

**Explicitly not claimed:** this audit does **not** assert the system can
handle 10,000 or 50,000 concurrent users. That claim would require the load
test in `LOAD_TEST_PLAN.md` actually being run, which this session did not
do (no fabricated numbers, per the ground rules of this audit).

---

## 5. Database — indexes & RLS review (no row-count-based conclusions)

Per instruction, "unused index" advisor output is **not** used as evidence
here (0 real tenants means the planner has never had a reason to use any
index — that is a fact about data volume, not index quality).

### Indexes that exist and are structurally correct for the RLS/query patterns used
Confirmed via `pg_policies` + the FK/index advisor pass earlier this session:
covering indexes exist on the hot `tenant_id` and `teacher_id`/`student_id`
foreign keys for `groups`, `courses`, `lessons`, `exams`, `grades`,
`exam_submissions`, `invitations` — i.e., exactly the columns every RLS
policy and every ownership-check query filters on. This is the right shape
*structurally*; whether it performs well **cannot be claimed without real
query volume** — logged as `UNKNOWN — REQUIRES PRODUCTION DATA`.

### FKs without a covering index (informational, low priority)
`announcements.created_by`, `courses.deleted_by`, `exam_retake_permissions.granted_by`,
`exams.deleted_by`, `groups.deleted_by`, `invitations.accepted_by`,
`invitations.course_id`, `invitations.invited_by`, `lessons.deleted_by`,
`schedules.created_by` — all are audit/soft-delete-attribution columns, never
used in a `WHERE`/`JOIN` on a hot path (they're written once and read only
for "who did this" display, if ever). **Low priority; UNKNOWN whether this
ever matters** without real query volume to profile.

### RLS policy expression cost
All tenant-scoping policies use the `(SELECT current_tenant_id())` /
`(SELECT auth.uid())` wrapped-subquery form (confirmed — this is the
`rls_initplan_optimization` migration already applied, which makes Postgres
evaluate these once per statement instead of once per row). This is the
correct, already-optimized shape. **Real query-plan behavior under load —
`UNKNOWN — REQUIRES PRODUCTION DATA`.**

### Pagination
Spot-checked: `get_admin_exams`/`get_admin_lessons`/`get_tenant_archive` have
no `LIMIT`/pagination — they return the full tenant's dataset in one call.
At 0-500 rows (a small-to-mid university) this is fine; at a very large
single tenant (many thousands of lessons/exams) this becomes a real
unbounded-response risk. **Not fixed this session** (would need UI pagination
changes on the admin pages consuming these, not just the RPC) — logged as a
new remediation item.

### Realtime subscriptions
Grepped `supabase.channel(` / `.on('postgres_changes'` across `src/` —
**zero matches**. The app does not use Supabase Realtime anywhere (matches
`CLAUDE.md`'s own note that `TenantWatcher` deliberately polls a server
endpoint instead of using Realtime, specifically because Realtime enforces
RLS on `postgres_changes` and non-admin users lack SELECT on `tenants`).
**VERIFIED — no realtime-subscription attack surface exists.**

### Connection behavior under concurrency
**UNKNOWN — REQUIRES PRODUCTION VERIFICATION.** Cannot be determined from
this session's tool access whether Supavisor pooling is active for the
connection string the app actually uses (`NEXT_PUBLIC_SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` go through PostgREST/the Supabase client library,
which pools differently than a direct Postgres connection string would).
