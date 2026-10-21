# Architecture details (moved from CLAUDE.md)

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
- **Live video is on demand and silent** (2026-09-27). Every student in a proctored exam joins a PRIVATE Supabase Realtime channel `exam-live:<exam>` (`src/lib/live-channel.ts`, `src/hooks/use-exam-live-channel.ts`): presence = who is in the exam + violation/snapshot counts, broadcast (teacher only) = the set of students to watch. No table is read for any of it. LiveKit video is OFF until the teacher presses «تشغيل البث المباشر» on `/teacher/proctoring/live/[examId]` and picks students (≤ `MAX_WATCHED` = 9); only those stream, only while the page is open. `/api/proctor/live-token` issues a student token only while the exam's teacher is in the LiveKit room with that student in its `watching` attribute (checked with `RoomServiceClient`, so a student cannot start or prolong streaming); the student leaves when LiveKit reports the teacher gone or no longer watching. The student publishes the exam page's own capture (never a second `getUserMedia`; `stopLocalTrackOnUnpublish: false`). Nothing on the student's screen shows whether they are watched; the consent text says they may be at any time. Channel access = RLS on `realtime.messages` via `exam_live_role()` (`supabase/live_proctoring_channel_migration.sql`).
- **Proctoring v2 (2026-09-27; merged and deployed 2026-09-29, PR #19).** Every event type is classified once in `src/lib/proctoring-events.ts` — *violation* (flags), *signal* (pasted text, bulk insert) or *info* (detector unavailable, monitoring gap/coverage, environment, clip requested, room scan, second camera); only violations flag an attempt (`isViolation`), everywhere. Cheap integrity first: per-student question/option order (`src/lib/exam-shuffle.ts`, display only — answers are keyed by question id and option text), paste/bulk-insert signals in written answers, answer-similarity hints after the exam (`src/lib/answer-similarity.ts`, returned by `/api/exams/results`). Monitoring trust: coverage % written at submit (`use-monitoring-coverage.ts`), 30 s stalls as `monitoring_gap`, VM/second-screen/webdriver hints (`src/lib/device-environment.ts`). On-device detection: speech (voice band + syllable rhythm, `src/lib/speech-detector.ts`, no download — Silero VAD rejected: ~14 MB runtime), identity continuity + photo spoof with `@vladmandic/human` (MIT; `use-face-identity.ts`, capable devices only, models self-hosted by `scripts/copy-human-models.mjs` → `public/models/human`, git-ignored). Evidence clips: 10 s segments of the exam's own stream in memory (`use-clip-recorder.ts`), uploaded only for a severe violation, the teacher's «آخر 30 ثانية» (broadcast `clip`), or the 10 s room scan at the start → `/api/proctor/evidence/clip` (WebM/MP4 sniffed, ≤900 KB, 6 per attempt, same 30 h store). Phone as a second camera via a signed QR link (`src/lib/second-camera-token.ts`, `/cam/[token]` public, `/api/proctor/second-camera[/event]`) — the only answer to windows hidden from screen capture. Thumbnail wall and Safe Exam Browser use `live_thumbnails_migration.sql` / `seb_config_key_migration.sql` (both applied). **Don't** build browser screen recording (windows can be excluded from capture) and **don't** add WebGazer (GPL-3).
- Proctoring runs **entirely on the student's device**: MediaPipe (face/gaze, `use-face-detection.ts`) and TensorFlow.js COCO-SSD (phone/book/extra person, `use-object-detection.ts`), plus audio/tab/fullscreen listeners. No camera frame is sent anywhere for analysis. `use-proctor-recorder.ts` batches + dedupes detections to `POST /api/proctor/events` (→ `append_proctoring_events`); `use-evidence-capture.ts` sends a capped number of snapshots for severe violations only — **never stored in Supabase** (owner's rule, 2026-09-26): a 320×240 WebP (~8–20 KB, ≤10 per student per exam) goes to an external store (`src/lib/evidence-store.ts`). **Current backend: Cloudflare Workers KV** (`EVIDENCE_KV_ACCOUNT_ID/_NAMESPACE_ID/_API_TOKEN`, namespace `eduquest-evidence`, token scoped to Workers KV Storage: Edit) — each value is written with an absolute 30-hour `expiration`, so Cloudflare deletes it itself; KV is never listed (free-plan caps), the attempt's `proctoring_events` lines (`evidence_key`) are the index, and images reach the teacher through `GET /api/proctor/evidence/image` (teacher-of-exam + not-expired check). Alternative backend: any S3/R2 bucket (`EVIDENCE_S3_*`, 10-minute SigV4 links, hourly `.github/workflows/evidence-cleanup.yml` → `POST /api/proctor/evidence/cleanup` with `CRON_SECRET`, no-op on KV). Neither configured = capture off, never a Supabase fallback. Only the exam's own teacher sees snapshots (panel beside the live wall, `GET /api/proctor/evidence`), for exactly 30 hours (`src/lib/evidence-keys.ts`). The old Supabase `proctoring-evidence` bucket is unused (empty). A detector that fails to load records a `detector_unavailable` event (not a violation). The former Gemini frame layer (`/api/proctor/analyze`, `use-server-proctoring.ts`, `NEXT_PUBLIC_SERVER_PROCTORING`) was removed 2026-09-13 — don't reintroduce server-side frame analysis (free-tier Gemini capped real concurrency at single digits and failed silently).

