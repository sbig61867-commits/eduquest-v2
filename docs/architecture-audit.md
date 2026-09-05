# EduQuest — Architecture Audit & Scalability Hardening

Living document, updated phase-by-phase. Read-only analysis unless a phase explicitly says a fix was applied.

---

## Phase 1 — Actual Architecture (as built, not as documented)

```
┌─────────────────────────────────────────────────────────────────────┐
│ Vercel (region: fra1, single region — no multi-region deploy)       │
│                                                                       │
│  Next.js 16 App Router, all API routes = Node.js serverless funcs   │
│  (no `export const runtime = "edge"` anywhere — confirmed by grep)  │
│                                                                       │
│  src/proxy.ts  ──── auth/RBAC gate on every matched request         │
│         │            (getClaims() local JWT verify, no DB hit)      │
│         ▼                                                            │
│  Route groups: (auth) (student) (teacher) (admin) (super-admin)     │
│         │                                                            │
│         ├─ RSC / Server Actions → src/lib/supabase/server.ts        │
│         │    (createServerClient, anon key, RLS-scoped, per-request)│
│         │                                                            │
│         ├─ 'use client' components → src/lib/supabase/client.ts     │
│         │    (createBrowserClient, anon key, RLS-scoped)            │
│         │                                                            │
│         └─ 39 API route handlers (src/app/api/**)                   │
│               ├─ user-session client for reads + authZ checks       │
│               └─ service-role client (bypasses RLS) instantiated    │
│                   locally in ~8 routes (admin/*, accept-invitation, │
│                   exam/submit, rate-limit.ts) for privileged writes │
└───────────────┬───────────────────────────────────────┬─────────────┘
                │                                        │
                ▼                                        ▼
   ┌─────────────────────────────┐          ┌──────────────────────────┐
   │ Supabase (Postgres + Auth)  │          │ External APIs (all HTTP,  │
   │ Access path: PostgREST only │          │ no direct SDK sockets)    │
   │ — no direct pg/DATABASE_URL │          │                           │
   │ connection anywhere in app  │          │ • Groq (text gen)         │
   │ code; connection pooling is │          │ • Cerebras (fallback)     │
   │ entirely Supabase's problem,│          │ • Gemini (fallback text + │
   │ not the app's.              │          │   proctoring vision)      │
   │                             │          │ • OpenRouter (last resort)│
   │ RLS on every tenant table.  │          │ • Resend (email)          │
   │ SECURITY DEFINER RPCs for   │          └──────────────────────────┘
   │ server-authoritative ops:   │
   │ start_exam_attempt,         │          ┌──────────────────────────┐
   │ finalize_exam_submission,   │          │ LiveKit Cloud             │
   │ append_proctoring_events,   │          │ Live proctoring A/V only  │
   │ check_rate_limit,           │          │ (room = exam-{examId},   │
   │ accept_invitation (defined  │          │  student publish-only,   │
   │ but unused — see Phase 2/3),│          │  teacher subscribe-only) │
   │ cleanup_expired_invitations │          └──────────────────────────┘
   │ (pg_cron — unconfirmed live)│
   │                             │          ┌──────────────────────────┐
   │ Storage: 1 bucket, used     │          │ Sentry (server + client  │
   │ only by proctor/evidence    │          │ config present)          │
   └─────────────────────────────┘          └──────────────────────────┘
```

**Boundary-by-boundary:**

| Boundary | Implementation | Notes |
|---|---|---|
| Frontend | Next.js 16 App Router, React 19, route-group layouts per role | No separate SPA/API split — SSR + client components in one app |
| Server/API | 39 route handlers under `src/app/api/**`, all Node.js runtime | No edge functions; cold starts are a Vercel/Node concern, not addressed anywhere in code |
| Supabase access | 100% via `@supabase/ssr` + `@supabase/supabase-js` → PostgREST | No raw `pg` driver, no connection string in app env — DB connection scaling is delegated entirely to Supabase's pooler |
| Realtime | **Not used.** `grep -rl "\.channel("` returned zero hits | Any "live" UI (grades appearing, notifications) is polling/refetch-on-navigation, not push |
| LiveKit | Used exclusively for proctoring audio/video, not for app data | Correctly scoped per exam+role (verified in Phase 2 audit below) |
| AI | `src/lib/ai/chat.ts` fallback chain Groq→Cerebras→Gemini→OpenRouter | No usage/cost tracking, no fetch timeouts except `proctor/analyze` (see Phase 4 findings) |
| Storage | Supabase Storage, one integration point: `proctor/evidence` | Minimal surface area |
| Background jobs | **None in the app.** Only DB-level `pg_cron` (`cron_cleanup.sql`) for expired invitations, and even that's unconfirmed as scheduled on production | No queue, no worker process — everything is request/response |
| Rate limiting | `check_rate_limit` Postgres RPC, per `feature:userId`, fail-open | Per-user only, no per-tenant or global ceiling (Phase 4) |
| Caching | **None found.** No `unstable_cache`, `revalidateTag`, Redis, or in-memory cache anywhere | Every read hits PostgREST/Postgres directly |
| Auth/AuthZ | JWT app_metadata (role/tenant_id/is_active) synced by `sync_user_claims` trigger; `proxy.ts` reads via local `getClaims()` — no per-request DB call | RLS is the real authorization enforcement; app-level checks are defense-in-depth |

