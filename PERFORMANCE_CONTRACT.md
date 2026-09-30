# Performance Architecture Contract

**Status:** binding for all new and changed code since 2026-09-30 (Batch 0 of the
Performance Architecture & Scale Hardening phase). Measurements behind every rule:
[PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md).

This is a permanent architectural rule set, not a fix for one slow screen. A page
built to these rules behaves the same for an institution of 100 students and one of
100 000; a page that breaks them gets slower, heavier and eventually wrong (silently
truncated) as the institution grows.

## Scope

Every screen (`src/app/**`), every component that reads data (`src/components/**`),
every route handler whose response a screen consumes (`src/app/api/**`), shared
data helpers (`src/lib/**`), and every SQL function (RPC) a screen calls.

## Rules

### P1 — No unbounded reads that reach a client
A read whose result reaches a browser (directly, as props of a client component, or
through an API response) must be bounded:
- **Lists** are paginated on the server (default page 50, maximum 100), with
  search / filter / sort executed in the database, not by filtering an array in the
  browser.
- **Counts and totals** come from the database (`select(…, { count: 'exact', head: true })`
  or an aggregate RPC), never from `rows.length` of a fetched list.
- **Selectors** (e.g. "add a student to a group") search on demand and return one
  page; they never preload the institution.
- Reads that are bounded by nature (one row by id, a student's own rows under a hard
  product limit) are allowed, but the bound must be stated in a comment when it is
  not obvious from the query.

### P2 — Explicit projections
Name the columns a screen needs. No `select('*')` (or embedded `table(*)`) on data
that reaches a client: a table grows columns over time (`courses.source_text` holds up
to 12 000 characters) and every one of them would silently ship.

### P3 — Metadata is separate from content
Feeds, lists, dashboards, widgets and polling endpoints carry metadata only (title,
dates, status, counts). Heavy content — exam questions, lesson bodies, source text,
attachments — is loaded only by the flow that uses it (e.g. questions only when an
exam attempt starts). Feeds known to violate this are registered in `HEAVY_FEEDS`
(`src/__tests__/perf-contract-scan.ts`) and their call sites may only shrink.

### P4 — No N+1
Never one database call per row. Batch with `.in(…)` or an RPC that takes an array
and returns one row per key. Calls inside `Promise.all(rows.map(…))` are still N
calls: they cost N times the database work even when they do not cost N round trips
of latency.

### P5 — No needless sequential dependencies
Independent reads start together (`Promise.all`). A read waits only for the value it
actually needs. **"One query per page" is not the rule** — the goal is fewer round
trips and smaller payloads with a design that stays maintainable. A page-specific
aggregate RPC is used when it removes real round trips or real payload, not by
default.

### P6 — UI-facing RPCs are bounded
Every SQL function a screen calls either takes a page (limit + cursor/offset) or
returns aggregates. None returns a whole institution's table without a stated reason.
Their size and time are measured by `supabase/tests/scale_baseline_check.sql`.

### P7 — The database is the source of truth and of isolation
Row Level Security remains the tenant boundary. Reads go through the user-session
client (`src/lib/supabase/server.ts`); the service-role client stays limited to the
patterns in CLAUDE.md. **No performance change may move an authorization decision
from the database into application code** — including to make something cacheable.
Security fixes are never removed to gain speed.

### P8 — Caching (future) is tenant/user-aware and never a security boundary
No application-data cache exists today, deliberately. When one is added:
- its key includes the tenant and, for personal data, the user (and role);
- it is never the thing that enforces who sees what — RLS still does;
- RLS-scoped data is never cached through the service-role client;
- the invalidation is written in the same change as the cache, next to the write paths.

### P9 — No Redis now
Redis (or any new infrastructure) is added only when measurement shows the database
is the bottleneck for a specific hot path — see "Triggers for the next steps".

### P10 — A data-access layer, so caching can be added later without a rewrite
New and changed reads live in `src/lib/data/<resource>.ts` as functions that take the
Supabase client and explicit parameters (tenant, page, filters) and return typed
rows. Pages and route handlers call these functions instead of assembling queries
inline. Caching, if ever needed, is then added inside one function. Existing inline
queries migrate when they are touched; no big-bang rewrite.

