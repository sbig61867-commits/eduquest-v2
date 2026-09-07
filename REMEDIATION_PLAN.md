# Remediation Plan

## 🚨 ACTIVE INCIDENT — highest priority, blocks everything else below

**CRITICAL — Production database credential exposed in Git history**
(`scripts/run-migration.mjs`, hardcoded since 2026-06-22, public repo, all 4
branches). Working-tree fix applied (env-var-only now). **Waiting on: user
rotates the `postgres` password via Supabase Dashboard and confirms.** Once
confirmed: re-verify connectivity/tests/build, then plan (not yet execute)
a git-history rewrite. Full detail in `FINAL_AUDIT_STATUS.md`. No item below
this should be treated as higher priority until this is closed.

---


Prioritized by severity. Items marked **DONE** were fixed in this audit
session (live migrations/config, already applied). Items marked **PENDING**
need either the owner's decision (trade-off/plan/cost) or a second real
tenant to verify before/after — not blocked on missing code skill.

## Done this session

| ID | Finding | Fix | Verification |
|---|---|---|---|
| D-1 | 4 trigger functions PostgREST-exposed to `anon`/`authenticated` | `REVOKE ALL ... FROM PUBLIC, anon, authenticated` | Live grant re-query confirms zero rows for those roles |
| D-2 | `get_course_progress` cross-tenant IDOR (HIGH) | Added tenant-match check for teacher/university_admin branch | Code-reviewed post-fix; live exploit re-test NOT TESTABLE (no 2nd tenant) |
| D-3 | 10 npm vulnerabilities (1 moderate, 9 high) | `next` 16.2.9 → 16.3.4 | `npm audit` → 0 vulnerabilities |
| D-4 | `announcement-images` bucket had no size/MIME limit at the storage layer | Set `file_size_limit=4MiB`, `allowed_mime_types` to the same 4 image types the upload route already enforces | Live `storage.buckets` re-query confirms |
| D-5 (was R-1) | `start_exam_attempt`, `soft_delete_entity`, `restore_entity` trusted `p_student_id`/`p_tenant_id`/`p_actor` params with zero internal validation | Added internal re-derivation/re-verification in each function (exam's real tenant, real enrollment, actor's real role+tenant from `public.users`); `restore_entity` gained a new required `p_actor` param, its one caller (`/api/admin/restore`) updated to pass it, old 3-arg signature dropped | `information_schema.routine_privileges` re-confirms zero `anon`/`authenticated` grants; `npx tsc --noEmit` clean; 52/52 vitest tests pass; function bodies re-read post-migration — **FIX VERIFIED BY CODE/SQL REVIEW, NOT a live cross-tenant exploit test** (no second tenant exists) |
| D-6 | `append_proctoring_events` had the same unvalidated-params pattern as D-5 (lower severity — UPDATE-only against a pre-existing row, no read/leak possible) | Added the same internal enrollment re-verification | Same as D-5 |

## Pending — needs owner decision, not a code gap