**Correction to CLAUDE.md**: the doc says "no test framework configured." This is now false — `vitest`, `@playwright/test`, and `@testing-library/*` are installed with `npm test` wired up, and real specs exist (`src/__tests__/*.test.tsx`, `tests/groups-cache.spec.ts`). Worth fixing the doc since Phase 10 verification depends on knowing this.

No bugs blocked Phase 1 discovery, so no code was touched.

---

## Phase 2 — Exam Flow Deep Audit

Full trace, student open → result. All timing/grading is server-authoritative — verified correct except one real bug (row 5).

| # | Step | Endpoint/fn | DB ops (via PostgREST/RPC) | R/W | Frequency | Concurrency sensitivity | Current mitigation | Recommended fix |
|---|---|---|---|---|---|---|---|---|
| 1 | Load exam list | `get_student_exams()` RPC | 1 read, strips `correct_answer` server-side via `jsonb_array_elements(...) - 'correct_answer'` | R | 1×/page load | Low | RLS + RPC filtering | None needed — verified no answer leakage |
| 2 | Start attempt | `POST /api/exam/start` → `start_exam_attempt` RPC | 1 read (enrollment/window check) + 1 upsert (`status='in_progress'`, server `started_at`) | R+W | 1×/student/exam, idempotent on refresh | Medium — many students starting in the same minute at exam-open time | Idempotent RPC, server clock | Fine as-is |
| 3 | Fetch questions | via same RPC/exam row, answers stripped | 1 read | R | 1×/attempt | Low | — | — |
| 4 | Answer questions | **In-memory React state only** (`exam-taker.tsx`) | **None** — no autosave, no `localStorage`, no periodic write | — | N/A | **High** — this is the actual weak point | None | **Add autosave**: debounced write (e.g. every 15-30s or on every answer change) to `localStorage` at minimum, ideally a lightweight `save_progress` RPC so a crash/refresh doesn't lose answers (Phase 6) |
| 5 | Submit | `POST /api/exam/submit` → `finalize_exam_submission` RPC | Server reads `questions` w/ `correct_answer` (service-role), computes score, 1 `FOR UPDATE` row lock + upsert into `grades` (`ON CONFLICT DO UPDATE`) | R+W | 1×/attempt, spikes hard at exam deadline | **Highest concurrency point** — everyone submits within the same minute at the deadline | Row lock, atomic status transition, unique constraint `(exam_id,student_id)` — **re-submission is correctly blocked** | **Bug**: `fetch('/api/exam/submit', …)` in `exam-taker.tsx:248` has no `try/catch`. A thrown network error (not just a non-OK response) skips `setSubmitting(false)`, leaving the UI stuck, after camera/mic/fullscreen are already torn down. Combined with #4 (no autosave), a network blip at submit time can cost a student their entire attempt. **Fix**: wrap in try/catch + retry-with-backoff; same bug exists in `startExam()` (leaks the camera `MediaStream` on throw) |
| 6 | Proctoring events | `POST /api/proctor/analyze` → `append_proctoring_events` RPC | Atomic `jsonb ||` concat `UPDATE` on the *same* `exam_submissions` row, guarded by `status='in_progress'` | W (frequent) | Every few seconds per active student, per active exam | **High** — see Phase 3 (row bloat) | Atomic concat avoids read-then-write races; 10s timeout + fail-silent on Gemini; DB-backed rate limit (200/hr/user, fail-open) | See Phase 3/4 for the write-amplification concern |
| 7 | Grading | Computed inline during submit (server-side from `correct_answer`) | Same transaction as step 5 | — | — | — | Score can never be client-forged | None needed |
| 8 | Result | Read from `grades` table | 1 read | R | 1×+/student | Low | RLS | None needed |

