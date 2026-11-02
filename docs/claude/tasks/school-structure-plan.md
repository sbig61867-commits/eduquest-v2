# School structure (الهيكل المدرسي): design, parts 1 and 2

Status: built locally on `migrate/04-better-auth`.
- Part 1, `neon/migrations/0013_school_structure.sql`: **applied** to the Neon trial on 2026-11-01, with the owner's
  approval (see `docs/claude/MIGRATIONS_LOG.md`).
- Part 2, `neon/migrations/0014_school_subjects_timetable.sql` (subjects, subject teachers, bell schedule,
  section timetables, section 9 below): **PENDING**. It was only dry-run on the Neon trial inside
  `BEGIN … ROLLBACK`. The owner must approve it before it is applied.

Scope: when `tenants.institution_type = 'school'`, the institution admin gets stages → grades → sections, an
academic year with terms, and student placement (تسكين). Other institution types see no change.

## 1. What exists today (investigated)

| Piece | Where | Relevance |
|---|---|---|
| `groups` + `group_students` | core schema; RLS `groups_select`, `group_students_select`; app_service policies `svc_groups`, `svc_group_students` (0003) | A school's فصل **is** a group (`terminology.ts`: school `group` = «فصل»). Groups already carry `max_students` (capacity), `is_active` (archive flag), `deleted_at` (soft delete), `academic_unit_id`, `term_id` and `course_id`. Membership in a group drives lessons, exams, attendance sessions, announcements (`announcement_groups`), official timetables (`schedules` per group) and every student surface. |
| Academic structure | `academic_units` (level 1/2), `academic_terms`, `tenants.structure_mode` (`flat`/`academic`), `/admin/academic`, `/api/academic/*` | Generic, two untyped levels, one current term per tenant, gated by `structure_mode` (set by super_admin). It has no stage type, track, shift, homeroom teacher or year→term hierarchy, and it is shared with universities. |
| Writes | route checks the capability with the caller's live row (`getCaller` + `staffCan`), then writes as `app_service` pinned to the caller's institution (`src/lib/db/sql.ts`) | Same pattern here. |
| Reads | `src/lib/data/*.ts`, `run({ as: 'user' })` under RLS, named columns, bounded | Same here. |
| Capability | `manage_academic_structure` (university_admin default ON, centre manager default OFF) | Reused: no new capability, no permissions-UI change. |
| Neon schema | Supabase schema copy + `neon/migrations/0001…0012`, in order | New file `0013_school_structure.sql`. `supabase/schema.sql` is the Supabase snapshot. The Neon migrations 0001–0012 never edited it, because it has no `app_user`/`app_service`. This change follows the same rule. |

## 2. Decision: sections reuse `groups`

**A section (شعبة) is a row in `groups` with school metadata. Placement is a row in `group_students`.**

Why:
- In a school the platform already calls a group «فصل». «الصف السابع شعبة أ» is exactly that cohort.
- A placed student gets every existing feature for free, with no new code path: section lessons and exams,
  homeroom attendance (`attendance_sessions` per group), section announcements, the section's official
  timetable (`schedules`, one per group), roster screens and transfers (`transfer_student_group`).
- A parallel `school_sections` / `school_placements` model would need copies of all of that, or a sync layer.

What does **not** fit `groups` is the structure above it (typed stages, grades with a track, years with
terms). That gets four small dedicated tables. `academic_units` / `academic_terms` are not reused for it:
- they are untyped;
- they are gated by `structure_mode`, which a school does not need to switch on;
- `/admin/academic` would edit the same rows without the school fields.

Two adjustments to `groups`:
1. **The homeroom teacher is optional.** `groups.teacher_id` stays the group's teacher and is the homeroom
   teacher (رائد الصف) of a section. Its `NOT NULL` is dropped. A new CHECK keeps a teacher **required for
   every non-section group**, so non-school groups behave exactly as before. In `src/`, every read of a
   group's teacher is a `LEFT JOIN` (checked). The SQL predicates `teacher_id = auth.uid()` simply do not
   match `NULL`.
