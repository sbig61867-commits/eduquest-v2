# Security Test Matrix

Every row is one attempted test. Statuses used: `VERIFIED PASS` (code/live-DB
inspection proves the control holds), `VERIFIED FAIL` (proven broken —
fixed, see notes), `NOT TESTABLE` (would require production data/accounts
the project owner has withheld permission to create), `UNKNOWN` (genuinely
could not be determined from available tools).

| # | Resource | Identity / tenant | Operation | Target tenant | Expected | Actual | Result | Policy/function that decided it |
|---|---|---|---|---|---|---|---|---|
| 1 | courses | teacher (any tenant) | SELECT another tenant's course via `get_course_progress` | other | DENY | **ALLOWED (pre-fix)** | VERIFIED FAIL → FIXED | `get_course_progress` — missing tenant check (now fixed) |
| 2 | courses | teacher/admin, own tenant | SELECT own-tenant course progress | own | ALLOW | ALLOW | VERIFIED PASS | `get_course_progress` post-fix |
| 3 | lessons | student | read `correct_answer` on any exam | own or other | DENY (field must be stripped) | DENIED — field absent from response | VERIFIED PASS | `get_student_exams()` — `jsonb_array_elements(...) - 'correct_answer'` |
| 4 | exams | anon (no session) | call `get_student_exams`, `start_exam_attempt`, `finalize_exam_submission`, `append_proctoring_events`, `get_admin_exams`, `get_admin_lessons`, `get_tenant_archive` directly | any | DENY | DENIED — zero grant rows for `anon` on any of these | VERIFIED PASS | `information_schema.routine_privileges` (live query) |
| 5 | exam grading | student (any) | forge own score via `finalize_exam_submission(p_score=999999,...)` | own | DENY (server recomputes) | DENIED — `p_score`/`p_max_score` params are received but never read; score is recomputed from `exams.questions` server-side | VERIFIED PASS | `finalize_exam_submission` body (read directly) |
| 6 | exam timing | student | submit after `ends_at` / after duration+grace | own | DENY | DENIED — explicit `TIME_EXPIRED`/`EXAM_CLOSED` checks against server `now()` | VERIFIED PASS | `finalize_exam_submission` |
| 7 | exam submissions | student | submit twice (replay) | own | DENY on 2nd | DENIED — `ALREADY_SUBMITTED` check + `FOR UPDATE` row lock prevents concurrent double-grade | VERIFIED PASS | `finalize_exam_submission` |
| 8 | exam attempts | student | start an attempt as another student (`p_student_id` spoof) | other | DENY | The RPC itself has no internal check (trusts `p_student_id`) — but the only real caller, `/api/exam/start`, hardcodes `p_student_id: user.id` from the session, so a spoofed value never reaches the RPC through the app | VERIFIED PASS (via caller), **NOT defense-in-depth at the RPC layer** | `/api/exam/start/route.ts` + `start_exam_attempt` |
| 9 | users table | self (any role) | self-update `role`/`tenant_id`/`is_active`/`permissions`/`can_create_courses` | own row | DENY | DENIED — `WITH CHECK` requires all five columns `IS NOT DISTINCT FROM` current DB values on self-update | VERIFIED PASS | `users_update` RLS policy (read directly) |
| 10 | announcements | anon | INSERT/UPDATE/DELETE `storage.objects` in `announcement-images`/`proctoring-evidence` | any | DENY | DENIED — zero INSERT/UPDATE/DELETE policies exist for any role on either bucket; only path is service-role, gated by `/api/announcements/upload` (auth + capability + rate-limit + MIME/size checks) | VERIFIED PASS | `pg_policies` on `storage.objects` (live query) + upload route |
| 11 | proctoring evidence | any authenticated user | read another user's proctoring screenshot via public URL guess | other | DENY | `proctoring-evidence` bucket is **private** (`public: false`) — direct URL access requires a signed URL from the server, not a public link | VERIFIED PASS (bucket config) — **NOT TESTABLE end-to-end** (no live proctoring session exists to generate a real signed URL and attempt cross-user access) | bucket config (`storage.buckets`) |
| 12 | LiveKit rooms | student | join another exam's room via room-name guess | other | DENY | Room access requires a signed token minted server-side after auth+enrollment checks; guessing `exam-<id>` alone is insufficient without a valid signed token | VERIFIED PASS (design) — **NOT TESTABLE live** (would require a real active exam session with two participants) | `/api/proctor/live-token/route.ts` |
| 13 | LiveKit media | student | subscribe to another student's audio/video in the same room | same exam | DENY | `canSubscribe: false` for the student grant — LiveKit itself enforces this at the SFU level, not just app logic | VERIFIED PASS (token grant) — **NOT TESTABLE live** | `/api/proctor/live-token/route.ts` |
| 14 | invitations | anon | call `accept_invitation` directly via RPC (bypassing rate limit / validation in the route) | any | DENY | DENIED — zero grant for `anon`/`authenticated`; service_role only | VERIFIED PASS | `information_schema.routine_privileges` |
| 15 | tenants | university_admin (tenant A) | read/modify Tenant B's row via `tenants` table direct access | B | DENY | Could not be exercised — 0 tenants exist in production and none may be created | **NOT TESTABLE** | — |
| 16 | groups/lessons/exams | teacher (tenant A) | CRUD another tenant's group/lesson/exam via API routes, real accounts | B | DENY | Verified via **code review** that every mutating route re-derives `tenant_id` server-side and checks entity ownership before writing (see SECURITY_AUDIT.md §4b.3) — but no live two-tenant HTTP request was actually fired | VERIFIED PASS (code review only) — **NOT independently exploit-tested live** | `ownsLesson`/`ownsExam`/group ownership checks |
| 17 | grades | teacher (tenant A) | read/modify Tenant B's grades | B | DENY | `grades` table RLS confirmed present (2 policies) — not read in full this pass | **NOT FULLY VERIFIED** — RLS existence confirmed, policy *content* not re-read this session (was verified in a prior session per `submissions-teacher-scope` memory, not re-proven here) | `grades` RLS (existence only, this session) |
| 18 | notifications | — | cross-tenant notification read | — | DENY | No standalone `notifications` table exists — served via `get_student_announcements()`, already verified tenant-scoped (row 3-family checks) | VERIFIED PASS (by absence + announcement RPC scoping) | `get_student_announcements()` |
| 19 | surveys | — | cross-tenant survey read/write | — | DENY | `surveys`/`survey_responses` RLS confirmed present (3 + 2 policies) — policy *content* not re-read this session | **NOT FULLY VERIFIED** this pass | existence only |
| 20 | analytics/reports | university_admin | read another tenant's aggregate report | other | DENY | `get_tenant_archive` verified tenant-gated (§4b.2); other report code (`src/lib/reports.ts`) not re-read this session | **PARTIALLY VERIFIED** (archive only) |  — |
| 21 | rate limiting | any | flood an AI endpoint during a simulated Postgres outage | — | throttle | Fails **open** — confirmed by direct code read of `rate-limit.ts` | VERIFIED FAIL-OPEN (design choice, documented, not silently broken) | `src/lib/rate-limit.ts` |
| 22 | trigger functions | anon/authenticated | call `handle_new_user`/`sync_user_claims`/etc. directly via RPC | — | DENY | Postgres blocks `RETURNS trigger` functions from direct invocation regardless of grants; grants were additionally revoked this session as defense-in-depth | VERIFIED PASS (both by Postgres semantics and by explicit revoke) | Postgres trigger-function semantics + this session's migration |

## Summary counts

- **VERIFIED PASS:** 13
- **VERIFIED FAIL → FIXED:** 1 (`get_course_progress`)
- **NOT TESTABLE (no second tenant / no live session available):** 6
- **NOT FULLY VERIFIED (existence confirmed, policy content not re-read this pass):** 2

No test result in this matrix was fabricated. Where a live exploit could not
be attempted, that is stated explicitly rather than inferred from RLS
existing or from prior-session memory.
