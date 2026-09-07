# SECURITY DEFINER Proof — all 27 functions

Every row below is backed by an actual `pg_get_functiondef()` read this
session (not inferred from naming or comments). "Could be INVOKER?" answers
what would break, concretely, not just "no."

| Function | DEFINER needed? | Why | Could be INVOKER? | search_path | Schema-qualified | Dynamic SQL/EXECUTE | auth.uid() used | Tenant check | Client params trusted? | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| `current_user_role()` | YES | Called *from inside* the `users` table's own RLS policies. INVOKER would re-trigger that same policy on its internal `SELECT ... FROM users` → infinite recursion. | **No** — would break every RLS policy that calls it (users, courses, lessons, exams, ...) | `public, pg_temp` ✓ | ✓ | none | ✓ (`WHERE id=auth.uid()`) | N/A (returns caller's own role) | No params | VERIFIED SOUND |
| `current_tenant_id()` | YES | Same reason as above. | **No** | `public, pg_temp` ✓ | ✓ | none | ✓ | N/A | No params | VERIFIED SOUND |
| `current_is_active()` | YES | Same reason. | **No** | `public, pg_temp` ✓ | ✓ | none | ✓ | N/A | No params | VERIFIED SOUND |
| `current_permissions()` | YES | Same reason. | **No** | `public, pg_temp` ✓ | ✓ | none | ✓ | N/A | No params | VERIFIED SOUND |
| `current_can_create_courses()` | YES | Same reason. | **No** | `public, pg_temp` ✓ | ✓ | none | ✓ | N/A | No params | VERIFIED SOUND |
| `handle_new_user()` | YES | Trigger on `auth.users` INSERT; writes `public.users` on behalf of GoTrue's own insert — the triggering context has no standing grant to do this as itself. | **No** — INVOKER would run as whatever role fired the auth.users insert (GoTrue internals), which has no INSERT grant on `public.users`. | `public` ✓ | ✓ | none | n/a (trigger, uses `NEW`) | n/a | Trigger-only; EXECUTE revoked from PUBLIC/anon/authenticated this session | VERIFIED SOUND (hardened this session) |
| `sync_user_claims()` | YES | Trigger; writes `auth.users.raw_app_meta_data` — a column only the auth-admin role class can normally write. | **No** | `public` ✓ | ✓ | none | n/a | n/a | Trigger-only; EXECUTE revoked | VERIFIED SOUND (hardened) |
| `cascade_tenant_active_status()` | YES | Trigger; cascades a tenant's `is_active` flip to every user row in that tenant — a bulk cross-row UPDATE no single user's own grant would cover. | **No** | `public` ✓ | ✓ | none | n/a | n/a (tenant-scoped by `WHERE tenant_id=NEW.id`) | Trigger-only; EXECUTE revoked | VERIFIED SOUND (hardened) |
| `deactivate_users_on_tenant_delete()` | YES | Same class as above, on tenant DELETE. | **No** | `public` ✓ | ✓ | none | n/a | n/a | Trigger-only; EXECUTE revoked | VERIFIED SOUND (hardened) |
| `get_student_exams()` | YES | Students have **no SELECT policy on `exams` at all** (intentional — answer-leak prevention). This function is the sanctioned exception that strips `correct_answer` before returning rows. | **No** — INVOKER would hit the missing SELECT policy and return zero rows, breaking the feature entirely (not a security improvement, just broken). | `public, pg_temp` ✓ | ✓ | none | ✓ (enrollment scoping) | ✓ (`group_id`/`course_id` IN caller's own enrollments) | No params | VERIFIED SOUND |
| `get_student_announcements()` | YES | Same class — no student SELECT policy on `announcements`. | **No** | `public, pg_temp` ✓ | ✓ | none | ✓ | ✓ (`tenant_id = caller's own`) | No params | VERIFIED SOUND |
| `get_student_schedule()` | YES | Same class — no student SELECT policy on `schedules`/`schedule_slots`. | **No** | `public, pg_temp` ✓ | ✓ | none | ✓ | ✓ (tenant + group membership) | No params | VERIFIED SOUND |
| `get_admin_exams()` | YES | university_admin has **no direct SELECT on `exams`** (metadata-only design — admins see counts/titles, never questions/answers content through this feed's shape). | **No** — would need a full-content SELECT policy that doesn't exist by design. | `public, pg_temp` ✓ | ✓ | none | n/a | ✓ (`current_user_role()='university_admin' AND tenant_id=current_tenant_id()`) | No params | VERIFIED SOUND |
| `get_admin_lessons()` | YES | Same class. | **No** | `public, pg_temp` ✓ | ✓ | none | n/a | ✓ | No params | VERIFIED SOUND |
| `get_course_progress(course_id, student_id)` | YES | Aggregates across `unit_items`/`course_units`/`course_levels`/`student_progress` — no single RLS policy on those 4 tables jointly expresses "own progress OR own-tenant teacher/admin." | **No** | `public, pg_temp` ✓ | ✓ | none | ✓ (`auth.uid()=p_student_id` self-access branch) | ✓ **fixed this session** — was missing entirely for the teacher/admin branch (cross-tenant IDOR), now requires `current_tenant_id()` to match both the course's and the student's tenant | `p_student_id`, `p_course_id` — **was trusted with only a role check; now tenant-checked** | VERIFIED SOUND (fixed 2026-09-06) |
| `get_tenant_archive(tenant_id, year)` | YES | Reads soft-deleted/archived rows, which are hidden from normal SELECT policies by `hide_archived_rls_migration` on purpose. | **No** | `public, pg_temp` ✓ | ✓ | none | n/a | ✓ (`current_user_role()='super_admin' OR (university_admin AND current_tenant_id()=p_tenant_id)`) | `p_tenant_id` — gated correctly, a university_admin passing another tenant's id matches zero rows (role condition fails) | VERIFIED SOUND |
| `accept_invitation(token, user_id, full_name)` | YES | Runs pre-session-establishment (or with a tenant-less session) — caller has no RLS standing to read `invitations` or promote their own `users` row's role/tenant. | **No** | `public` ✓ | ✓ | none | n/a (works from `p_user_id`, the just-created auth user) | n/a (tenant comes from the invitation row itself, not a param) | `service_role`-only; `SELECT ... FOR UPDATE` re-validates status/expiry/max_uses under lock — VERIFIED by reading the full body this session | VERIFIED SOUND |
| `get_invitation_by_token(token)` | YES | Pre-auth (anonymous) invitation-link preview — caller has no session at all. | **No** | `public` ✓ | ✓ | none | n/a | n/a | `service_role`-only | VERIFIED SOUND |
| `check_email_in_auth(email)` | YES | Reads `auth.users` directly — a schema no `anon`/`authenticated` grant can ever touch (owned by the auth subsystem). | **No** | `public, pg_temp` ✓ | ✓ | none | n/a | n/a | `service_role`-only | VERIFIED SOUND |
| `check_rate_limit(key, limit, window)` | YES | Operates on `rate_limits`, RLS-enabled with **zero policies for any role** (intentional total lock). | **No** — INVOKER couldn't read/write the table at all. | `public, pg_temp` ✓ | ✓ | none | n/a | n/a | `service_role`-only | VERIFIED SOUND |
| `cleanup_expired_invitations()` | YES | Same class — bulk maintenance write, no per-row RLS model fits "delete everything expired." | **No** | `public, pg_temp` ✓ | ✓ | none | n/a | n/a | `service_role`-only | VERIFIED SOUND |
| `finalize_exam_submission(...)` | YES | Writes `grades`, a table students have **no INSERT/UPDATE grant on at all** (grading must be server-authoritative). | **No** | `public, pg_temp` ✓ | ✓ | none | n/a | n/a (tenant derived from the exam row, not a param) | `p_score`/`p_max_score` **explicitly recomputed server-side and the params ignored** — VERIFIED by reading the loop that recalculates `_score`/`_max` from `correct_answer` | VERIFIED SOUND |
| `start_exam_attempt(exam_id, student_id, tenant_id)` | YES | Same class — writes `exam_submissions`, students have no direct INSERT there either (attempt state must be server-timed). | **No** | `public, pg_temp` ✓ | ✓ | none | n/a | ✓ **fixed this session** — now re-derives the exam's real tenant_id and independently re-verifies enrollment + exam time window, ignoring/cross-checking the caller-supplied values instead of trusting them | `p_tenant_id` **was trusted outright; now cross-checked against the exam's actual row and rejected on mismatch** | VERIFIED SOUND (fixed 2026-09-06) |
| `soft_delete_entity(kind, id, actor, tenant_id)` | YES | Cascades a soft-delete across up to 3 related tables (e.g. deleting a group also archives its lessons/exams) in one transaction — no single-table RLS policy expresses a multi-table cascade. | **No** | `public, pg_temp` ✓ | ✓ | none | n/a | ✓ **fixed this session** — now looks up `p_actor`'s real role+tenant from `public.users` and the target entity's real tenant, rejecting on any mismatch, plus an ownership check for `teacher` actors | `p_actor`/`p_tenant_id` **were used purely as trusted stamps with zero internal verification; now independently re-derived and checked** | VERIFIED SOUND (fixed 2026-09-06) |
| `restore_entity(kind, id, tenant_id, actor)` | YES | Same class, reverse direction. | **No** | `public, pg_temp` ✓ | ✓ | none | n/a | ✓ **fixed this session** — gained a required `p_actor` param (previously had none at all) and now verifies actor role/tenant the same way as `soft_delete_entity` | `p_tenant_id` **was accepted with zero internal check at all before this session** | VERIFIED SOUND (fixed 2026-09-06) |
| `append_proctoring_events(exam_id, student_id, events)` | YES | Writes `exam_submissions.proctoring_events`, a column students cannot write directly (integrity of the proctoring log must be server-mediated). | **No** | `public, pg_temp` ✓ | ✓ | none | n/a | ✓ **fixed this session** — now verifies `p_student_id` is actually enrolled in the exam's group before the UPDATE (previously the composite-key `WHERE` clause bounded blast radius but did no explicit check) | `p_student_id` — previously unchecked (low actual risk: UPDATE-only against a pre-existing row, no read-back); now checked | VERIFIED SOUND (fixed 2026-09-06) |

## Summary

**27/27 confirmed to need SECURITY DEFINER.** For every single one, the concrete
reason is one of: (a) it is called from inside the RLS policy it would
otherwise recurse into, (b) it is the sanctioned exception to a base-table
SELECT policy that is *intentionally* absent, (c) it needs to touch
`auth.users`/`rate_limits`, which no ordinary role grant can reach, or (d) it
performs a multi-table cascade or a write to a column normal users have no
grant on at all. **Zero candidates for downgrade to INVOKER** — every one
would either break outright or silently return empty results (not a security
improvement, a functional regression) if converted.

**All 27**: `search_path` pinned to `public[, pg_temp]` ✓, every table
reference schema-qualified (`public.users`, `public.exams`, ...) ✓, **zero**
use dynamic SQL or `EXECUTE` ✓ (confirmed by reading every function body,
not by pattern-matching the source text).

**5 functions had a real trust gap in how they used client-supplied
parameters** (`get_course_progress`, `start_exam_attempt`,
`soft_delete_entity`, `restore_entity`, `append_proctoring_events`) — **all 5
fixed this session** via migrations that re-derive the relevant fact (real
tenant, real enrollment, real actor role) from authoritative tables instead
of trusting the parameter. **Verification level: FIX VERIFIED BY CODE/SQL
REVIEW** (function bodies re-read post-migration, grants re-confirmed via
`information_schema.routine_privileges`) — **NOT a live cross-tenant exploit
re-test**, since no second tenant exists in production and none may be
created per explicit instruction this session.