2. **Teachers see only their own sections.** `groups_select` gains one clause that applies only to section
   rows (`school_grade_id IS NOT NULL`): a teacher sees a section only when they are its homeroom teacher.
   `group_students_select` checks rosters through `groups`, so other sections' rosters are hidden too.
   Non-section groups are unchanged: teachers still see the tenant's groups as today.

## 3. Tables (migration 0013)

Every table has `tenant_id uuid NOT NULL → tenants ON DELETE CASCADE`. Ids use `gen_random_uuid()`.
Archiving means `deleted_at` (project convention). Sections use the group archive flag `is_active = false`.

| Table | Columns |
|---|---|
| `school_stages` | `kind` (`kindergarten`/`basic`/`secondary`), `name` (1–120), `code` (≤30, unique per tenant among live rows, case-insensitive), `sort_order`, `deleted_at`, `created_at` |
| `school_grades` | `stage_id → school_stages`, `name` (1–120), `code` (≤30), `track` (NULL or `general`/`scientific`/`literary`), `sort_order`, `deleted_at`, `created_at` |
| `school_years` | `name` (1–60, e.g. «2026/2027»), `starts_on`, `ends_on` (> starts), `is_active` (≤ 1 live active year per tenant: partial unique index; an archived year cannot be active: CHECK), `deleted_at`, `created_at` |
| `school_terms` | `year_id → school_years`, `term_no` (1–4, unique per live year), `name` (1–60), `starts_on`, `ends_on` (> starts, inside the year: trigger), `deleted_at`, `created_at` |
| `groups` + | `school_grade_id → school_grades`, `school_year_id → school_years`, `section_label` (1–20, e.g. «أ»), `shift` (NULL or `morning`/`evening`), `section_order` (int). CHECK: either all section fields are NULL (an ordinary group), or grade + year + label are all set. Unique live label per (year, grade). `groups.name` holds the display name «<grade name> <label>», and the API re-composes it when the grade or the label is renamed, so every existing surface shows a readable name. |
| `group_students` + | `school_year_id` (NULL for ordinary groups), **filled by a trigger from the group** (never trusted from the writer). Partial unique index `(student_id, school_year_id)` means **one section per student per year**, enforced by the database. |

Indexes: every FK has an index (`stage_id`, `year_id`, `school_grade_id`, `school_year_id` on groups and on
group_students), plus the list indexes `(tenant_id, sort_order) WHERE deleted_at IS NULL` and
`(tenant_id, starts_on DESC)`. The new `groups` indexes are partial (`WHERE school_grade_id IS NOT NULL`), so
non-school tenants pay nothing.

## 4. RLS and privileges

| Role | stages / grades / years / terms | sections (`groups`) | placement (`group_students`) |
|---|---|---|---|
| `app_user`: admin / centre manager | SELECT own tenant, live rows | own tenant (unchanged) | own tenant (unchanged) |
| `app_user`: teacher | SELECT own tenant (names only) | **own sections only** (new clause) + non-section groups as today | rosters of visible groups only (via `groups`) |
| `app_user`: student | SELECT own tenant (names only, harmless catalogue, as with `academic_units`) | own groups only (unchanged) | own rows only (unchanged) |
| `app_user`: super_admin | all | all | all |
| `app_service` | SELECT, INSERT, UPDATE; policy `svc_<table>` = `svc_tenant_ok(tenant_id)` | unchanged (`svc_groups`) | unchanged (`svc_group_students`) |
| PUBLIC / anon / authenticated | nothing (REVOKE ALL) | unchanged | unchanged |