**Risks found:** one real correctness bug (step 5/#4 — no autosave + unhandled fetch rejection = attempt/answer loss on network hiccup at the worst possible moment). No security or grading-integrity bugs found in the flow.

**What must be fixed:** the two missing `try/catch` blocks and the missing autosave — this is a **Phase 5/6 priority-1 (data integrity) item**, not a scalability item, but it's the single highest-impact fix in the whole audit because it directly loses real student work.

---

## Phase 3 — Database Scalability Audit

**Indexes** (verified present, not assumed):
- `idx_exam_submissions_exam_student` on `(exam_id, student_id)` — covers the hot lookup used by `append_proctoring_events` and `finalize_exam_submission`'s row lock. Good, already justified by the query pattern above.
- `idx_grades_exam_id`, `idx_grades_student_id`, `idx_grades_submission_id` — cover both teacher-side ("all grades for this exam") and student-side ("my grades") reads.
- `idx_group_students_student` — covers enrollment checks (used on nearly every RLS policy and the start/submit RPCs).
- `idx_exams_group_published` (partial, `WHERE is_published = true`) and `idx_exams_live` (partial, `WHERE deleted_at IS NULL`) — correctly scoped partial indexes for the actual hot-path filter, not blanket indexes.
- **No index found on `exam_submissions.exam_id` alone** (only the composite `(exam_id, student_id)`) — not a problem today since every query also filters by student or uses the composite, but flagging so it isn't "fixed" speculatively without a query that needs it.
- **Not adding** any new index here — nothing in the current query patterns justifies one; this matches the user's explicit instruction not to add indexes without proof.

**Schema/constraints:**
- `exam_submissions` has `UNIQUE(exam_id, student_id)` and `grades` has `UNIQUE(student_id, exam_id)` — both correctly prevent duplicate rows at the DB level, independent of and reinforcing the app-level idempotency in `finalize_exam_submission`.
- All FKs use `ON DELETE CASCADE` except `grades.submission_id` which is `ON DELETE SET NULL` — correct choice (deleting a submission shouldn't silently delete the grade of record).

**The real bottleneck — `proctoring_events` write pattern:**
`append_proctoring_events` does `UPDATE exam_submissions SET proctoring_events = proctoring_events || new_events WHERE exam_id=... AND student_id=... AND status='in_progress'`. Postgres has no true "append" — every call rewrites the *entire row* (MVCC: old version becomes a dead tuple). During a live exam with, say, 200 concurrent students each sending a proctoring update every few seconds, that's the same `exam_submissions` row per student being fully rewritten dozens of times over the exam duration. This is:
- Write amplification proportional to `proctoring_events` array size (each rewrite re-serializes the whole growing JSONB blob, not just the delta).
- Autovacuum pressure on a table that's also the target of the `FOR UPDATE` lock in `finalize_exam_submission` — a burst of submits at the deadline contending with an already-bloated table is the most plausible first bottleneck under load (this is a hypothesis to validate in Phase 4/7, not yet measured).

**Recommended fix (not yet implemented — needs Phase 4/7 evidence to prioritize):** move `proctoring_events` to its own table (`proctoring_events(id, submission_id, event, created_at)`, plain `INSERT`, no row rewrite) instead of an append-only JSONB column on the hot `exam_submissions` row. This is a schema change — per your rules, **not doing this until Phase 4 quantifies whether it's actually a bottleneck at realistic concurrency**, since today's traffic may never hit the threshold where this matters.

**Connection/transaction behavior:** since the app talks to Postgres exclusively through PostgREST (no direct `pg` connections), Vercel serverless function scale-out doesn't directly threaten Postgres connection limits the way it would with a raw connection pool per invocation — that risk is Supabase's PostgREST layer's problem, bounded by your Supabase plan's connection pooler, not something visible or fixable from the app code. Flagging this as a Phase 4 "what's the actual Supabase plan's pooler limit" question rather than a code bug.

**N+1 queries:** not found in the exam flow (all reads go through RPCs designed as single round-trips). A broader sweep of reporting/dashboard pages was out of scope for this pass — worth a targeted check if a specific page feels slow.

**RLS on hot tables:** `rls_performance_migration.sql` indicates RLS policies were already rewritten once for performance (per CLAUDE.md history) — current policies use the indexed helper functions, no obvious re-regression found in this pass (full RLS policy text audit is pending the security-focused background agent, appended below when ready).

**No indexes added, no schema changed in this phase** — consistent with your instruction to prove need before acting.

---

### Security/RLS deep-dive (RBAC, service-role usage, RLS policies)

**Strengths:** consistent pattern across ~35 API routes using the service-role client — user-session auth + role/tenant ownership check always happens *before* any privileged write; the admin client is never used to make an authorization decision. `rate_limits` has RLS enabled with zero policies (deny-all direct access), forcing all access through `check_rate_limit`. No hardcoded secrets in committed source. Core tenant tables (`groups`, `lessons`, `exams`, `exam_submissions`, `grades`, `users`) are all correctly scoped via `current_tenant_id()`; the only unrestricted-read policy (`platform_settings`) is intentional (non-sensitive config).

**Bug — stale JWT role survives a demotion:** `src/app/api/session/check/route.ts:35-54` only detects `user_deleted`, `user_disabled`, `tenant_deleted`, `tenant_suspended`. It never re-checks **role**. If an admin demotes a teacher to student, the teacher's existing JWT keeps its old `app_metadata.user_role` claim until the access token naturally expires (Supabase default ~1h) — full teacher UI/API access continues for up to an hour despite the demotion, and the periodic session-check poll won't catch it because it isn't looking at role at all. **Fix:** have `session/check` also compare the DB row's current role against the JWT's claimed role and force a sign-out/refresh on mismatch (same pattern already used for `is_active`/tenant checks — this just extends it to `role`).

**Gap — no defense-in-depth role map for `/api/*`:** `proxy.ts`'s `ROLE_ROUTES` only maps *page* prefixes (`/admin`, `/teacher`, `/student`, `/super-admin`); API routes get only login+active+tenant checks at the proxy layer, with role enforcement left entirely to each route handler. Every route currently does this correctly, but there's no backstop if a future route omits the check. **Fix:** add a second role map for `/api/**` prefixes in the proxy as defense-in-depth — low effort, closes a "forgot to check role" class of future bug before it ships.

**Verify specifically — `sync_user_claims`:** unlike the other `SECURITY DEFINER` functions, `sync_user_claims` (`supabase/jwt_claims_migration.sql:16`) is not covered by either search-path fix migration and has no `SET search_path` pinned. It runs on every user insert/update and touches `auth.users` — same bug class that caused the original teacher-can't-create-group 403s. **This should be verified against the live DB and patched if missing**, since a silent failure here would mean new/changed users stop getting correct JWT claims at all (symptom: freshly created or edited users get 403'd everywhere, "works in SQL editor" — exactly the historical bug pattern).

**Minor style nit:** `admin/teacher-permissions/route.ts:40-44` and `reports/route.ts` fetch the ownership-check row via the admin client rather than the user session client. Not a vulnerability (the authorization decision still compares against the session-derived caller identity), but it deviates from the stated project convention and should be tightened for consistency the next time either file is touched.

---

## Consolidated bug/finding list — by your stated priority order

| Priority | Finding | File | Status |
|---|---|---|---|
| 1. Correctness | Unhandled `fetch` rejection in exam submit/start — spinner stuck, camera leak | `exam-taker.tsx` | ✅ **Fixed** — try/catch added around both fetches, cleanup runs on network throw too |
| 2. Data integrity | No autosave — answers live only in React state, lost on crash/refresh | `exam-taker.tsx` | ✅ **Fixed (Option A)** — debounced localStorage draft, restored on attempt start, cleared on successful submit |
| 2. Data integrity | `accept_invitation` atomic RPC exists in DB but app does select-then-update instead — public/multi-use invites can overshoot `max_uses` under concurrent accepts | `src/app/api/auth/accept-invitation/route.ts` | ✅ **Fixed** — route now calls the existing atomic RPC instead of hand-rolled select/update |
| 3. Security | Stale JWT role survives demotion for up to ~1h | `src/app/api/session/check/route.ts` | ✅ **Fixed** — session/check now compares DB role vs JWT-claimed role, forces sign-out on mismatch |
| 3. Security | `sync_user_claims` search_path unverified — same bug class as a prior incident | `supabase/jwt_claims_migration.sql:16` | ⏳ **Needs live-DB verification** — a read-only check, not a code fix; see below |
| 3. Security | No API-level role map in proxy (defense-in-depth only, no current exploit) | `src/proxy.ts` | Deferred — low priority, no active exploit |
| 4. DB efficiency | `proctoring_events` JSONB append rewrites the whole hot `exam_submissions` row repeatedly during live exams | `supabase/fix_all_search_path_migration.sql:61-69` | Revised down in Phase 4 — event-driven not continuous; deferred pending real load evidence |
| 6. Caching | Zero caching anywhere — every read hits PostgREST | n/a | Deferred — no evidence this is a real bottleneck yet |
| 7. Async | AI provider total-exhaustion had no alerting; no usage/cost tracking | `src/lib/ai/chat.ts` | ✅ **Fixed (alerting only)** — `Sentry.captureException` fires when all 4 legs fail, tagged `ai-provider-chain` with the list of providers tried. Usage/cost tracking is bigger scope, not done |
| 7. Async | Expired-invitation cleanup (`pg_cron`) not confirmed scheduled on production | `supabase/cron_cleanup.sql` | ⏳ **Needs live-DB verification** |
| — Docs | CLAUDE.md wrongly stated "no test framework" | `CLAUDE.md` | ✅ **Fixed** — corrected, vitest/Playwright documented |
| — Code quality | 12 `as any` casts remain against project convention | `src/lib/reports.ts` (×9), `grades/export`, `surveys/respond` | Not fixed — out of this batch's scope, flagging for later |
| — Docs | 22 of 30 migration files in `supabase/` are never named in CLAUDE.md's "Applied" list — can't confirm from the repo alone which are live | `CLAUDE.md` | **Needs your confirmation of what's actually applied** |

### Phase 10 — Verification of this batch

- `npx tsc --noEmit` → 0 errors
- `npm run lint` → clean (exit 0)
- `npx vitest run` → **52/52 tests passed**, 3 test files
- Changed files: `exam-taker.tsx`, `api/auth/accept-invitation/route.ts`, `api/session/check/route.ts`, `lib/ai/chat.ts`, `CLAUDE.md` — no schema/migration touched, nothing applied to the live database.
- Not run: build (`npm run build`) and browser verification of the exam-taking flow — recommend doing both before merging, since `exam-taker.tsx` is the highest-stakes file in the app and automated tests don't cover its UI flow end-to-end.

### Additional bug found during the test-user cleanup (2026-09-03)
`invitations.invited_by` is `NOT NULL` on the live production DB, but its FK is `ON DELETE SET NULL` (`invitations_migration.sql:27`) — these are mutually incompatible: deleting **any** user who has ever created an invitation throws `23502 null value ... violates not-null constraint` instead of the intended "preserve the invitation, blank the audit field" behavior. Discovered because `Admin.university.test@eduquest.local`'s one test invitation blocked the cleanup, and would block deleting any real teacher/admin who ever sent an invite. **Fix prepared**: `supabase/fix_invitations_invited_by_nullable.sql` drops the `NOT NULL` constraint (matches the FK's documented intent — `invited_by` is still always set at INSERT time via the RLS `WITH CHECK` clause, only ever nulled retroactively by the existing `ON DELETE SET NULL`). Not applied yet — run it the same way as the cleanup script, in the SQL Editor.