### P11 — Navigation
Shared layouts (sidebar, header, shell) stay mounted between sections. Decisions of
2026-09-30: **no streaming / Suspense loading UI for now**; **link prefetch keeps the
Next.js defaults** — it is not disabled globally, and any per-link change needs a
before/after measurement. Loading UI is never counted as a fix for backend latency.

## Budgets

| Budget | Target | How it is checked |
|---|---|---|
| Rows per list response | ≤ page size (≤ 100) | Ratchet (P1) + review |
| Decoded RSC payload of a list/dashboard navigation | ≤ 150 KB **at any institution size** | Baseline procedure (manual) |
| Supabase calls per navigation | ≤ 6 | Baseline procedure (manual, from the API edge logs) |
| Sequential waves of calls per page | ≤ 2 | Review |
| Server time of a warm navigation (fra1) | p75 ≤ 500 ms | Baseline procedure (manual) |
| Student exam list payload | independent of the number of questions | `scale_baseline_check.sql` block B |
| Admin/student feeds at 2 000 rows | bounded to one page | `scale_baseline_check.sql` |

## Enforcement — what is automatic and what is not

| Mechanism | Covers | Limits (stated honestly) |
|---|---|---|
| `src/__tests__/perf-contract.test.ts` (ratchet, runs with `npm test`) | P2 star selects, P1 unbounded reads, P3 heavy-feed call sites — per file, may only go down | Static: a query built over several statements (`let q = …; q = q.limit()`) counts as unbounded; it cannot see what an RPC's SQL returns |
| `supabase/tests/scale_baseline_check.sql` | P3 / P6 sizes and times on a synthetic institution, fully rolled back | Diagnostic: sizes scale linearly, times do not — never extrapolate times |
| Review checklist (below) | P4, P5, P7, P8, P10 | Human |
| Baseline procedure (PERFORMANCE_BASELINE.md) | Budgets per navigation | Needs a signed-in account per role |

**Review checklist for any change that reads data**
1. Does any result reach a client unbounded? (P1)
2. Are the columns named? (P2)
3. Does a list/feed/widget carry content it does not display? (P3)
4. Any call per row? (P4)
5. Could two awaits start together? (P5)
6. Does the RPC take a page or return aggregates? (P6)
7. Is authorization still decided by RLS / the documented service-role pattern? (P7)
8. Is the query in `src/lib/data/`? (P10)

## Known unknowns (not verified — do not assume)

- **PostgREST "Max Rows"** of this project: not verified. It could not be read from
  here (the Supabase dashboard is not reachable from the tooling). Supabase's
  documented default is 1000; if it still applies, every unbounded list above 1000 rows
  is **silently truncated** today — a correctness bug, not only a speed one. P1 removes
  the dependence on this value either way. Verify in Dashboard → Settings → API.
- **Cold responses**: 8.9 s and ~17 s time-to-first-byte were observed after idle
  periods although Fluid Compute is enabled. Cause not yet measured (function bundle
  size, Sentry server init, platform). Tracked for a later batch.

## Verified facts (2026-09-30)

- Vercel **Fluid Compute: enabled** (project settings, read-only check).
- Function region: **fra1** (`X-Vercel-Id: fra1::fra1::…`); Supabase: **eu-central-1**.
- No direct Postgres driver in the app: all database traffic goes through PostgREST.

## Triggers for the next steps (measure first, then act)

| Signal | Step |
|---|---|
| Commercial launch | Vercel Pro (Hobby is non-commercial); also reduces cold starts |
| Database CPU > 60 % sustained, or navigation p75 > 500 ms after the batches | Larger Supabase compute, then a read replica |
| A metadata read served thousands of times per minute with rare changes | A tenant-keyed cache for that read only (P8) |
| Measured hot counters / rate limiting / live presence load on Postgres | Redis for that path only |

## Phase plan (each batch: typecheck, lint, all tests, build, related RLS/security checks, before/after measurement)

0. Contract, guards, baseline (this document) — no behaviour change.
1. Exam delivery: metadata-only student exam feed; questions only in the attempt flow
   (touches the exam start path — security-critical, needs its own migration and
   end-to-end checks: start, resume, submit, course quizzes).
2. Large lists: admin/centre students and teachers, teacher group selector — server-side
   pagination, search, counts, projections.
3. Admin lessons/exams: bounded feeds, separate counts.
4. Student courses: remove sequential waves, batch progress, drop `select('*')` / `source_text`.
5. Navigation: first-visit JavaScript, prefetch per measurement, cold-start investigation.
