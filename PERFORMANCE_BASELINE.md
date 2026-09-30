# Performance Baseline — 2026-09-30 (Batch 0, before any fix)

Reference numbers for [PERFORMANCE_CONTRACT.md](PERFORMANCE_CONTRACT.md). Every later
batch reports before/after against these. **All numbers are diagnostic**: one account,
one network, a near-empty production database. They show where time and bytes go;
they are not a load test and must not be extrapolated (sizes scale with row count,
times do not).

## Environment

| Item | Value |
|---|---|
| Production | `eduquest-v2.vercel.app`, Vercel Hobby, **Fluid Compute enabled** (verified in project settings), functions in **fra1** (`X-Vercel-Id: fra1::fra1::…`) |
| Database | Supabase Free, **eu-central-1**, PostgREST only (no direct Postgres driver in the app) |
| Production data | 1 tenant, 3 users, 0 exams, 0 lessons — list sizes today are tiny |
| Client used | Desktop browser (Claude desktop app pane) on the owner's connection in Palestine (TLS handshake to Vercel 0.35–2.0 s, variable) |
| Account | One `university_admin` account. Teacher / student / centre / super-admin navigations **not measured** (no signed-in account for those roles) |
| PostgREST Max Rows | **Unknown — not verified** (see contract, "Known unknowns") |

## 1. Production — admin navigation (signed in)

Server time = the RSC request of the click (Vercel → Supabase → render). JS = page
chunks downloaded after the RSC arrives on a first visit.

| Section | 1st visit: click → page | server (RSC) | first-visit JS | 2nd visit: click → page |
|---|---|---|---|---|
| teachers | 2 548 ms | 713 ms | 1 786 ms | 570 ms |
| students | 1 014 ms | 479 ms | 492 ms | 422 ms |
| groups | 853 ms | 389 ms | 443 ms | 584 ms |
| courses | 425 ms | 612 ms | — | 467 ms |
| lessons | 361 ms | 638 ms | — | 806 ms |
| exams | 1 084 ms | 1 070 ms | — | 385 ms |
| requests | 1 220 ms | 944 ms | 485 ms | 722 ms |
| appeals | 1 003 ms | 442 ms | 481 ms | 609 ms |
| announcements | **3 996 ms** | 775 ms | **2 929 + 769 ms** | 382 ms |
| schedules | 2 005 ms | 641 ms | 735 ms | 548 ms |
| center-staff | 990 ms | 540 ms | 310 ms | 635 ms |