**Related doc gap, not fixed**: `invitations` isn't in `schema.sql` at all (only in the standalone migration files) — the "update schema.sql to reflect new state" convention from CLAUDE.md has drifted for this table specifically. Flagging, not fixing now (out of scope for this bug fix).

### Still open — needs your decision
1. **Verify `sync_user_claims` has `SET search_path` on the live DB.** I can run a read-only `SELECT prosecdef, proconfig FROM pg_proc WHERE proname='sync_user_claims'` against production using the `SUPABASE_ACCESS_TOKEN`/service-role key already in `.env.local` — say the word and I'll do the read-only check first (no writes) and report back before proposing any migration.
2. **Confirm `cleanup_expired_invitations` is actually scheduled via `pg_cron`** on production — same read-only check available.
3. Phase 7 (real load testing) remains deferred per your earlier answer.

---

## Phase 4 — High-Concurrency Analysis (analytical, NOT load-tested)

**Explicitly not a claim of "the system supports N users."** Per your own rule, no concurrency number below is validated by measurement — Phase 7 real load testing was deferred by you, so everything here is derived from reading the code paths, not from a benchmark. Treat this as a prioritization tool for Phase 5, not a capacity guarantee.

**Correction to my own Phase 2/3 framing:** the "proctoring writes every few seconds" claim in Phase 2/3 assumed the legacy Gemini-frame path (`proctor/analyze`, gated behind `NEXT_PUBLIC_SERVER_PROCTORING`, **disabled by default**). The actual default path is local TensorFlow/MediaPipe detection in-browser, which only calls `append_proctoring_events` **when a violation is actually detected** (tab-switch, face-not-found, etc.) — event-driven, not a continuous stream. This meaningfully lowers the write-amplification concern raised in Phase 3: it's proportional to cheating/false-positive rate, not to student count × time. Revising that finding's severity down accordingly — it's still worth the schema fix eventually, just not urgent.