No DELETE grant on the new tables: archive is an UPDATE. No user write policy: every write goes through
`/api/school/*` (capability checked with the user's live row, then app_service).

SECURITY DEFINER functions (all trigger-only, `SET search_path = public, pg_temp`, every table
schema-qualified, `REVOKE ALL … FROM PUBLIC, anon, authenticated`, no `auth.uid()`):
- `school_assert_school_tenant(uuid)`: raises `55000` unless the tenant's type is `school`.
- `school_structure_row_check()` (stages, grades, years, terms): school tenant; a grade's stage and a term's
  year belong to the same tenant (`42501`) and are live; a term lies inside its year (`23514`).
- `groups_school_section_check()`: on a section, the tenant is a school; the grade and year are live and in
  the same tenant; the homeroom teacher (if any) is a `teacher` of the same tenant; `school_year_id` cannot
  change once set (keeps placements consistent, `55000`).
- `group_students_fill_school_year()`: copies the group's `school_year_id`. For a section row, the member must
  be a `student` of the section's tenant.

## 5. Application

- `src/lib/school-structure.ts` (pure, browser-safe): kinds, tracks and shifts, plus input validation for
  every write (unit-tested).
- `src/lib/data/school-structure.ts`:
  - `loadSchoolStructure`: one unit as the user. It reads the caller, tenant type, stages ≤ 50, grades ≤ 300,
    years ≤ 50, terms ≤ 200, and the chosen year's sections ≤ 1000 with member counts and homeroom name.
  - `listPlacementStudents`: 50 per page, server search (`sanitizeSearch`), "unplaced only" filter, clamped
    page, each student's section for the year in the same statement (no N+1).
  - The writes run as app_service in single units.
- Routes:
  - `POST/PATCH/DELETE /api/school/structure` with `{ kind: stage|grade|section|year|term }`; PATCH with
    `order` reorders.
  - `GET/POST/DELETE /api/school/placement` (bulk ≤ 100 students, capacity-checked under a row lock on the
    section; a move removes the same-year placement first). Rate-limited per user.
  - `GET /api/teachers/search?for=school` (homeroom picker, same capability).
- UI: `/admin/school` («الهيكل المدرسي»), sidebar entry `schoolOnly`. The page redirects any non-school
  tenant to the dashboard.

## 6. Non-school tenants

Unchanged:
- **Schema:** new tables stay empty; new columns stay NULL; partial indexes stay empty.
- **Triggers:** they only act on rows with section or school fields set. The per-row `group_students`
  trigger costs one primary-key lookup of the group.
- **RLS:** the `groups_select` clause is a no-op when `school_grade_id IS NULL`.
- **UI and routes:** the sidebar entry is hidden; the routes return `409 schoolOnly`.

## 7. Known limits / for parts 2–7

- **Subject teachers.** A section has one teacher (the homeroom teacher). Teachers of other subjects need a
  `section_teachers (group_id, teacher_id, subject)` table, and the `groups_select` section clause must then
  also accept them. Lessons and exams for a section can then be posted by them.
- **Subjects / curriculum per grade** (`school_subjects`, grade ↔ subject) and the weekly timetable per section
  (reuse `schedules` with the section's group).
- **Promotion to next year** (ترفيع): copy sections into the new year, then bulk placement from last year's
  section. The data model already supports it (one placement per year, history kept).
- **Report cards per term** (`school_terms`) and homeroom attendance (existing attendance per group).
- **`groups.teacher_id … ON DELETE CASCADE`:** hard-deleting a homeroom teacher's user deletes the section.
  This is the same as today for any group; users are normally archived, not deleted. Changing the cascade
  would change non-school behaviour, so it is left as a decision for the owner.
- **Re-running 0003.** `0003_roles.sql` rebuilds every app_service grant from its own list. If it is ever
  re-run, re-run 0013 afterwards (it is idempotent).
- **Generic group routes.** `/api/group-students` can still add a student to a section. The trigger fills the
  year and the unique index refuses a second section in the same year (as a 500 `enrollFailed` there). The
  school placement screen is the intended path.

## 8. Verification (2026-11-01, local, nothing applied)

| Check | Result |
|---|---|
| Rolled-back dry-run of 0013 on the Neon trial | Executes in about 0.3 s and re-runs without error (idempotent). All 39 integrity, RLS and privilege checks pass. After the `ROLLBACK` there is no `school_*` table, `groups.teacher_id` is still `NOT NULL`, and `groups_select` is unchanged. |
| `src/__tests__/school-structure-dryrun.test.ts` (opt-in, `SCHOOL_DRYRUN=1`) | The real routes and data layer run against 0013 inside one rolled-back transaction: 6/6. Note: it holds DDL locks on `groups` / `group_students` on the trial for the run (about 4 min from a far PC). |
| `src/__tests__/school-structure-trial.test.ts` | In `npm run test:neon`. It skips itself until 0013 is applied to the trial. |
| `school-structure.test.ts` (validation) and `school-routes.test.ts` (gate, tenant pinning, error mapping) | Unit tests with the fake SQL layer. They run in `npm test`. |

**The owner must approve applying 0013 to the Neon trial.** That trial is the database the platform will
start from. Before applying, follow the Neon rules of the "Database" section of `CLAUDE.md`:
1. Re-read the live definitions of `groups_select` and `svc_*`, and any newer `neon/migrations`.
2. Dry-run the migration.
3. Apply it.
4. Run `npm run test:neon`.

The UI was not checked in a browser: the trial holds no school tenant, and the shared dev server was not
used.

---

## 9. Part 2: subjects per grade, subject teachers, bell schedule, section timetables

Migration `neon/migrations/0014_school_subjects_timetable.sql` (needs 0013). Schools only; nothing changes for
other institution types.

### 9.1 Decision: the section timetable reuses `schedules` / `schedule_slots`

The existing weekly-timetable feature (staff collaboration phase 3) already has one group timetable per group
(`schedules`, `uq_schedules_group`), slots per day with times, title and teacher (`schedule_slots`), publication
to students (`is_published` + `get_student_schedule()`), the teacher view (`schedules_select`), the staff editor
(`/admin/schedules`), attendance per slot (`attendance_sessions.schedule_slot_id`) and dashboard counts. A section is
a group (part 1), so **a section's timetable is its group timetable and each cell is one `schedule_slots` row**:

- `schedule_slots` gains `school_period_id` and `school_subject_id`. Both are NULL for every ordinary slot; a CHECK
  requires both or neither.
- One cell per (timetable, day, period): unique partial index `schedule_slots_school_cell_uq`.
- A trigger copies the cell's **times** from the period, its **title** from the subject and its **teacher** from
  the subject's teacher in that section. These values are never taken from the writer, so a generic
  `/api/schedules/slots` edit of a school cell cannot desynchronise it.
- Result: `/student/schedule` shows the section timetable once it is published (no change to
  `get_student_schedule()`), `/teacher/schedule` lists it for the section's teachers, and `/admin/schedules` lists it
  like any group timetable.

Clearing a cell deletes its `schedule_slots` row, as every timetable slot is deleted today. The four new tables are
never deleted from (archive = `deleted_at`).

### 9.2 Tables

| Table | Columns |
|---|---|
| `school_subjects` | `name` (1–120), `code` (1–30, required, unique per school among live rows, any case), `colour` (NULL or a token NAME: `neutral`/`accent`/`info`/`success`/`warning`/`danger`, never a hex), `sort_order`, `deleted_at` |
| `school_grade_subjects` | `grade_id`, `subject_id`, `weekly_sessions` (1–40); one live link per (grade, subject). Unlink = `deleted_at` |
| `school_periods` | `shift` (NULL = every shift, else `morning`/`evening`), `kind` (`lesson`/`break`), `name` (optional), `starts_at` < `ends_at` (time). Periods of one shift never overlap (trigger, serialised per school by an advisory lock) |
| `school_subject_teachers` | `group_id` (the section), `subject_id`, `teacher_id`; one live row per (section, subject). Unassign = `deleted_at` |

A section follows the bell of its shift when the school defined one, otherwise the general bell (`shift` NULL).

### 9.3 Integrity (database)

- **Cell checks** (`school_slot_check`, BEFORE INSERT/UPDATE on `schedule_slots`; returns at once for ordinary
  slots). The timetable must be a section's group timetable of the same school. The period must be a live
  **lesson** of the school, and its shift (if any) must be the section's shift. The subject must be live and
  **linked to the section's grade**.
- **No teacher in two places at once**, within one academic year and among active sections. The check runs when
  the teacher, day or times of a cell change. It takes `pg_advisory_xact_lock` per teacher, so two concurrent
  writers for one teacher are serialised; under READ COMMITTED the second writer's check then sees the first
  writer's committed cell. The error is `23P01 school_slot_teacher_busy`, with the other section's name in `DETAIL`.
- **Keeping current timetables in step** (`school_timetable_sync`, AFTER UPDATE). "Current" means a live section in
  a live year; past years keep what they showed.
  - A period's new times, type or shift are copied into its cells and re-checked. A change that would cause a clash
    or put a break in a cell is refused.
  - A subject rename is copied into the cells' titles.
  - A teacher (re)assignment or removal is copied into the section's cells of that subject and re-checked.
  - Archiving a period, a subject or a grade link that a current cell uses is refused (`55000 …_in_use`). The API
    checks first, for a precise error.
- **Section changes** (`groups_school_timetable_sync`, AFTER UPDATE OF shift, is_active on `groups`, sections only).
  A shift change re-checks the section's cells: a period of the other shift is refused. Restoring an archived
  section is refused if one of its teachers now has a clash.
- The weekly sessions target is **not** a hard limit. The grid shows count / target per subject and warns above it.

### 9.4 RLS and privileges

| | subjects / grade links / periods | `school_subject_teachers` | sections, rosters, timetables |
|---|---|---|---|
| admin / centre manager | own school, live rows | own school | unchanged |
| teacher | own school (catalogue) | rows of sections they teach | **+ sections they teach a subject in**: `groups_select`, and so the rosters through `group_students_select`; `schedules_select` and `schedule_slots_select` for those sections. Homeroom rule unchanged. |
| student | own school (catalogue) | rows of their own sections | unchanged (published timetables via `get_student_schedule()`) |
| super_admin | all | all | all |
| app_service | SELECT, INSERT, UPDATE, `svc_<table>` = `svc_tenant_ok(tenant_id)` | same | unchanged |
| PUBLIC / anon / authenticated / service_role | nothing | nothing | unchanged |

- `current_teacher_section_ids()` is SECURITY DEFINER, `search_path` pinned and EXECUTE for `app_user` only. It
  returns the sections the caller teaches (homeroom or a subject). Both `groups_select` and
  `school_subject_teachers_select` use it, which avoids RLS recursion. It is a user-session helper like
  `current_student_group_ids()`, so `auth.uid()` there is the signed-in user. The trigger functions never use
  `auth.uid()`.
- The new clauses are no-ops for non-school institutions: they have no sections and no subject teachers.

### 9.5 Application

- `src/lib/school-timetable.ts` (pure, browser-safe):
  - input rules for every write;
  - `periodsForShift`, `lessonNumbers`, `weeklyCounts` / `weeklyStatus`, `teacherClash`.
- `src/lib/data/school-timetable.ts`:
  - `loadSchoolCurriculum`: one unit as the user. Subjects ≤ 200, grade links ≤ 3000, periods ≤ 60.
  - `loadSectionTimetable`: one unit as the user. The section and its timetable, cells ≤ 140, subject teachers, and
    those teachers' periods in other active sections of the year ≤ 1000, for the inline clash hints.
  - `loadTeacherSchoolPeriods` («جدولي»): ≤ 300, active year. It returns `[]` until 0014 is applied.
  - The writes: app_service, one unit each.
  - `mapTimetableError` turns trigger and index refusals into precise errors. Part 1's `mapWriteError` delegates
    `school_slot_*` to it, for section shift changes and restores.
- Routes. All are rate-limited per user, check the caller's live row and are schools only.
  - `/api/school/subjects`: subject CRUD and the grade link upsert/unlink. Capability `manage_academic_structure`.
  - `/api/school/periods`: the bell schedule. Capability `manage_academic_structure`.
  - `/api/school/timetable`: GET the editor data; POST `cell` / `teacher`; PATCH publish; DELETE cell. Capability
    `manage_schedules`, the one every timetable write already needs. `authorizeSchool` gained an optional
    capability argument.
- UI:
  - `/admin/school` tabs «المواد» (catalogue + stage × subject matrix of weekly sessions), «الحصص» (bell per shift)
    and «الجدول» (pick a section → days × periods grid). In the grid, a click assigns a subject or clears the cell.
    Each option shows the subject's teacher, its count / target and a "busy in …" note; a busy teacher's option is
    disabled. The tab also holds a teacher picker per subject and a publish button.
  - The tabs say "migration not applied" until 0014 exists; part 1 keeps working.
  - Teacher `/teacher/schedule`: a «جدولي» block with the teacher's own periods across sections.
  - Student `/student/schedule`: unchanged; it shows the published section timetable.

### 9.6 Known limits (part 3+)

- **App screens that list a teacher's groups by `groups.teacher_id = me`** do not yet include subject sections: the
  groups page, the lessons / exams / invitations pickers, the dashboard count, reports and records. Neither do the
  write routes that check the group's teacher. RLS now lets a subject teacher read those sections, but posting
  lessons and exams to them is a follow-up.
- **Restoring a section** re-checks teacher clashes, but archiving one frees its teachers. A restore can then be
  refused until the clashing cells are cleared.
- **Deadlocks:** a period time change that touches many cells takes one advisory lock per teacher, in row order.
  Two such admin edits running at the same time could deadlock; Postgres aborts one of them (a retryable 500).
- **School days:** the grid shows Sunday–Thursday by default, any day that has cells, and every day on request.
  There is no per-school week setting.
- **Re-running 0003:** if `0003_roles.sql` is ever re-run, re-run 0013 and then 0014 after it.

### 9.7 Verification (2026-11-01, local; 0014 not applied)

| Check | Result |
|---|---|
| Rolled-back run of 0014 on the trial (on top of the applied 0013) | Executes (about 0.6 s), and a second run in the same transaction succeeds (idempotent). |
| `src/__tests__/school-timetable-dryrun.test.ts` (opt-in, `TIMETABLE_DRYRUN=1`) | The real routes and data layers, `get_student_schedule()` and the RLS against 0014 inside one rolled-back transaction: 7/7. It covers the catalogue, the bell schedule, cells (grade, break, shift and clash refusals; values the writer cannot override; time and rename propagation; archive/unlink guards), subject-teacher clashes, cross-school and capability refusals, RLS per role, privileges and function ACLs, and section shift/restore checks. After the `ROLLBACK`: no new table, column, trigger or function; `groups_select`, `schedules_select` and `schedule_slots_select` are identical to before. It holds DDL locks on `groups` / `schedules` / `schedule_slots` for about 6 min from a far PC. |
| `src/__tests__/school-timetable-trial.test.ts` | In `npm run test:neon`. It skips until 0014 is applied. |
| `school-timetable.test.ts` (rules, helpers) and `school-timetable-routes.test.ts` (gates, tenant pinning, error mapping) | Unit tests in `npm test`. |
| Not covered | Concurrency of the advisory lock (two real transactions): this needs the migration committed. Browser check of the UI: the trial has no school tenant, and the shared dev server was not used. |

**The owner must approve applying 0014 to the Neon trial.** Before applying it, follow the same four steps as for
0013 above.
