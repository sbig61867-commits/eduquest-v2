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

## Batch 2 — admin students list (`/admin/students`)

`supabase/tests/admin_students_list_check.sql`, 20 000 students in institution A + 5 in B, rolled back.
Server-side page of 50 (`src/lib/data/people.ts` `listStudents`), search in the database, exact
count from the same query, `name_complete` on the same rows (the second whole read is gone).

| | before | after |
|---|---|---|
| Rows sent to the browser | 20 000 | 50 |
| JSON | 6 404 KB list + 1 386 KB name flags | **16 KB** |
| DB time | 150 + 33 ms | 34 ms (page + exact count) · last page 16 ms |
| Supabase calls per navigation | 4 (list, profile, settings, name flags) | 3 (page+count, profile, settings) |
| Search | in the browser over all rows | database ILIKE: 134 ms for a rare term, 67 ms count for a term matching all 20 000 (no index; trigram index only if measured need) |

Isolation (through RLS as the real role): admin A reads 0 rows of B and finds none of B's names by
search; admin B sees its 5 and none of A; a student of A sees only their own row; anon reads 0.

## Batch 2 — admin teachers list (`/admin/teachers`)

`supabase/tests/admin_teachers_list_check.sql`, 2 000 teachers + 2 000 students in institution A + 5 teachers
in B, rolled back (2 000 teachers is a large real institution; never extrapolate times). Same
`src/lib/data/people.ts` path as students (`listTeachers`), six named columns instead of nine.

| | before | after |
|---|---|---|
| Rows sent to the browser | 2 000 | 50 |
| JSON | 581 KB | **10 KB** |
| DB time | 23 ms | 9 ms (page + exact count) · last page 4 ms |
| Supabase calls per navigation | 1 | 1 (2 only for a page past the end) |
| Search | in the browser over all rows | database ILIKE, 18 ms ("Number 199", 11 matches) |

Isolation: admin A reads 0 rows of B and finds none of B's teachers by search; admin B sees its 5 and
none of A; a student in no group sees 0 teachers; anon 0; a teachers search never returns a student.
Fixed in the shared helper: a page past the end now counts with the SAME search (it counted the whole
role, so `/admin/students?q=Test Student&page=5` asked for a page that did not exist and failed).

## Batch 2 — centre students list (`/center/students`)

`supabase/tests/center_students_list_check.sql`, 20 000 students in institution A (every 3rd a centre
trainee, every 7th disabled, every 5th with an incomplete name) + 5 in B, read through RLS **as the centre
manager**, rolled back. `listCenterStudents` (same helper): one page with `name_complete` on the rows, exact
count, and an active count with the same search run beside the page. `loadNameCompleteFlags` (the second
whole read) is deleted — it had no other caller.

| | before | after |
|---|---|---|
| Rows sent to the browser | 20 000 | 50 |
| JSON | 4 225 KB list + 1 371 KB name flags | **11 KB** |
| DB time | 89–99 + 31–32 ms | 44 ms (page + exact count + active count) · last page 16–17 ms |
| Supabase reads of the student body per navigation | 2 whole reads | 1 page + 1 head count (parallel) |
| Search | in the browser over all rows | database ILIKE, 121 ms incl. both counts ("Number 1999") |
| Summary «N · M active» | counted in the browser | counts from the database, for the current search |

Accuracy: active count 17 143 and 4 000 incomplete-name flags equal the generator exactly; the search
never returns the teacher. Isolation: manager A reads 0 rows of B and finds none of B's names by search,
reads 0 four-part names (`student_names`); manager B sees its 5 and none of A; a student sees only
themselves; anon 0. `/center/teachers` shares `PeopleClient` and is unchanged: it passes no `pagination`,
so it keeps the whole-list local search (its own batch comes later).

## Batch 2 — centre teachers list (`/center/teachers`)

`supabase/tests/center_teachers_list_check.sql`: 2 000 teachers (every 7th disabled) owning ~3 000 groups
(every 10th archived), 666 centre courses and 333 course-linked groups, + institution B, read **as the
centre manager**, rolled back. `listCenterTeachers`: one page + exact count + active count (parallel), then
the groups and courses of **that page's teachers only** (`.in('teacher_id', ids)`, one call per table). The
lock rule (`account-scope.ts` `teacherBlock`) is unchanged.

| | before | after |
|---|---|---|
| Rows read | 2 000 teachers + every live group + every live course | 50 teachers + their own groups/courses |
| JSON | 361 KB + 223 KB groups + 37 KB courses | **8 KB** + 5 KB + <1 KB |
| DB time | 164 ms | 20 ms (page + counts + footprints) · last page 10 ms |
| Round trips | 1 wave of 3 whole reads | 2 waves: page ‖ active count, then groups ‖ courses |