**What actually scales with concurrent exam-takers (the two real spikes):**

1. **Exam-start spike** — everyone opening the exam at `starts_at`. One `start_exam_attempt` RPC call each (1 read + 1 upsert).
2. **Exam-submit spike** — everyone hitting the deadline (or the 30s grace window) at once. One `submit` call each: server re-reads `questions` (service-role), computes score, one `finalize_exam_submission` RPC (`FOR UPDATE` on that student's own submission row only — **not** a shared/exam-wide lock, so concurrent students don't serialize against each other, only against their own possible double-submit).

| Concurrent exam-takers | Est. requests/sec at start+submit spikes* | Est. DB writes/sec* | Est. DB reads/sec* | Realtime load | LiveKit load (if live-monitor on) | Rate-limit table pressure | First-expected bottleneck |
|---|---|---|---|---|---|---|---|
| 100 | ~5-10 | ~5-10 | ~10-20 | None (unused) | 100 publishers, negligible for LiveKit Cloud | Negligible | None expected |
| 500 | ~15-30 | ~15-30 | ~30-60 | None | 500 publishers — within typical LiveKit Cloud room limits | Negligible | None expected |
| 1,000 | ~30-60 | ~30-60 | ~60-120 | None | 1,000 publishers in one room — check LiveKit plan's per-room participant cap | Small, indexed table, fine | Possibly LiveKit per-room participant limit if all 1,000 are in *one* exam's live-monitor room |
| 2,000 | ~60-120 | ~60-120 | ~120-240 | None | Same concern, larger | Still fine | Same as above; also Vercel serverless concurrent-invocation limits become worth checking against your plan |
| 5,000 | ~150-300 | ~150-300 | ~300-600 | None | Very likely exceeds a single LiveKit room's practical participant ceiling | Still fine (single small indexed table, but worth confirming autovacuum keeps up) | **Most likely first real bottleneck**: Supabase project's PostgREST/pooler connection ceiling for your specific plan tier, not app code — this is an infrastructure-tier question, not a redesign question |
| 10,000 | ~330-670 | ~330-670 | ~670-1300 | None | Same, worse | Needs confirming | Same as 5,000 — the honest answer is **"unknown without either a load test or your Supabase plan's documented pooler limits,"** not "the app can't handle it" |