| ID | Finding | Severity | Why not auto-fixed | Recommended action |
|---|---|---|---|---|
| R-1 | ~~`start_exam_attempt`, `soft_delete_entity`, `restore_entity` trust params with zero internal validation~~ | — | **DONE — see D-5/D-6 above.** |
| R-2 | Rate limiter fails open on Postgres errors — including for AI generation endpoints. Full security-impact analysis in `ARCHITECTURE_AND_HARDENING_AUDIT.md` §2: yes, a user can generate unlimited AI requests during a limiter failure; this can drain the shared free-tier AI provider quota (not money, per current free-tier-only AI policy); no per-tenant limit, no circuit breaker, no concurrency limit exist independent of the (bypassed) rate limiter. | MEDIUM | Full fail-closed for AI routes trades "unlimited usage during a DB blip" for "AI feature outage during a DB blip" — a product decision, not fixed without sign-off | Three-tier remediation proposed in `ARCHITECTURE_AND_HARDENING_AUDIT.md` §2 (timeout → bounded local cooldown → full fail-closed), ordered by increasing user-visible impact. Owner to pick. |
| R-9 | No timeout wrapper around Groq `fetch()` or Gemini SDK calls — a hung provider ties up the function invocation until Vercel's platform-level timeout | LOW | Independent of R-2, cheap to add, zero behavior change on the success path | Add `AbortController` with a 20-30s timeout around both call sites |
| R-10 | `get_admin_exams`/`get_admin_lessons`/`get_tenant_archive` have no pagination — return the full tenant dataset in one call | LOW at current scale | Fine at 0-500 rows; needs UI pagination changes on the consuming admin pages, not just the RPC, to fix properly | Add `LIMIT`/cursor pagination once a real tenant's dataset size makes this a measured concern, not preemptively |
| R-3 | Leaked-password protection (HaveIBeenPwned) disabled | LOW-MEDIUM | Supabase Free plan does not support this feature (Management API confirmed) | Requires a Supabase plan upgrade to Pro; then one `PATCH .../config/auth {"password_hibp_enabled":true}` call |
| R-4 | `/api/admin/restore` silently no-ops for `super_admin` (their `tenant_id` is `NULL`, so `tenant_id = p_tenant_id` never matches) | Functional bug, not security | Needs a decision on whether super_admin should be able to restore any tenant's archived entity, and if so how they'd specify which tenant | Add an explicit tenant-selection UI/param for super_admin restores, or special-case `p_tenant_id IS NULL` in `restore_entity` for super_admin only |
| R-5 | Unindexed `deleted_by` FKs, "unused" indexes, overlapping permissive policies on `feature_flags`/`platform_settings`/`tenants` | INFO | Current data volume (0 tenants) makes "unused" advisor output meaningless; premature index/policy changes without real traffic to validate against | Re-run `get_advisors(type: performance)` after onboarding real tenants; act on it then, not now |
| R-6 | 34 of 42 service-role usage sites were classified SAFE by pattern-consistency, not individually re-read this session | Unknown (likely none, given the pattern held in every sample) | Budget — would require reading ~34 more files in depth | Full manual re-read in a dedicated follow-up session, or write an automated lint rule that flags any `service_role`-key usage where a client-suppliable value flows into a `.eq('tenant_id', ...)` or ID field without a preceding ownership check |
| R-7 | Root cause of "0 tenants / no `@eduquest.local` test accounts in production" is UNKNOWN | N/A — investigative, not a vulnerability | Cannot be determined read-only from this session's tool access | Owner to check: Supabase project activity log / any manual cleanup they or a prior session performed |
| R-8 | Supabase plan tier appears to be Free (inferred from the HIBP Management API response) — no confirmed read-replica/PITR | UNKNOWN — requires dashboard verification | Not visible via available tools | Owner to confirm current plan and backup/PITR configuration directly in the Supabase dashboard billing page |

## Structural / scaling (no immediate action needed at current scale — 0 real tenants)

| ID | Item | Trigger point |
|---|---|---|
| S-1 | No queue/worker tier for AI generation, PDF processing, report generation, batch grading — all synchronous in the request cycle | Move to a queue (e.g., a Postgres-backed job table + a worker, or a managed queue) once P95 latency on these routes becomes a user-visible problem, or once a single request needs to survive longer than a serverless function's execution limit |
| S-2 | No read replica for Postgres | Once read-heavy dashboard/report queries measurably compete with write-path latency (exam submission, grading) — not before |
| S-3 | No CDN/WAF/DDoS layer explicitly configured beyond what Vercel provides by default | Revisit if the app experiences abuse traffic; Vercel's platform-level DDoS protection is likely sufficient at current and near-term scale |

## Explicitly not attempted this session (see SECURITY_TEST_MATRIX.md and ENVIRONMENT_IDENTITY_REPORT.md for why)

- Live two-tenant adversarial HTTP-level exploitation (would require creating
  tenants/users — explicitly withheld).
- Real load testing at 100–50,000 concurrent users (needs external
  infrastructure this session cannot provision or safely point at production).
- Live LiveKit room-crossing exploitation (needs two real concurrent
  participants in an active proctored exam).