### i18n (Arabic / English)
next-intl as a message layer only — no `[locale]` segment, no next-intl middleware. Messages: `src/messages/{en,ar}/<namespace>.json` (`en` is the key baseline; `src/__tests__/i18n-messages.test.ts` enforces identical key sets). Namespaces are declared in `src/i18n/config.ts`; server-only ones (`email`, `errors`, `reports`) can never reach a client provider. Each route-group layout mounts `ScopedIntlProvider` with only the namespaces it needs.
- **Locale resolution:** explicit (emails/reports, passed as `getTranslations({ locale })`) → `/<locale>/` marketing URL (header set by the proxy) → `eq_locale` cookie → platform `DEFAULT_LOCALE` (`'en'`). The cookie is filled once per session by `src/proxy.ts` from `users.locale` → `tenants.default_locale` (DB default `'ar'`); the in-app switcher also saves `users.locale`.
- **Marketing URLs:** `/ar/…` and `/en/…` for `/`, `/features`, `/pricing`, `/contact`, `/privacy`, `/terms` (`src/i18n/public-routes.ts`); the proxy rewrites them to the existing routes. Canonical + hreflang via `marketingMetadata()`, plus `src/app/sitemap.ts`. Switching language there is a full page load (the language lives in the root layout).
- **Ratchet:** `src/__tests__/i18n-no-hardcoded-strings.test.ts` + `i18n-migration-state.ts` — no Arabic or English UI literals inside `MIGRATED_DIRS` (every route group and every `components/` folder), and `formatDate`/`getTerms`/`getRoleLabel` must receive the locale there. `UNMIGRATED_FILES` is empty and must stay empty.
- **Per-language content that is not UI** lives in `src/content/<area>/{ar,en}.ts`, one language per file, both typed against a shared `types.ts`: `ai/` (prompts, stop words; `ai/lesson-from-file.ts` is the one multilingual prompt), `demo/` (text of the /demo fixtures — ids/numbers stay in `lib/demo/data.ts`), `pricing/` (plan wording — prices stay in `lib/pricing/plans.ts`), `terminology/` (institution vocabulary + role names).
- **Plurals:** a message that counts a noun uses ICU plural. Arabic has five forms (one, two, few 3–10, many 11–99 with tanween, other 0/100+), and Arabic branches print the number as `{var}`, never `#` (whose digits depend on the runtime's `ar` number formatter). `i18n-messages.test.ts` formats every plural for 0/1/2/3/11/100 in both languages and rejects Arabic-Indic digits.
- **Block lessons (2026-10-09, no migration):** `lessons.content` holds either legacy Markdown or block JSON
  `{"eqLesson":2,"sections":[…]}` (`src/lib/lesson-doc.ts`: text, image, video, link, callout, mindmap, steps,
  flashcards, quiz). Markdown — old lessons and every AI draft — is converted on read (`markdownToLessonDoc`; the
  prompts emit ```mindmap / ```steps fences and `> **Tip:**` boxes for it). Teachers edit in
  `components/lesson/lesson-builder.tsx`, students see `components/lesson/lesson-view.tsx` (learning path, lesson
  map, progress in localStorage). `PATCH/POST /api/lessons` re-sanitise the JSON; image blocks store a path in the
  private `exam-files` bucket (`<tenant>/lessons/<teacher>/<uuid>.<ext>`, uploaded by `/api/lessons/files`, signed by
  `/api/lessons/media` after an RLS read of the lesson). `cn()` registers the D3 type scale with tailwind-merge — without
  it `text-fg text-body-sm` silently lost the colour.
- **Lesson prompt format contract:** the vocabulary line `- **term** — explanation ||translation||` is parsed by `VOCAB_RE` in `components/shared/lesson-tabs.tsx`, which needs a dash after the term. Never "clean up" dashes in AI prompts (commit 8c1ff22 did, and broke it; restored in `src/content/ai/lesson-from-file.ts`).
- **Password-reset email:** the source is `supabase/templates/recovery.html` (branches on `user_metadata.locale`, which `/api/auth/forgot-password` writes first). **Not applied** — Supabase rejects template edits on the free tier with the built-in email provider; it needs custom SMTP (then PATCH `mailer_templates_recovery_content` via the Management API). Until then the reset email is Supabase's English-only template.

### AI
`src/lib/ai/groq.ts` exports `groqChat(prompt, systemPrompt?)` — the shared Groq entry point for `api/ai/generate-exam` and `generate-lesson`. `src/lib/ai/gemini.ts` is a lesson-generation fallback (and `src/lib/ai/extract.ts` uses Gemini vision for scanned files) — it is not used for proctoring. Don't re-implement the provider fetch in route handlers; call the shared helper.

**Usage metering (every AI route).** Wrap the handler: `export const POST = meteredAiRoute('<feature>', async (request: Request) => { … })`, and right after auth call `const denied = await authorizeAiUsage(user.id); if (denied) return denied` (the institution's monthly allowance; `identifyAiCaller` instead when the route must never be gated, e.g. `extract-file`). Every provider call must go through `meterCall()` (`src/lib/ai/meter.ts`) — `groqChat`, the `aiChat` chain, Gemini vision and the direct Gemini calls in `generate-lesson-from-file` already do — so its tokens are captured (AsyncLocalStorage scope, one ledger row per request, written after the response via `record_ai_usage`). Cost = tokens × `src/lib/ai/pricing.ts` (the providers' PAID prices, verified 2026-09-26, overridable by super_admin in `platform_settings.ai_pricing`); billed cost stays 0 while every provider is on its free tier. Dashboard `/super-admin/ai-usage`, institution card `AiAllowanceCard` on the admin/centre dashboards, alerts in the bell. A new provider call that bypasses `meterCall` is invisible to the ledger.

### Public page caching (edge)
`src/proxy.ts` `withEdgeCache()` adds `Vercel-CDN-Cache-Control` / `CDN-Cache-Control: public, max-age=300, stale-while-revalidate=86400` to `/<locale>/…` marketing pages for **signed-out full page loads only** (Accept includes `text/html`; never RSC/prefetch — Next strips those headers before the proxy, hence the Accept check), and only when the response sets no cookie. So the public HTML must never depend on cookies: the theme is applied in the browser by `THEME_BOOT_SCRIPT` (`src/lib/theme.ts`, inline in the root layout `<head>`), and `eq_locale` is set by the proxy only when it differs and synced client-side by `PublicNav`. A deploy purges the cache. Heavy client libraries are loaded on demand only (TensorFlow, MediaPipe, and `livekit-client` after a live-proctoring token is granted).

### Performance Architecture Contract (binding since 2026-09-30)
Every read that reaches a screen follows [PERFORMANCE_CONTRACT.md](PERFORMANCE_CONTRACT.md): bounded lists
(server-side page/search/count), named columns (no `select('*')`), metadata separate from content (exam
questions only in the attempt flow), no N+1, no needless sequential waves, bounded UI-facing RPCs, RLS stays
the isolation boundary, reads in `src/lib/data/<resource>.ts`. **No Redis, no application-data cache, no
streaming/loading UI, no global prefetch change** for now (owner's decisions). `src/__tests__/perf-contract.test.ts`
is a shrink-only ratchet over `perf-contract-state.ts`; `supabase/tests/scale_baseline_check.sql` measures feed
sizes on a rolled-back synthetic institution. Numbers: [PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md).

- **Batch 1** (exam delivery) — shipped 2026-09-30, see the two `student_exam_list_*` migrations below.
- **Batch 2** (large lists + selectors) — no migration. Shipped (PR #37), each step owner-reviewed:
  - Lists, server page/search/count (`src/lib/data/people.ts` `listByRole` → `listStudents` / `listTeachers` /
    `listCenterStudents` / `listCenterTeachers`, 50 per page, `sanitizeSearch`, `?q=&page=` in the URL,
    `components/shared/list-pagination.tsx`): `/admin/students`, `/admin/teachers`, `/center/students`,
    `/center/teachers`.
  - Selectors, on demand (≤ 20 rows per search, nothing preloaded): T1 `/teacher/groups` student picker →
    `/api/students/search` (own group only); C-T teacher picker on `/center/groups` + `/center/courses` →
    `/api/teachers/search` + `components/center/teacher-picker.tsx`; C-S RosterModal «add a student» →
    `/api/roster/candidates` (who may search = who may add: mirrors the membership routes' gates; NAME only,
    no email; the target's members left out by a PostgREST anti-join).
  - C-M RosterModal member list → opt-in `?page=` on `GET /api/group-students` / `/api/course-enrollments`
    (`src/lib/data/rosters.ts` `readRosterPage`, 50 per page, exact total, past-end → last page). Without
    `page` both routes answer exactly as before — `/teacher/groups` (T1) reads its group's whole roster.
    The unpaged course read has no caller left in `src/` (kept; removing it is a later decision).
  - R1 (super-admin reports student picker), centre mail recipients and owner counts: done.
  - Follow-ups (not blockers, owner's decision 2026-10-01): (1) RosterModal re-fetches once more when the
    server corrects a past-end page; (2) after refining a search the previously picked student stays
    selected (Add enabled) though no longer listed — pre-existing behaviour.

### Post-Plan fixes (2026-10-04 / 05, no migration unless stated)

- **K** (invitations) and **A** (unpublished course content): migrations, see "Applied migrations".
- **F3**: `supabase/tests/rls_write_path_check.sql` reads exams through `get_student_exam_list()` (PR #46).
- **D1** (PR #49): report reads in `src/lib/data/reports.ts` throw `ReportReadError` on a failed read, a missing
  count or a short page (`max_rows` guard); `/api/reports` answers `503 reportReadFailed`, never a partial report.
- **B + C1** (PR #50): `src/lib/data/complete-read.ts` (`IncompleteReadError`, `readAllPages`, `readAllByKeyset`,
  `inBatches` of 100 ids) for teacher records (marks / submissions / course progress), the grade export,
  announcement stats (only "table missing" `PGRST205`/`42P01` hides them), delete-tenant (every user read before
  any deletion) and the long `.in()` lists (interested students, evidence, live monitor).
- **B / F1** (PR #51): `/center/groups` — one server page of 50 (`created_at DESC, id ASC`), active / archived
  totals from the database, the transfer picker reads every active group (`src/lib/data/center-groups.ts`).
- API limits (verified): `max_rows = 1000`; an `.in()` list past ≈ 640 uuids (≈ 25 KB URL) is refused with 400.
- Ratchet now: STAR_SELECT 37, UNBOUNDED_READS 107. Deferred: C2, D2, E1 and the 35 "potentially incorrect"
  1000-row reads. No action: J. Done since: I (PR #52), H (the 120 seeded test students deleted 2026-10-05),
  E2 + F2 (PR #53).
- **G1 + G2** (2026-10-05, measurement only — no remediation): G1 — Sentry sent 0–3 requests per full page load
  (median 1, 164–326 ms each, starting 1–10 s after load, non-blocking; 6 public-page samples): no performance
  problem shown. G2 — curl on `/login` (10 warm, then after 15 and 30 min idle): server part ≈ 0.34 s warm median,
  0.75 s at most after 30 min idle; the largest latencies were TLS / network on the client side (up to 10.6 s), not
  server processing. Vercel function logs were not available, so cold-start init cannot be separated from
  execution. Limits: one device / network, small samples. Decision: no remediation from G1 / G2 for now.

### Rate limiting
`src/lib/rate-limit.ts` `rateLimit(key, {limit, windowSecs})` is backed by the Postgres `check_rate_limit` RPC (survives serverless cold starts; fails **open** if the limiter errors). Apply it in AI/expensive route handlers keyed by `feature:userId`.

Pre-auth routes (2026-10-21): per-IP limits are tiered by Turnstile (next section). Verified token: classroom bucket `feature:ip-human:IP` (`login-id` 120/15 min, `accept-invitation` 60/h, `forgot-password` 30/h). Anything else: the pre-Turnstile strict bucket `feature:ip:IP` (10/15 min, 5/h, 5/h). Per-account limits (`login-id:code` 10/15 min, `forgot-password:email` 3/h) apply either way.

### CAPTCHA (Cloudflare Turnstile): a trust tier, never a gate
`src/components/shared/turnstile.tsx` on sign-in (ID path), join and forgot-password; `take()` hands over a single-use token and waits at most 3 s. The server (`src/lib/captcha.ts` `ipLimitFor`) verifies it with Cloudflare siteverify: accepted gives the classroom per-IP bucket, anything else (no token, rejected, Cloudflare down, keys unset) gives the strict pre-Turnstile bucket. No request is refused for a missing token: the 2026-10-21 hard-gate version locked invitation joins out wherever the widget could not run. **Supabase Auth's CAPTCHA switch stays OFF**: a token is single-use, so it cannot be verified here and again by Supabase. Password-change forms (authenticated) have no widget. Keys: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (Config) + `TURNSTILE_SECRET_KEY` (Secret) on Vercel Production.