*\*Ranges assume the grace/deadline window spreads submits over roughly 15-30 seconds rather than a single instant, and one exam this size running at once — 10,000 concurrent takers **spread across many different exams/tenants** behaves very differently (much lower per-exam contention) than 10,000 all in **one** exam. This distinction matters and isn't captured by a single "concurrent users" number — worth clarifying which scenario you actually care about before Phase 7.*

**What does NOT scale with exam-taker count** (good news, no redesign needed): AI generation (`generate-exam`, `generate-lesson`, etc.) is a teacher-side authoring action, not in the student exam-taking hot path at all — a 10,000-student exam does not touch Groq/Cerebras/Gemini/OpenRouter. The AI-provider quota gap found in Phase 3 is a real bug, but it's an authoring-side reliability problem, not a scalability-under-exam-load problem — don't let it distract from the exam-flow scaling question.

**Where I can't give you a real number without Phase 7 or your Supabase dashboard:** the actual size of your Supabase project's PostgREST/pgbouncer connection pool (varies by plan), your Vercel plan's concurrent-function-execution ceiling, and LiveKit Cloud's per-room participant cap on your plan. These three numbers, not application code, are what actually determine where things break — worth pulling from your Supabase/Vercel/LiveKit dashboards directly since I don't have visibility into billing-tier limits.