Warm server time of a navigation: **0.4–1.1 s** (includes the client's network RTT).
The first visit to a section adds its JavaScript chunks (0.3–2.9 s on this connection);
repeat visits are served from the browser cache.

### Sign-in → dashboard (owner-reported "more than 5 s")

| Step | Time |
|---|---|
| `POST /auth/v1/token` (browser → Supabase) | 1 164 ms |
| `/admin/dashboard` RSC | 2 205 ms (TTFB 831 ms) |
| Dashboard JS chunks | up to 2 802 ms |
| Prefetch burst right after the dashboard loads | **30 requests** (2 rounds × 15 sidebar links), each 0–1 KB, 0.2–1.7 s |

The prefetch responses carry almost nothing (every panel page is dynamic and the loading
boundary sits above the changing segment) but cost 30 proxy + function invocations per
full page load. Decision: **not disabled globally**; revisit per link with measurement (Batch 5).

### Cold responses (after idle periods)

| Observation | Time to first byte |
|---|---|
| `/login` document, first request after a long idle period | **8 900 ms** |
| `/login`, first request after ~30 min idle (curl) | **≈ 17 000 ms** total |
| Same page, warm | 200–300 ms server (TTFB minus TLS) |

Cold responses happen **with Fluid Compute enabled**. Cause not measured yet (Batch 5).
Supabase logs show the JWKS document fetched up to 7–9 times per minute during active use;
the cache is process-global with a 10-minute TTL, so each fetch is a new process or an
expiry — consistent with new instances, not proof of a cold start per request.

## 2. Backend calls per admin navigation (local production build → live Supabase)

Counted from the Supabase API edge logs (server-side calls only) for one click on each
section. "Waves" = groups of calls that start together; each wave is a sequential round trip.
Decoded RSC = size of the navigation response with today's near-empty data.

| Section | Calls | Waves | Decoded RSC |
|---|---|---|---|
| dashboard | 5 (`get_admin_lessons`, `get_admin_exams` → 2 counts + tenant → AI allowance) | 3 | 8.8 KB |
| teachers | 1 | 1 | 3.0 KB |
| students | 4 (list, profile, tenant settings, name flags) | 1 | 3.0 KB |
| groups | 2 | 2 | 3.0 KB |
| courses | 1 | 1 | 6.7 KB |
| lessons | 1 (`get_admin_lessons`) | 1 | 3.7 KB |
| exams | 1 (`get_admin_exams`) | 1 | 3.9 KB |
| requests | 2 | 2 | 3.1 KB |
| appeals | 1 | 1 | 4.2 KB |
| announcements | 4 | 3 | 3.2 KB |
| schedules | 3 | 2 | 3.0 KB |
| center-staff | 3 | 3 | 4.3 KB |
| archive | 1 | 1 | 2.9 KB |
| invitations | 1 page + 6 from its API route after mount (incl. one `GET /auth/v1/user`) | **6** | 3.0 KB |
| settings | 2 | 2 | 3.4 KB |

Each Supabase call: **62–206 ms origin time** from this run, 12–60 ms when called from
Vercel fra1 (production logs). The database is not slow per call; payload and waves are
what grow.

## 3. Scale diagnostic (synthetic institution, fully rolled back)

`supabase/tests/scale_baseline_check.sql`, run on the live database inside transactions
that end in `RAISE EXCEPTION` (nothing persisted; verified afterwards: 3 users, 1 tenant,
0 exams, 0 leftovers).

**A) 20 000 students** (50 000 was attempted; setup timed out in the member-code trigger)

| Read (exactly as the page runs it, through RLS as the real role) | Rows | JSON | DB time |
|---|---|---|---|
| `/admin/students` list | 20 000 | **6 423 KB** | 160 ms |
| `loadNameCompleteFlags` (same page + centre students) | 20 000 | 1 386 KB | 57 ms |
| `/teacher/groups` "Manage students" preload | 20 000 | **2 380 KB** | 92 ms |
| Student count (head-only) | — | — | 13 ms |

All three lists are passed to client components, i.e. sent to the browser in full
(unless PostgREST Max Rows truncates them — unknown).

**B) 2 000 exams** (50 published to the student's group, 40 questions each), 2 000 lessons,
40 000 submissions

| Feed | Rows | JSON | DB time |
|---|---|---|---|
| `get_student_exams()` | 50 | **1 718 KB** | 58 ms |
| same rows **without `questions`** | 50 | **30 KB** | — |
| `get_admin_exams()` (dashboard uses length + nothing else) | 2 000 | 537 KB | 129 ms |
| `get_admin_lessons()` (dashboard shows 5) | 2 000 | 375 KB | 99 ms |

`get_student_exams` is called from 11 places (student dashboard, exams, grades, lessons,
notifications page, notifications API polled every 5 min, quick-access panel, course
player). It reaches the **browser** in `/student/exams` (all exams, including completed
ones) and in the quick-access panel (called from the browser to show 5 titles).

## 4. Static ratchet at capture (src/__tests__/perf-contract-state.ts)

| Pattern | Sites | Files |
|---|---|---|
| `select('*')` on reads | 46 | 37 |
| Unbounded reads (static heuristic) | 153 | 66 |
| Heavy-feed call sites | 12 | 11 |

## 5. Not yet measured

- Navigations as teacher, student, centre manager, super admin (need signed-in accounts).
- A phone on a mobile network (the owner uses Android; this baseline is desktop).
- Behaviour under concurrent load.
- PostgREST Max Rows.