**L1 — lock equivalence:** the lock computed page by page equals the lock from the whole institution for
all 2 000 teachers (200 centre-only, 1 400 shared, 400 unassigned). Isolation: manager A reads 0 users
and 0 groups of B; manager B sees its 5 teachers and nothing of A; a student in no group lists no teacher;
anon 0. `PeopleClient` is now paginated for both centre lists — the browser-side whole-list mode is gone.
Ratchet: `center/teachers/page.tsx` 3 → 0, `lib/data/people.ts` 1 → 3 — net −1, approved by the owner
2026-10-01. The two added reads (groups, courses) are restricted to the current page's teachers (at most
50) and are used only on the server to decide each teacher's lock state; they are never sent to the
browser. They are **not hard-row-limited**: they return every live group/course those teachers own (a
`.limit()` could cut a teacher's rows and flip the lock). An aggregate RPC is the later option; not in
Batch 2.

## Batch 2 — selectors, T1: `/teacher/groups` «إدارة الطلاب» student selector

Inventory + baseline of every selector: `supabase/tests/pickers_baseline_check.sql` (T1 2 185 KB, centre
groups/courses 1 639 KB, super-admin reports 4 346 KB, schedules/group selectors ~66 KB at 1 000 groups).
T1 check: `supabase/tests/teacher_student_search_check.sql` (20 000 students A + 5 000 B, rolled back, as
the teacher). The page no longer reads any student; the modal asks `GET /api/students/search?q=&group_id=`
(teacher only, own group, own institution; empty `q` → 400) → `searchStudents()` in `src/lib/data/people.ts`:
active students, sanitized name/email ILIKE, members excluded by a PostgREST anti-join (no member list is
read or sent), `.limit(20)`, three fields.

| | before | after |
|---|---|---|
| Student rows sent with the page | 17 778 (every active student) | **0** |
| Payload | 1 977 KB JSON on every visit | 0 on the page · ≤ 2 KB per search (20 rows) |
| DB time | 105 ms on every visit | 0 on the page · 58–62 ms per search (no trigram index; add one only if measured need) |
| Rows the browser renders | 17 778 → 142 225 DOM nodes, **1 691 ms** (median of 3) | ≤ 20 → 161 DOM nodes, **2 ms** |
| Requests while typing | 0 (all filtering in the browser) | 1 per 300 ms pause (component test: typing `s→sa→sar→sara` = 1 request) |

Render cost is raw DOM (same markup, real Chromium in the browser pane, desktop) — React's own work comes
on top, and a phone is slower. Checks: members excluded (27/27 never offered), disabled students and staff
never offered, teacher A finds none of B's students nor sees B's memberships, teacher sees their own group's
membership (so the exclusion really applies), a student running the same query sees only their own row,
anon 0; the teacher's read scope is unchanged (17 778 = the same set the page used to send). Live (local
server, existing data): anonymous → 307 /login; centre manager → 403 for search, empty `q` and injection.
Not browser-tested end to end: production has no teacher account or group, and none is added just for a
browser test (owner's decision, 2026-10-01) — route/component tests, the SQL check and the isolation checks
cover the behaviour. **Deferred, by the owner's decision:** a trigram index on `users.full_name`/`email` and
rate limiting on `/api/students/search` — added only if a measurement shows the need.

## Batch 2 — selectors, C-T: teacher selector of `/center/groups` (C1) and `/center/courses` (C2)

Inventory/baseline: `supabase/tests/center_rosters_baseline_check.sql`. C-T check:
`supabase/tests/center_teacher_picker_check.sql` (20 000 students, 500 teachers — 445 active — 1 000 groups,
200 courses, rolled back, read as the centre manager). Owner's choice (b): the teachers are searched on demand.
The pages no longer read the teaching staff: each row's teacher comes through the FK embed
(`teacher:users!…_teacher_id_fkey(full_name, role, is_active)`, shown as the name of an ACTIVE teacher, else
«—» exactly as before — `activeTeacherName()`), «is there an active teacher» is a head-only count, and one
«تغيير» per row opens ONE picker → `GET /api/teachers/search?for=groups|courses&q=` → `searchTeachers()`
(active teachers, NAME only — no email, as the pages never sent one — `.limit(20)`, id + name). The route
mirrors the save's gate: `for=groups` ⇒ `manage_groups`, `for=courses` ⇒ `manage_courses`, staff only
(`getCaller` + `staffCan`); the institution comes from the caller's profile.

| | before | after |
|---|---|---|
| Teacher rows read per page load | 445 (every active teacher) | **0** (head count, 3 ms vs 23 ms) |
| Teacher data reaching the browser | 38 KB per page | C1 46 KB (a name on each of 1 000 rows, **+7 KB net**) · C2 9 KB (**−29 KB**) |
| DOM per row (real components, exact) | C1 476 · C2 473 nodes | C1 33 · C2 30 nodes |
| DOM at 1 000 groups / 200 courses | C1 476 019 · C2 94 619 nodes | C1 33 019 · C2 6 019 nodes (−93 % / −94 %) |
| Render, Chromium, real row markup | C2 200 rows **6 001 ms** (median of 3) · C1 250 rows 4 269 ms, 500 rows 7 379 ms, 1 000 rows over the measuring tool's limit (twice) | C2 **159 ms** · C1 1 000 rows **870 ms** (the groups table itself — outside C-T) |
| DB time, whole page | C1 1 091 ms · C2 80 ms | C1 1 098 ms · C2 78 ms (C1 is dominated by the group-member count, see below) |
| Teacher search | — | ≤ 20 rows, 1 KB, 4 ms; one request per 300 ms pause (component test) |

DOM node counts come from rendering the old (git HEAD) and new React components (exact, linear in rows);
render times from inserting those exact rows in the browser pane (desktop Chromium; React's own work comes
on top, a phone is slower). Checks: students named like teachers, disabled teachers and the other institution's
teachers are never offered; a student in no group lists no teacher; anon 0; 110 groups whose teacher is
disabled are still listed and show «—». Fact: RLS lets a centre manager WITHOUT the capability read every
teacher (500) — the route, not RLS, enforces the capability, exactly like the pages and the saves. Live
(local server, existing data): both pages render, show «add an active teacher first» with the create button
disabled (0 teachers), and contain no `<select>`/`<option>`; the search answers 200 with `[]`, 400 for an
empty query / missing or unknown screen; injection probes against the database return 0 without error.
Final checks (2026-10-01, on mains power): tsc and lint clean, build OK, full suite **837/837** twice idle and
once during a concurrent build; 31 new C-T tests (route 11, data 7, picker + both screens 12, pages 8 — 93
with the related suites). The centre manager's production permissions, found re-granted 12/12 during the
test, were restored to `{}` and verified; no production data was added.

## Batch 2 — selectors, C-S: student selector inside `RosterModal` (`/center/groups`, `/center/courses`)

Check: `supabase/tests/center_student_picker_check.sql` (20 000 students, a group of 300 and a course of 3 000
members, institution B, read as the centre manager, rolled back). The pages no longer read or send the student
body; `RosterModal` asks `GET /api/roster/candidates?group_id=…|course_id=…&q=…` → `searchStudents(…, {group}
| {course}, { nameOnly: true })`: active students by NAME (no email — the pages never sent one), the target's
members left out by a PostgREST anti-join (no id list, no URL growth), `.limit(20)`, id + name. Owner's
decision (a): who may search = who may add — the route mirrors step for step `/api/group-students`
`resolveGroupOwnership` and `/api/course-enrollments` `authorize` (incl. a group's/course's own teacher). T1's
call (`searchStudents(db, t, q, groupId)`) and route are unchanged.

| | before | after |
|---|---|---|
| Students read with each page (C1 and C2) | 17 778 (78 ms) | **0** |
| `students` prop reaching the browser | **1 573 KB** on every load, modal opened or not | **0** |
| One search | — (filtered 17 778 names in the browser, 5–31 ms per key) | ≤ 20 rows, ~1 KB, 54–55 ms, one request per 300 ms pause |
| RosterModal DOM (real components, exact) | 224 nodes / 201 options, open or typed | 24 nodes / 1 option until typed · 44 / 21 with 20 results |
| Reach | first 200 alphabetically; the rest only by typing | any student by typing |

Checks: each target leaves out ITS members only (a course's 3 000 members are offered for a group they are not
in); disabled students and staff never offered; manager A sees none of B's students, memberships or enrolments;
a student lists no other student; anon 0. Parity: 17 role/target scenarios give the same status from the new
route and from the membership routes' gate (unit), and live on the local server (centre manager `{}`): group
403 = 403, course 404 = 404; malformed target / both targets / empty query → 400; anonymous → 307 /login.

**Verified end to end (2026-10-01, later the same day)** on the local build against the production database,
with test accounts and data the OWNER created (1 teacher, 1 group of 16, 2 courses, 1 lesson) and signed in
himself — the assistant created and changed nothing and never pressed «إضافة»:
- centre manager (capabilities on): both pages carry no student name/email; RosterModal opens with the members
  and «type to search» and sends no search; typing sends one request for the right target; a broad search
  returns exactly 20, `id, full_name` only, none of them members; «Test Student» in the group returns 0 — all 12
  are members (checked in the DB); «محمد محمود» is excluded in the group (member) and offered in the course.
- parity, live: group 200=200, both courses 200=200, unknown group/course 404=404 (centre manager AND teacher);
  student 403=403 on the group and both courses; malformed target / both / bad uuid / injected id / empty or
  wildcard query → 400; injection in `q` → 200 with 0 rows.
- teacher (owns the group and both courses): 200 on own targets, T1 `/api/students/search` 200 with email (as
  designed), `/api/teachers/search` 403, `/center/*` redirected to `/teacher/dashboard`.
- student: every candidates/membership/search call 403 with no student data; `/center/*` redirected.
- DB unchanged afterwards (16 memberships, 0 enrolments); server log clean.
Still not verified live: adding a found student (would write real data) and isolation between two institutions
(production has one; covered by the rolled-back SQL checks). Network note: on this laptop every call to the hosted
Supabase took 1–2 s (even `/api/session/check` ≈ 1.4 s); the new route and the existing membership route have the
same 4 sequential round trips and the same latency — environmental, not the query (≈ 55 ms in the DB).

**Earlier in the day (before the owner's data existed) it was not verified end to end:** opening RosterModal in
the browser on real groups/courses, adding a found student, authorized 200 responses with real rows, and a
teacher using the route on their own course.
Production has no teacher, group or course; the owner forbade adding test teachers/groups to production; there
is no isolated environment (no Docker for a local Supabase stack; the project has only its production branch —
a preview branch costs $0.01344/h and needs the owner's approval); and signing test accounts in on a hosted
Supabase is not something the assistant may do. Covered instead by the component tests (both modes, add path,
stale answers), the route tests with the real gate code, the parity tests and the rolled-back SQL checks on the
real database and RLS.

**Separate finding — pre-existing, not Batch 2:** `tests/security-auth.spec.ts` «Login page» (3 tests) expects
`input[type="email"]` and a Google button, but since 2026-09-29 (`f9972fc`) the field is `type="text"` (email or
member ID) and Google sign-in is hidden unless `NEXT_PUBLIC_GOOGLE_SIGNIN=on`. The rest of the suite (12) passes
against the local build; 2 role-isolation tests skip without E2E credentials. `tests/tenant-isolation.spec.ts`
was not run: it creates real tenants and accounts in production.

**Separate finding — outside C-T, not fixed (owner's decision 2026-10-01):** the `/center/groups` list reads
`groups(*, group_students(count))`; under RLS that count costs **≈ 1 011 ms** at 1 000 groups / 19 281
memberships (12 ms without RLS, 51 ms without the count) — the RLS policies (`group_students_select` →
`groups_select`, whose `current_user_role()` / `current_tenant_id()` calls are not wrapped in `(SELECT …)`)
are evaluated per membership row. A fix needs a migration and is a separate decision.

**Not a platform fix:** `maxWorkers: 4` in `vitest.config.ts` (shipped in the same batch) only changes how
the *test suite* runs on the 8 GB dev machine — memory pressure from ~11 parallel jsdom workers made render
tests cross the 5 s timeout. It has no effect on the app, its bundles, or any number in this file.

## Batch 2 — C-M: member list inside `RosterModal` (`/center/groups`, `/center/courses`)

Check: `supabase/tests/roster_members_page_check.sql` (a course of 3 000 enrolments, a group of 300 and one of 19,
read as the owner — the membership routes read with the service-role client after their own gate; rolled back).
`RosterModal` now asks `GET /api/group-students|/api/course-enrollments?…&page=N` → `readRosterPage()`
(`src/lib/data/rosters.ts`): 50 members ordered newest first (`joined_at` / `enrolled_at` DESC, `student_id` as
tie-break), `count: 'exact'`, a page past the end answered with the last page. `?page=` is **opt-in**: without
it both routes run the same query and return the same body as before, so `/teacher/groups` (T1, which reads the
whole roster of a teacher's own group) is unchanged. Authorization runs first on both paths; POST/DELETE untouched.
After an add/remove the modal re-reads the current page and reports the server's total to the page (`onChanged`).

| | before | after |
|---|---|---|
| Course of 3 000 — one open of the modal | 3 000 rows, **712 KB**, 23 ms | 50 rows, **9 KB**, total 3 000, 10 ms (last page 1 ms) |
| Group of 300 | 300 rows, 56 KB, 3 ms | 50 rows, 9 KB, 2 ms |
| Member list DOM, 3 000 members (real components, jsdom) | **30 023 nodes** | **527 nodes** |
| Render (earlier browser harness) | 3 000 rows ≈ 351 ms | 50 rows ≈ 9 ms |
| Count shown | length of the loaded list | the server's exact total |

Checks: the 60 pages cover the 3 000 enrolments exactly once (stable order); a 19-member group fits on one page
(no controls); nothing left behind; the owner's data unchanged (16 memberships, 0 enrolments, centre manager `{}`).
Unit: route parity without `page` (same query — no range, no count — same body), the paged body, 403 before any
roster read for a centre manager without the capability; component: 120 members → 50 rows + «1 / 3», next/prev,
removing the only member of the last page lands on the new last page and reports 50, a member is never offered.
Live on the local build (student session): paged and unpaged reads of the owner's group and course both 403, no
student data — parity.

**Verified live as the teacher (2026-10-01, mains power, production build on localhost:3000; the owner signed
in himself; GET only — nothing added, removed or changed):** the owner's group (16 members): `page=1` → 200,
`{students, total: 16, page: 1, pageCount: 1}`, rows `id, full_name, email` only, 2 058 B; `page=2`, `page=999` →
the last page (page 1, same 16); `page=abc`, `page=-3` → page 1. The order equals the database's `joined_at DESC,
student_id` exactly (16/16). Without `page` the body is `{students}` (2 024 B) with the same 16 ids — T1 unchanged;
opening «Manage Students» on `/teacher/groups` sent `GET /api/group-students?group_id=…` with NO `page`, 200,
«Enrolled (16)». Both courses (0 enrolments): paged 200 `{total: 0, page: 1, pageCount: 1}` (`page=5` → page 1),
unpaged 200 `{students: []}`. Unknown group / course → 404 = 404 paged and unpaged. Database fingerprint
(users 125, memberships 16, enrolments 0, md5 of memberships and users, centre manager `{}`) identical before
and after; server log clean. Full suite 913/913 ×2 and the production build passed on mains power.
Not shown live: several real pages — the owner's data has at most 16 members and no test data may be added;
multi-page behaviour is proven by the 3 000-row SQL check and the component tests.

Note: `/api/course-enrollments`'s unpaged read now has no caller in `src/` (RosterModal was its only client); it
is kept unchanged on purpose (scope) and stays in the `UNBOUNDED_READS` ratchet — removing it is a later decision.

**Follow-ups recorded after the final C-S/C-M review (owner: not blockers, do not fix now, 2026-10-01):**
1. When the server answers a past-end page with the last page (e.g. the only member of the last page removed),
   RosterModal sets the corrected page and fetches that same page once more — one redundant request.
2. After a student is picked and the search text is then refined, the pick stays set and «Add» stays enabled
   although that student is no longer listed (the student is still a valid candidate). Pre-existing behaviour,
   unchanged by C-S/C-M.

## Batch 2 — R1: entity picker of `/super-admin/reports`

Check: `supabase/tests/report_picker_check.sql` (institution A: 20 000 students, 500 teachers, 1 000 groups, one
archived; institution B: 5 000 students, 100 teachers, 10 groups; read through RLS as the owner; rolled back).
The page now reads only the institutions; a teacher / student / group is found on demand inside ONE chosen
institution: `GET /api/admin/report-targets?kind=teacher|student|group&tenant_id=…&q=…` →
`searchReportTargets()` (`src/lib/data/report-targets.ts`). Owner only — role read from the database with the
caller's session, as the page does; runs on that session (RLS), never the service role; `.limit(20)`; people
by name OR email → `{id, label, email}`, groups by name → `{id, label}`. Same set as the old lists (teachers and
students of any status; archived groups hidden by RLS). `/api/reports` and report generation are unchanged; the
whole-institution report still picks from the institution list. Picking is cleared whenever the institution or
the search text changes (no stale row, nothing from another institution).

| | before | after |
|---|---|---|
| Read on every page load (synthetic platform) | teachers 601 (105 KB) + groups 1 010 (117 KB) + students 25 121 (4 370 KB) + institutions → **4 593 KB**, 164 ms | institutions only (3 rows, < 1 KB) |
| Props reaching the browser (real component input) | **2 786 KB** | 79 B |
| One search | — (all rows already in the page) | ≤ 20 rows: students 2.5 KB / 43 ms, teachers 1.3 KB / 4 ms, groups 1.4 KB / 18 ms |
| Picker DOM, «Student» chosen (real component, exact) | **25 159 nodes** | 49 before typing · 69 with 20 results |

The jsdom render time of the old 25 121-option list (129 s, on battery) is not representative and is not
counted; the node count is exact. Checks (SQL): a disabled student is still found (P1, as the old list), an
institution-B search returns only B rows (P2), the archived group is not offered (P3), a B name never matches
inside A (P4), an institution admin reads 0 rows of B (P5); nothing left behind. Unit: route 401 / 403 for every
non-owner role before any search / 400 for bad kind, missing / malformed / injected institution, empty or
wildcard-only query / 200 `{results}` ≤ 20 with `id, label, email` only, session client only, no write; the page
reads only `tenants` and redirects a non-owner before reading; component: no request until institution AND
text, one request per pause, labels «name — email», kind per scope (pilot → group), stale answers ignored,
pick cleared on institution / text change, `/api/reports` URL unchanged. A mutation check (owner gate removed)
fails 4 tests. Ratchet: `super-admin/reports/page.tsx` unbounded reads 4 → 1.
**Verified live (2026-10-01, mains power, production build on localhost; the owner signed in himself; GET only)**
against the two real institutions (A: 1 teacher, 121 students, 1 group; B: 1 teacher, 1 student, 0 groups):
both institutions listed; A teacher / student (by name and by email) / group and B teacher / student each found
alone; «معلم» in A does not return B's «معلم في جامعة الازهر»; 6 cross-institution searches (B's people in A, A's
student / teacher / group in B, a teacher under kind=student) → 0; broad searches in A → exactly 20; fields
`id, label, email` (groups `id, label`); bad kind / missing, malformed or injected institution / empty or
wildcard query → 400; unknown institution and an injection in `q` → 200 with 0. UI: one request per typed word;
switching institution clears results, pick and report (same text in B → «No match»); refining the text clears
the pick (View disabled). «View report» → `GET /api/reports?scope=student&id=…&format=json&lang=ar` 200 (same URL;
report generation has no write). A teacher session: page redirected, route 403 for all kinds. Database
fingerprint (users md5, 128 users, 16 memberships, 2 AI-log rows, 2 tenants, 1 group) identical before and
after. Full suite 943/943 and the production build passed on mains power. Server log: only two connect
timeouts to Supabase at start-up (network), no route error.

## Batch 2 — Centre Mail (`/center/mail`)

Check: `supabase/tests/center_mail_recipients_check.sql` (institution A: 20 000 students, 1 000 active groups +
1 disabled, ~19 000 memberships, a centre manager with `manage_students`; institution B: 2 000 students, 10
groups; page reads as the centre manager through RLS; rolled back). Owner's decision: students are found on
demand and «all students of a group» is sent as `group_id`, resolved on the server.
- Page: only the active groups with a member COUNT (`group_students(count)`) — no student, no member id.
- `GET /api/mail/recipients?q=` → `searchActiveStudents()` (`src/lib/data/people.ts`): ≤ 20 active students of the
  caller's institution by name or email, `id, name, email`, on the session (RLS).
- `POST /api/mail/recipients {recipient_ids, group_ids}` → `{count}` only — how many the selection reaches,
  resolved exactly as the send resolves it (shown in the line under the list and in the confirmation).
- `POST /api/mail/send` also accepts `group_ids`; `resolveMailRecipients()` (`src/lib/mail/recipients.ts`):
  each group must be an ACTIVE, live group of the caller's institution (else 404 `groupNotFound`), contributing
  its ACTIVE STUDENTS of that institution (what the old client kept), de-duplicated with the picks; ≤ 50 group
  ids; member rows bounded (2 501 — if reached, the set is > 50 anyway). Then every existing rule applies to the
  resolved set, unchanged: same gate (`getMailCaller`), ≤ 50 per request (a bigger group → 400
  `tooManyRecipients`, as before), 300/day, active student/teacher of the tenant with an address, one
  `mail_messages` row per attempt. The old body (`recipient_ids` only) works as before.

| | before | after |
|---|---|---|
| Read on every page load | 17 778 students (2 237 KB, 89 ms) + 1 000 groups with 19 061 member ids (1 168 KB, 1 959 ms) | 1 000 groups + count (78 KB, 990 ms — the known RLS count cost, see C1) |
| Props reaching the browser (real component input) | **1 765 KB** | 50 KB (group names + sizes) |
| One search | — (filtered 17 778 rows in the browser) | ≤ 20 rows, 2.6 KB, 42 ms |
| Mail component DOM (real component, exact) | **72 154 nodes** (17 778 checkboxes) | 1 043 nodes (1 000 of them the unchanged group menu) · 1 122 with 20 results |

Checks (SQL): manager A reads 0 students / groups of B (P1); a B student never matches in A (P2); group 1
resolves 72 active students of its 80 members — disabled left out (P3); a B group is not found in A (P4); a
disabled group is not usable (P5); nothing left behind. Unit (Gmail mocked — no email sent anywhere):
resolver query shape (tenant / active / live group, inner-joined active students of the tenant, bounded),
foreign / malformed / too many groups refused before members are read; search gate (401, 403 for teacher,
student, owner, centre manager without the capability), empty / wildcard query 400, ≤ 20 with id+name+email on
the session; preview returns a number only and sends / logs nothing; send: union de-duplicated and logged per
recipient, 51 → 400 with nothing sent or logged, exactly 50 allowed, daily cap on the resolved set, foreign
group 404, all-disabled group 400, no capability 403 before any read, old body unchanged; page reads only
`groups` with the count. Component: nothing listed until typed, one request per pause, picks kept with name +
email, group kept as id with the server's count, send body `{recipient_ids, group_ids}`, confirmation names the
server count, a refused group reported before any confirmation or send, remove / clear. Ratchet:
`center/mail/page.tsx` 2 → 1.

**Verified live (2026-10-01, mains power, production build on localhost; the owner signed in himself; reads and
count previews only — no mailbox is linked, nothing can be or was sent):** owner session → search 403 and
preview 403. As `admin@edu.qou` (institution A): «محمد» and «stu@edu» each find exactly the one A student,
fields `id, name, email`; B's student by name or email → 0; a broad search → exactly 20; empty / wildcard → 400;
an injection in `q` → 0. Preview: the real group → `{count: 16}` (= 16 active students of 16 members in the
database); group + one of its members → 16 (de-duplicated); unknown group → 404; malformed → 400. `/center/mail`
itself redirects an institution admin (existing role routing: the page is the centre manager's, whose
permissions are `{}` and were not changed), so the page payload is covered by the unit test, not live.
Database fingerprint (users md5 incl. email, 128 users, 16 memberships, 1 group, 2 tenants, `mail_messages` 0,
`mail_connections` 0, `rate_limits` 23) identical before and after; server log clean. Full suite 967/967 and the
production build passed on mains power.
Note: the preview counts picked ids as sent (like the old `selected.size`); the send itself still keeps only
active students/teachers of the tenant and reports the rest as `skipped`, unchanged.

## Batch 2 — Owner Counts (`/super-admin/users`)

Measured on a synthetic platform (25 603 users: A 20 000 students / 500 teachers / admin / centre manager, B
5 000 / 100, an owner; every 9th disabled), as the owner through RLS, fully rolled back — no function was
created on the live database:

| | before (page read) | after (`get_tenant_role_counts()`) |
|---|---|---|
| Rows / payload per page load | 25 729 rows of (tenant_id, role), **1 834 KB**, 51 ms | 4 rows, **383 B**, 23 ms (as the owner through RLS — the SECURITY INVOKER path chosen by the owner) |
| Correctness at scale | counted in the app from whatever PostgREST returns — wrong once a max-rows cap truncates it | counted in the database |

Checks (rolled back): the aggregate equals the page's own tally for every institution (P1); disabled students
are counted, as today (P2: 20 000 of 20 000); an institution admin reads 0 users of B through RLS (P3).
Code: `loadTenantRoleCounts()` (`src/lib/data/tenant-counts.ts`) reads only the function; any error → no counts and
no read of `users`. Unit: 8 tests. `supabase/tests/owner_counts_check.sql` (correct counts per institution, disabled
included, centre managers excluded, 42501 for admin / centre manager / teacher / student / signed out, anon
cannot EXECUTE and a direct anon call is refused, SECURITY INVOKER + pinned search_path, 4 result columns) — see
below. Ratchet: `super-admin/users/page.tsx` unbounded reads 3 → 2.

**Applied and verified live (2026-10-01, owner's approval):** green DB backup first (run 36898293441, verified
read-back); `owner_counts_migration.sql` applied exactly as reviewed (SECURITY INVOKER); `owner_counts_check.sql`
12/12 on the live DB (synthetic data rolled back, nothing left); DB fingerprint before / after identical (users,
policies, indexes, table grants, the 59 existing functions) apart from the one new function (anon false,
authenticated true); `/super-admin/users` as the owner shows 1/1/1 and 1/1/121 = the database tally, and the
edge log shows `rpc/get_tenant_role_counts` 200 with no users read. The pre-migration fallback was then removed
(any RPC error → no counts, never a users read).

## Batch 3 — P-01: teacher proctoring (`/teacher/proctoring`)

Check: `supabase/tests/teacher_proctoring_page_check.sql` (one teacher, 20 proctored exams × 40 questions, 200
students, 4 000 submissions with 30 info events each, every 4th with violations, every 7th with a paste signal;
a second teacher's exam for isolation; read as the teacher through RLS; rolled back, nothing left behind).
The page read EVERY proctored submission with the exam's `questions` embedded in each row (used only to add up
the maximum score). Now `loadProctoringPage()` (`src/lib/data/proctoring.ts`): one page of 20, newest first,
`max_score` from the row (written by `finalize_exam_submission` as the sum of the question points — the same
number), no questions; total and flagged are head counts in the database, flagged = at least one VIOLATION
event (one JSONB containment test per `VIOLATION_TYPES` entry — exactly the page's `eventKind` rule; verified
to parse in PostgREST). `?page=`, past-end → last page, Previous / Next (`ListPagination`). RLS unchanged.

| | before | after |
|---|---|---|
| Read per page load (4 000 submissions) | 4 000 rows, **66 861 KB**, 1 639 ms | 20 rows, **69 KB** + 2 counts, 266 ms |
| Totals shown | length of the full list | database counts (total 4 000, flagged 1 000) |

Checks (SQL): flagged by containment = flagged by the page's rule (1 000 = 1 000); `max_score` = the old sum
(80) for every row; teacher A reads none of teacher B's submissions. Unit (6): the filter covers exactly the
violation types (no signal / info), the read has no `questions` and has `max_score`, both counts and the page are
scoped to the teacher's proctored exams, ordering / range / clamping, the page shows the database totals and
Previous / Next. Ratchet: `teacher/proctoring/page.tsx` 3 → 2. Full suite 981/981 on mains power.
Behaviour note: an attempt still in progress has no `max_score` yet, so its line reads «0 / 1» instead of the old
«0 / <points>» (score is 0 either way).

**Separate finding — pre-existing, not fixed:** `exam_submissions.is_flagged` is never written (no code path, no
database function), yet `lib/reports.ts`, `lib/teacher-records.ts` and `get_center_dashboard` read it — their
«flagged» counts are therefore always 0. P-01 does not use it.

## Batch 3 — P-03: teacher lessons (`/teacher/lessons`)

Check: `supabase/tests/teacher_lessons_page_check.sql` (one teacher, 300 lessons of 5–20 KB, a second teacher
for isolation; read as the teacher through RLS; rolled back). The page read every lesson with every column
(`select('*')`, bodies included) and sent it all to the browser, which showed only a 150-character excerpt and
used the body only when «Edit» was opened. Now `loadTeacherLessons()` (`src/lib/data/teacher-lessons.ts`): one
page of 50 (named columns, exact count, past-end → last page), the excerpt is computed on the server with the
same rule (`lessonExcerpt`: markdown marks removed, 150 chars) and the browser gets only the excerpt; «Edit»
reads that one lesson's `content` through the teacher's own session (RLS) — no new route, no service role.

| | before | after |
|---|---|---|
| Sent to the browser per page load (300 lessons) | **3 913 KB** (every body) | **16 KB** (50 excerpts) |
| Read by the server | 3 913 KB, 42 ms | 631 KB (one page of 50 incl. bodies) |
| «Edit» | (body already on the page) | one lesson body on demand (≈ 6 KB here) |

Checks: teacher A reads none of teacher B's lessons. Unit (6): excerpt identical to the old rule; the read is
one page with named columns and an exact count, rows carry only the excerpt; past-end → last page; the client
shows the excerpt and the database total, Previous / Next only with > 1 page, «Edit» reads that lesson's
content and fills the editor, a failed read does not open it. Two existing tests updated to the new props
(`i18n-teacher-separation`, `mutations-extended`). Ratchet: `teacher/lessons/page.tsx` star 1 → 0, unbounded 2 → 1.

## Batch 3 — P-05: student lessons (`/student/lessons`)

Check: `supabase/tests/student_lessons_page_check.sql` (a student in 3 active groups + 1 disabled, 300 published
lessons of 5–20 KB, 20 drafts, 10 lessons in the disabled group, 10 in a group the student is not in; read as
the student through RLS; rolled back). The page read every published lesson with every column and rendered
EVERY body through `LessonTabs` inside collapsed `<details>`. Now `loadStudentLessons()`
(`src/lib/data/student-lessons.ts`): one page of 50 titles (no body; exact count; past-end → last page; same
published + active-group filters), and `components/student/lesson-details.tsx` reads one lesson's body the first
time it is opened — the student's own session (RLS) plus the same active-group filter; a failed read shows a
message and is retried on the next opening. Homework per lesson is unchanged.

| | before | after |
|---|---|---|
| Read per page load (300 lessons) | 300 rows, **3 920 KB**, 36 ms | 50 rows, **10 KB**, 8 ms |
| Rendered markup (real `LessonTabs`, jsdom) | **107 733 nodes** (every body, 3.6 s in jsdom) | titles only; ≈ 172 nodes per opened lesson |
| Opening a lesson | (already on the page) | one body on demand (≈ 8 KB here) |

Checks (SQL): a group the student is not in → 0 lessons; unpublished → 0; a disabled group's lessons excluded
by the active-group filter (list and open). Unit (4): the read has no `content`, keeps the published + active-
group + own-groups filters, pages / clamps; nothing is read until a lesson is opened, then that lesson once with
the active-group filter; a refused read shows `loadFailed` and is retried. Messages `loading` / `loadFailed`
(en + ar). Ratchet: `student/lessons/page.tsx` star 1 → 0, unbounded 3 → 2.
Behaviour notes: the lesson count in the header is the database total; the «N subjects» line counts the
subjects on the current page (identical whenever everything fits on one page).
Full suite after P-01 + P-03 + P-05: 991/991 on mains power.

## Batch 3 — P-02 + P-04: admin content feeds and teacher exams

`supabase/content_feeds_migration.sql` (four new functions, nothing else changed) + code. Verified ONLY as a
dry run on the live database: the migration's twelve statements executed inside one `DO` block together with
`supabase/tests/content_feeds_check.sql`, which ends in `RAISE EXCEPTION` — functions and synthetic data rolled
back together; afterwards 0 new functions, 0 leftovers, 60 public functions as before. Synthetic institution A:
2 000 lessons (1 400 published), 2 000 exams (1 500 timed + 500 homework, 50 of them homework only by the
duration rule), 40 questions each, 4 000 submissions; teacher T with 100 of the exams; institution B for isolation.

| Screen | before | after |
|---|---|---|
| Admin dashboard (counts + 5 newest lessons) | `get_admin_lessons` + `get_admin_exams` = **876 KB**, 33 ms | counts + 5 lessons = **988 B**, 10 ms |
| `/admin/exams` | 2 000 rows, **519 KB**, 17 ms | 50 exams + 50 homework, **26 KB**, 6 ms |
| `/admin/lessons` | every lesson (part of the 876 KB above) | 50 per page + counted summary |
| `/teacher/exams` (100 exams × 40 questions) | 100 rows with every question, **1 377 KB**, 24 ms | 100 rows + `question_count`, **27 KB**, 15 ms |

Checks (dry run, 21/21 PASS): counts equal the old feeds + the page's `isHomework` rule (2000 / 1400 / 1500 / 500
/ 4000); lessons page 1 = the first 50 of the old feed; 30 exam pages cover the 1 500 exams exactly once;
homework includes duration-rule homework; limit clamped 1..100, offset ≥ 0; admin A sees nothing of B; admin B
counts only B; centre manager / teacher / student get 0 rows from all four admin calls; `question_count` = number
of questions; a student still reads 0 exam rows (no new read path); anon no EXECUTE / authenticated EXECUTE on
all four; `search_path` pinned on all four; the three admin feeds DEFINER, `question_count` INVOKER.
Code: dashboard / `/admin/lessons` / `/admin/exams` read `loadAdminContentCounts` + `loadAdminLessonsPage` /
`loadAdminExamsPage` (`src/lib/data/admin-content.ts`; `?page=` and `?hwpage=` — `ListPagination` gained an
optional `param`); `/teacher/exams` selects `TEACHER_EXAM_COLUMNS` (named columns + `question_count`), the
questions viewer reads that exam's `questions` on demand through the teacher's session. Unit: 11 tests
(`content-feeds.test.tsx`). Ratchet: heavy-feed calls 4 → **0** (the map is now empty), `teacher/exams/page.tsx`
star 2 → 0. Full suite 1 001/1 001 on mains power.
Deploy order: apply the migration BEFORE the code (additive; `get_admin_lessons` / `get_admin_exams` are left
untouched for the code currently in production).

**Applied 2026-10-01 (owner's approval):** green DB backup first (run 36913850532, read back and verified); the
migration applied exactly as the file (text stored by Supabase: md5 `9879d50f…`, 6 871 bytes = the file with LF
line endings); live re-check `content_feeds_check.sql` 16/16 (counts, pages, homework rule, clamps, isolation
both ways, centre manager / teacher / student 0 rows, `question_count`, no new read path, grants, no EXECUTE to
PUBLIC, search_path, DEFINER / INVOKER) with synthetic data rolled back and nothing left behind; anon REST → 401 on
all four; fingerprint: the 60 existing functions, policies, indexes, table grants and the data identical before
and after — only the four new functions added (60 → 64). Code not deployed yet.

## Separate open point — browser HTTP 400 during account switching (not part of Batch 2)

Status: **open, deliberately not investigated now** (owner's decision, 2026-10-01).
During the local browser tests of `/center/students` and `/center/teachers` the console showed
`Failed to load resource: 400` lines (3, then 5 more). Every occurrence fell in a window where the owner was
signing out / in to switch between the admin and centre-manager accounts (two `/auth/signout` calls in the
second window). None came from the list pages: those pages had no 4xx/5xx resource, every `/api/*` call
returned 200, and the server log had no errors. The failing URLs had left the browser's request buffer, so
the source is not known (most likely Supabase Auth answering a wrong password or a stale refresh token).
Re-check only if it appears outside account switching.