---

## Phase 5 — Proposed Fixes (NOT YET APPLIED — awaiting your review per your request)

You asked to see details before any edit. Here's exactly what each fix would change, in priority order. Nothing below has been touched in the codebase yet.

### 1. Correctness — `exam-taker.tsx` unhandled fetch rejections
**File:** `src/app/(student)/student/exams/exam-taker.tsx`
**Change:** wrap the `fetch('/api/exam/submit', …)` call (~line 248) and the `fetch('/api/exam/start', …)` call (~line 195) in `try/catch`. On catch: for submit, retry once with backoff, then show a persistent "retry submission" UI instead of a silent stuck spinner (never lose the in-memory answers by navigating away). For start, stop the already-acquired camera/mic `MediaStream` before surfacing the error, so a failed start doesn't leave a live recording device open.
**Risk if not done:** a transient network blip at the worst possible moment (submit) costs a student their attempt.
**Blast radius:** pure client-side logic, no DB/schema change, fully reversible, no migration needed.

### 2. Data integrity — autosave for in-progress answers
**File:** `exam-taker.tsx` (+ optionally a new tiny RPC)
**Two options, pick one:**
- **A (minimal, no DB change):** debounce-save `answers` to `localStorage` keyed by `attemptId` on every change; on mount, if a saved draft exists for this attempt and is newer than what's rendered, offer to restore it. Survives refresh/crash on the *same device*, not a device swap. Zero backend risk.
- **B (stronger, needs a new tiny RPC):** periodic (e.g. every 20s) `save_progress(exam_id, answers)` RPC that upserts into `exam_submissions.answers` while `status='in_progress'` — survives device swap too, but is a new DB function (small, same pattern as `append_proctoring_events`) and one more write per student per interval during every exam. Given Phase 4's finding that DB writes during exams aren't the bottleneck at realistic scale, this is affordable, but it's your call whether the extra migration is worth it over the simpler localStorage-only fix.
**Recommendation:** start with A now (ships today, zero migration), consider B later if device-swap-mid-exam turns out to be a real support complaint.

### 3. Data integrity — invitation accept race condition
**File:** `src/app/api/auth/accept-invitation/route.ts`
**Change:** replace the current select-then-update (lines ~45-131) with a call to the existing `accept_invitation` RPC (already defined in `supabase/invitations_migration.sql`, already atomic, already unused). This is an application-code change only — the DB function already exists live (per CLAUDE.md's applied-migrations list including `invitations_migration.sql`'s later revisions), so no new migration should be needed, just verifying the RPC's exact signature matches what route.ts would call.
**Risk if not done:** a public/multi-use invite link capped at N uses can admit more than N students under concurrent acceptance.

### 4. Security — stale role in JWT after demotion
**File:** `src/app/api/session/check/route.ts`
**Change:** extend the existing deleted/disabled/suspended checks (lines 35-54) to also compare the DB row's current `role` against the JWT's claimed role, and force a sign-out when they differ. Same shape as the existing checks, no new infra.
**Risk if not done:** a demoted user keeps their old permissions for up to the access-token TTL (~1h).

### 5. Security — verify `sync_user_claims` search_path (DB-side, not app code)
Not a code change — a verification task against the live database (`SELECT prosecdef, proconfig FROM pg_proc WHERE proname='sync_user_claims'`), and if missing, a small migration following the exact pattern of `fix_all_search_path_migration.sql`. I'd need your go-ahead to either run this check via the Supabase Management API token in `.env.local`, or you run it yourself in the SQL Editor — your call given this touches the live DB.

### 6. Async/reliability — AI provider exhaustion alerting
**File:** `src/lib/ai/chat.ts` + the 6 calling routes
**Change:** when `aiChatDetailed` exhausts all 4 legs, log a structured error to Sentry (already installed, currently only catching unhandled exceptions — this would be an explicit `Sentry.captureException` with provider/route context) instead of just `console.error`. This alone turns "silent until a user complains" into "you get paged." A fuller fix (usage/cost table) is bigger scope — worth deciding separately.
**Risk if not done:** exactly the gap you originally asked about — no one finds out a key died except by user complaint.

None of the above have been applied. Tell me which to proceed with (all, some, or none) and I'll implement them one at a time, showing the diff before moving to the next.
