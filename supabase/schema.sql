-- ============================================================
-- EduQuest Multi-Tenant Schema with Row Level Security
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE tenants (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  logo_url    TEXT,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  -- Plan seat cap on ACTIVE students; NULL = unlimited. Enforced in
  -- src/lib/student-limit.ts — see tenant_student_limit_migration.sql.
  student_limit INTEGER CHECK (student_limit IS NULL OR student_limit >= 0),
  -- Drives UI vocabulary only (src/lib/terminology.ts) — see institution_type_migration.sql.
  institution_type TEXT NOT NULL DEFAULT 'university'
    CONSTRAINT tenants_institution_type_check
    CHECK (institution_type IN ('university','school','institute','training_center','company')),
  -- Centre features (student affiliation split, center_manager) — institution_type_migration.sql
  has_center BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE users (
  id                 UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email              TEXT UNIQUE NOT NULL,
  full_name          TEXT NOT NULL,
  avatar_url         TEXT,
  role               TEXT NOT NULL CHECK (role IN ('super_admin','university_admin','center_manager','teacher','student')),
  tenant_id          UUID REFERENCES tenants(id) ON DELETE SET NULL,
  is_active          BOOLEAN DEFAULT TRUE,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  -- teacher opt-in for building structured courses (courses_migration.sql)
  can_create_courses BOOLEAN NOT NULL DEFAULT FALSE,
  -- per-user staff capability flags; role defaults are resolved in
  -- src/lib/permissions.ts, not here (phase2_permissions_announcements_migration.sql).
  -- users_update pins this column so nobody can grant themselves a capability.
  permissions        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- students only: university student (TRUE) vs continuing-education trainee
  -- who only ever signed up for a course (FALSE). Decides which announcement
  -- audiences reach them; also pinned by users_update
  -- (student_affiliation_announcements_migration.sql).
  is_university_student BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE feature_flags (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  is_enabled  BOOLEAN DEFAULT TRUE,
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name, tenant_id)
);

CREATE TABLE groups (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  teacher_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  -- archive flag: archived groups keep all records but are hidden from students
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE group_students (
  group_id    UUID REFERENCES groups(id) ON DELETE CASCADE,
  student_id  UUID REFERENCES users(id) ON DELETE CASCADE,
  joined_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (group_id, student_id)
);

CREATE TABLE lessons (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  group_id      UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  teacher_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  content       TEXT,
  media_urls    TEXT[] DEFAULT '{}',
  is_published  BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE exams (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  group_id            UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  teacher_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  duration_minutes    INTEGER NOT NULL DEFAULT 60,
  questions           JSONB NOT NULL DEFAULT '[]',
  is_published        BOOLEAN DEFAULT FALSE,
  proctoring_enabled  BOOLEAN DEFAULT FALSE,
  -- homework only: publish auto-graded results to the student immediately on submit
  auto_publish        BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at           TIMESTAMPTZ,
  ends_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE exam_submissions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  exam_id           UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  answers           JSONB NOT NULL DEFAULT '{}',
  answers_draft     JSONB DEFAULT NULL,
  submitted_at      TIMESTAMPTZ DEFAULT NOW(),
  proctoring_events JSONB NOT NULL DEFAULT '[]',
  UNIQUE(exam_id, student_id)
);

CREATE TABLE grades (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exam_id       UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  submission_id UUID REFERENCES exam_submissions(id) ON DELETE SET NULL,
  score         NUMERIC NOT NULL,
  max_score     NUMERIC NOT NULL,
  graded_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_id, exam_id)
);

-- EXAM APPEALS: a student's formal dispute of a recorded proctoring
-- violation, directed to the exam's teacher. Carries enough denormalized
-- context (teacher_id, group_id) that an admin can pull a complete report
-- without joining through exam_submissions -> exams every time. Written via
-- the service-role client after app-level authorization (see
-- api/appeals/*) — no INSERT/UPDATE RLS policy, same convention as every
-- other privileged-write table in this schema.
CREATE TABLE exam_appeals (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  exam_id           UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  submission_id     UUID NOT NULL REFERENCES exam_submissions(id) ON DELETE CASCADE,
  student_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teacher_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id          UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  violation_type    TEXT,
  violation_at      TIMESTAMPTZ,
  -- Denormalized snapshots (same pattern as invitations.group_name_snapshot)
  -- — a student has no RLS read on exams/users, so the row must be
  -- self-contained; an admin report needs none of this to change
  -- retroactively.
  student_name      TEXT NOT NULL,
  teacher_name      TEXT NOT NULL,
  group_name        TEXT NOT NULL,
  exam_title        TEXT NOT NULL,
  student_message   TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'upheld', 'rejected')),
  teacher_response  TEXT,
  resolved_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_exam_appeals_teacher    ON exam_appeals(teacher_id);
CREATE INDEX idx_exam_appeals_student    ON exam_appeals(student_id);
CREATE INDEX idx_exam_appeals_tenant     ON exam_appeals(tenant_id);
CREATE INDEX idx_exam_appeals_submission ON exam_appeals(submission_id);
-- A student can file at most one appeal per specific event (or one "general"
-- appeal, where violation_type/violation_at are both NULL) per submission.
CREATE UNIQUE INDEX idx_exam_appeals_one_per_event
  ON exam_appeals (submission_id, COALESCE(violation_type, ''), COALESCE(violation_at, 'epoch'::timestamptz));
ALTER TABLE exam_appeals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exam_appeals_select" ON exam_appeals FOR SELECT USING (
  current_user_role() = 'super_admin'
  OR student_id = auth.uid()
  OR teacher_id = auth.uid()
  OR (current_user_role() = 'university_admin' AND tenant_id = current_tenant_id())
);

-- STAFF REQUESTS: teacher↔admin request/inbox channel with a message thread.
-- See staff_requests_migration.sql. RLS: super_admin all; university_admin
-- tenant-wide; other users only requests they are party to.
CREATE TABLE staff_requests (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  to_user_id   UUID NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  type         TEXT NOT NULL DEFAULT 'general' CHECK (type IN ('grade_sheet','report','general')),
  subject      TEXT NOT NULL,
  group_id     UUID REFERENCES groups(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','completed','cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE request_messages (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id UUID NOT NULL REFERENCES staff_requests(id) ON DELETE CASCADE,
  sender_id  UUID NOT NULL REFERENCES users(id)          ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_staff_requests_tenant ON staff_requests(tenant_id);
CREATE INDEX idx_staff_requests_to     ON staff_requests(to_user_id);
CREATE INDEX idx_staff_requests_from   ON staff_requests(from_user_id);
CREATE INDEX idx_request_messages_req  ON request_messages(request_id, created_at);

ALTER TABLE staff_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_requests_select" ON staff_requests FOR SELECT USING (
  current_user_role() = 'super_admin'
  OR (tenant_id = current_tenant_id()
      AND (current_user_role() = 'university_admin'
           OR from_user_id = auth.uid() OR to_user_id = auth.uid()))
);
CREATE POLICY "staff_requests_insert" ON staff_requests FOR INSERT WITH CHECK (
  tenant_id = current_tenant_id()
  AND from_user_id = auth.uid()
  AND current_user_role() IN ('teacher','university_admin')
);
CREATE POLICY "staff_requests_update" ON staff_requests FOR UPDATE USING (
  current_user_role() = 'super_admin'
  OR (tenant_id = current_tenant_id()
      AND (current_user_role() = 'university_admin'
           OR from_user_id = auth.uid() OR to_user_id = auth.uid()))
);
CREATE POLICY "request_messages_select" ON request_messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM staff_requests r WHERE r.id = request_messages.request_id
    AND (current_user_role() = 'super_admin'
         OR (r.tenant_id = current_tenant_id()
             AND (current_user_role() = 'university_admin'
                  OR r.from_user_id = auth.uid() OR r.to_user_id = auth.uid()))))
);
CREATE POLICY "request_messages_insert" ON request_messages FOR INSERT WITH CHECK (
  sender_id = auth.uid()
  AND EXISTS (SELECT 1 FROM staff_requests r WHERE r.id = request_messages.request_id
    AND r.tenant_id = current_tenant_id()
    AND (current_user_role() = 'university_admin'
         OR r.from_user_id = auth.uid() OR r.to_user_id = auth.uid()))
);


-- SCHEDULES: weekly timetables. Either one per group (official, published
-- to that group's students) or one private one per teacher (their informal
-- exams; students never see it). Arranged by staff holding the
-- `manage_schedules` capability. See phase3_schedules_migration.sql.
-- Students get NO direct row read — get_student_schedule() applies
-- publication state and group enrolment.
CREATE TABLE schedules (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'group' CHECK (kind IN ('group','teacher')),
  group_id     UUID REFERENCES groups(id) ON DELETE CASCADE,
  teacher_id   UUID REFERENCES users(id)  ON DELETE CASCADE,
  title        TEXT NOT NULL,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_by   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT schedules_target_check CHECK (
    (kind = 'group'   AND group_id   IS NOT NULL AND teacher_id IS NULL)
    OR
    (kind = 'teacher' AND teacher_id IS NOT NULL AND group_id   IS NULL)
  )
);

-- One timetable per group, and one private timetable per teacher.
CREATE UNIQUE INDEX uq_schedules_group   ON schedules(group_id)   WHERE group_id   IS NOT NULL;
CREATE UNIQUE INDEX uq_schedules_teacher ON schedules(teacher_id) WHERE teacher_id IS NOT NULL;

CREATE TABLE schedule_slots (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0 = Sunday
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  title       TEXT NOT NULL,
  teacher_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  location    TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT schedule_slots_time_check CHECK (end_time > start_time)
);

CREATE INDEX idx_schedules_tenant        ON schedules(tenant_id, is_published);
CREATE INDEX idx_schedule_slots_schedule ON schedule_slots(schedule_id, day_of_week, start_time);
CREATE INDEX idx_schedule_slots_tenant   ON schedule_slots(tenant_id);
CREATE INDEX idx_schedule_slots_teacher  ON schedule_slots(teacher_id);

ALTER TABLE schedules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "schedules_select" ON schedules FOR SELECT USING (
  current_user_role() = 'super_admin'
  OR (
    tenant_id = current_tenant_id()
    AND (
      current_user_role() IN ('university_admin','center_manager')
      OR (
        current_user_role() = 'teacher'
        AND (teacher_id = auth.uid()
             OR group_id IN (SELECT g.id FROM groups g WHERE g.teacher_id = auth.uid()))
      )
    )
  )
);

CREATE POLICY "schedule_slots_select" ON schedule_slots FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM schedules s
    WHERE s.id = schedule_slots.schedule_id
      AND (
        current_user_role() = 'super_admin'
        OR (
          s.tenant_id = current_tenant_id()
          AND (
            current_user_role() IN ('university_admin','center_manager')
            OR (
              current_user_role() = 'teacher'
              AND (s.teacher_id = auth.uid()
                   OR s.group_id IN (SELECT g.id FROM groups g WHERE g.teacher_id = auth.uid()))
            )
          )
        )
      )
  )
);

-- Writes are performed by the API on the service-role client after the
-- `manage_schedules` capability check, so no write policies are granted.
-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_users_tenant_id ON users(tenant_id);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_groups_tenant_id ON groups(tenant_id);
CREATE INDEX idx_groups_teacher_id ON groups(teacher_id);
CREATE INDEX idx_lessons_tenant_id ON lessons(tenant_id);
CREATE INDEX idx_lessons_group_id ON lessons(group_id);
CREATE INDEX idx_exams_tenant_id ON exams(tenant_id);
CREATE INDEX idx_exams_group_id ON exams(group_id);
CREATE INDEX idx_exam_submissions_student_id ON exam_submissions(student_id);
CREATE INDEX idx_grades_student_id ON grades(student_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE tenants         ENABLE ROW LEVEL SECURITY;
ALTER TABLE users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags   ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups          ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_students  ENABLE ROW LEVEL SECURITY;
ALTER TABLE lessons         ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams           ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE grades          ENABLE ROW LEVEL SECURITY;

-- Helper function: get current user's role
-- NOTE: search_path is pinned because SECURITY DEFINER functions inherit the
-- CALLER's search_path. Under PostgREST the `authenticated` role can run with a
-- restricted search_path, so an unqualified `FROM users` fails with
-- "relation \"users\" does not exist" → the function returns NULL → every RLS
-- policy that calls it denies with 403. Schema-qualify the table AND pin the path.
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;

-- Helper function: get current user's tenant_id
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT tenant_id FROM public.users WHERE id = auth.uid();
$$;

-- Helper function: the group_ids the current student is enrolled in. Exists
-- specifically to break an RLS-recursion cycle between groups_select (which
-- needs to know a student's own groups) and group_students_select (which
-- reads groups) — see the comment on groups_select below. Added alongside
-- the 2026-09-13 PII-overexposure fix.
CREATE OR REPLACE FUNCTION current_student_group_ids()
RETURNS SETOF UUID
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT group_id FROM public.group_students WHERE student_id = auth.uid();
$$;

-- TENANTS: super_admin sees all; others see only their own
CREATE POLICY "tenants_select" ON tenants FOR SELECT USING (
  current_user_role() = 'super_admin' OR id = current_tenant_id()
);
CREATE POLICY "tenants_manage" ON tenants FOR ALL USING (
  current_user_role() = 'super_admin'
);

-- USERS: super_admin sees all; staff (university_admin/center_manager/teacher)
-- see everyone in their tenant (teacher/groups needs this to browse the
-- whole student body when assigning someone to a group); a student sees only
-- themselves plus the teacher of a group/course they're actually enrolled
-- in — NOT the rest of the tenant. Tightened 2026-09-13 after a live audit
-- proved a student account could otherwise enumerate every user's email in
-- their university; see supabase/fix_student_pii_overexposure_migration.sql
-- and AUDIT/11-security-isolation-tests.md for the full write-up.
CREATE POLICY "users_select" ON users FOR SELECT USING (
  current_user_role() = 'super_admin'
  OR id = auth.uid()
  OR (current_user_role() IN ('university_admin', 'center_manager', 'teacher') AND tenant_id = current_tenant_id())
  OR (
    current_user_role() = 'student' AND tenant_id = current_tenant_id() AND (
      id IN (SELECT g.teacher_id FROM groups g JOIN group_students gs ON gs.group_id = g.id WHERE gs.student_id = auth.uid())
      OR id IN (SELECT c.teacher_id FROM courses c JOIN course_enrollments ce ON ce.course_id = c.id WHERE ce.student_id = auth.uid())
    )
  )
);
CREATE POLICY "users_insert" ON users FOR INSERT WITH CHECK (
  current_user_role() IN ('super_admin','university_admin')
);
CREATE POLICY "users_update" ON users FOR UPDATE
  USING (
    current_user_role() = 'super_admin'
    OR (current_user_role() = 'university_admin' AND tenant_id = current_tenant_id())
    OR id = auth.uid()
  )
  WITH CHECK (
    current_user_role() = 'super_admin'
    OR (
      current_user_role() = 'university_admin'
      AND tenant_id = current_tenant_id()
      AND role <> 'super_admin'
      AND id <> auth.uid()
    )
    OR (
      -- Self-update: profile fields only. RLS gates rows, NOT columns, so every
      -- column that influences identity or authorization must be pinned here —
      -- otherwise a user can grant themselves capabilities by updating their own
      -- row. See users_capability_pin_migration.sql (which expresses the same
      -- rule via current_permissions() / current_can_create_courses() helpers).
      -- ANY new authorization column on `users` must be added to this list.
      id = auth.uid()
      AND role      = (SELECT u.role      FROM users u WHERE u.id = auth.uid())
      AND tenant_id IS NOT DISTINCT FROM
                      (SELECT u.tenant_id FROM users u WHERE u.id = auth.uid())
      AND is_active = (SELECT u.is_active FROM users u WHERE u.id = auth.uid())
      AND is_university_student IS NOT DISTINCT FROM
                      (SELECT u.is_university_student FROM users u WHERE u.id = auth.uid())
      AND permissions IS NOT DISTINCT FROM
                      (SELECT u.permissions FROM users u WHERE u.id = auth.uid())
      AND can_create_courses IS NOT DISTINCT FROM
                      (SELECT u.can_create_courses FROM users u WHERE u.id = auth.uid())
    )
  );

-- GROUPS: staff scoped to tenant; a student sees only groups they're
-- actually enrolled in (tightened alongside users_select — see the note
-- there and supabase/fix_student_pii_overexposure_migration.sql). Uses the
-- current_student_group_ids() SECURITY DEFINER helper (defined in that
-- migration) rather than a direct group_students subquery, because
-- group_students_select's own USING clause reads groups — a direct
-- correlated subquery here would create RLS-evaluation infinite recursion
-- between the two policies (hit and confirmed live while drafting the fix).
CREATE POLICY "groups_select" ON groups FOR SELECT USING (
  current_user_role() = 'super_admin'
  OR (current_user_role() != 'student' AND tenant_id = current_tenant_id())
  OR (current_user_role() = 'student' AND id IN (SELECT current_student_group_ids()))
);
CREATE POLICY "groups_insert" ON groups FOR INSERT WITH CHECK (
  current_user_role() IN ('teacher','university_admin','super_admin') AND
  tenant_id = current_tenant_id()
);
CREATE POLICY "groups_update" ON groups FOR UPDATE USING (
  current_user_role() = 'super_admin' OR
  (current_user_role() = 'teacher' AND teacher_id = auth.uid())
);

-- LESSONS: teacher sees own (or own-group) lessons; students see only
-- published lessons in enrolled groups. university_admin has NO direct row
-- read (that would expose lessons.content) — the admin reads metadata only
-- via get_admin_lessons(). See admin_metadata_only_migration.sql.
CREATE POLICY "lessons_select" ON lessons FOR SELECT USING (
  deleted_at IS NULL
  AND (
    current_user_role() = 'super_admin'
    OR (
      current_user_role() = 'teacher'
      AND tenant_id = current_tenant_id()
      AND (
        teacher_id = auth.uid()
        OR group_id IN (SELECT g.id FROM groups g WHERE g.teacher_id = auth.uid())
      )
    )
    OR (
      current_user_role() = 'student'
      AND is_published = true
      AND group_id IN (
        SELECT gs.group_id FROM group_students gs WHERE gs.student_id = auth.uid()
      )
    )
  )
);
CREATE POLICY "lessons_insert" ON lessons FOR INSERT WITH CHECK (
  current_user_role() IN ('teacher','university_admin','super_admin') AND
  tenant_id = current_tenant_id()
);
CREATE POLICY "lessons_update" ON lessons FOR UPDATE USING (
  current_user_role() = 'super_admin' OR
  (current_user_role() = 'teacher' AND teacher_id = auth.uid())
);

-- EXAMS: only super_admin and the owning teacher get direct row access.
-- Students do NOT (questions JSONB embeds correct_answer); they read exams
-- via get_student_exams(), which strips the answers. university_admin does
-- NOT either (same leak) — the admin reads metadata + counts via
-- get_admin_exams(). See exam_answer_leak_fix / admin_metadata_only migrations.
CREATE POLICY "exams_select" ON exams FOR SELECT USING (
  current_user_role() = 'super_admin'
  OR (current_user_role() = 'teacher' AND teacher_id = auth.uid())
);
CREATE POLICY "exams_insert" ON exams FOR INSERT WITH CHECK (
  current_user_role() IN ('teacher','university_admin','super_admin') AND
  tenant_id = current_tenant_id()
);
CREATE POLICY "exams_update" ON exams FOR UPDATE USING (
  current_user_role() = 'super_admin' OR
  (current_user_role() = 'teacher' AND teacher_id = auth.uid())
);

-- SUBMISSIONS: student sees own; teacher sees only their own exams'
-- submissions. university_admin has NO direct read (student answers/scores) —
-- attainment reports run on the service-role client. See admin_metadata_only_migration.sql.
CREATE POLICY "submissions_select" ON exam_submissions FOR SELECT USING (
  current_user_role() = 'super_admin' OR
  student_id = auth.uid() OR
  (current_user_role() = 'teacher' AND EXISTS (
     SELECT 1 FROM exams
     WHERE exams.id = exam_submissions.exam_id
       AND exams.teacher_id = auth.uid()
  ))
);
-- NO client INSERT/UPDATE/DELETE policy on exam_submissions — deliberate.
-- A WITH CHECK of (student_id = auth.uid() AND tenant_id = current_tenant_id())
-- constrains *who* the row belongs to but nothing about `score`, so a student
-- could POST /rest/v1/exam_submissions and mint their own 100/100 'published'
-- grade for an exam they never sat. That was live and exploitable until
-- 2026-09-11. Every legitimate write goes through the service-role client
-- (start_exam_attempt / finalize_exam_submission / the teacher grading route),
-- which is why removing the policy costs nothing.
-- See fix_submission_insert_grade_forgery_migration.sql.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON exam_submissions FROM anon, authenticated;

-- GRADES: students see own; teachers see tenant-wide. university_admin has
-- NO direct read — grade reports/كشوفات run on the service-role client and
-- are requested through the teacher flow. See admin_metadata_only_migration.sql.
CREATE POLICY "grades_select" ON grades FOR SELECT USING (
  current_user_role() = 'super_admin'
  OR student_id = auth.uid()
  OR (
    current_user_role() = 'teacher'
    AND tenant_id = current_tenant_id()
  )
);
-- NO client write policy on grades either. Nothing in src/ writes this table —
-- every grade lives in exam_submissions — and university_admin is metadata-only
-- by design (admin_metadata_only_migration.sql), so an admin-writable second
-- grade store was a liability with no caller.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON grades FROM anon, authenticated;

-- ============================================================
-- AUTO-CREATE USER PROFILE ON SIGNUP
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, role, tenant_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'student',
    NULL
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'handle_new_user error for %: %', NEW.email, SQLERRM;
  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- ============================================================
-- PLATFORM SETTINGS (see platform_settings_migration.sql)
-- Key/value store; read by any authenticated user, written by super_admin.
-- Seeded keys: invitation_defaults {university_admin,teacher,student,max_expiry_hours}
--              ai_rate_limits {lesson_per_hour,exam_per_hour}
--              exam_policies {proctoring_default_enabled,violation_warning_threshold}
-- ============================================================
CREATE TABLE platform_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "settings_read_authenticated" ON platform_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "settings_write_super_admin" ON platform_settings
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'super_admin')
  WITH CHECK (public.current_user_role() = 'super_admin');

-- ============================================================
-- Pilot feedback survey (see supabase/survey_migration.sql for the
-- full migration with RLS policies — applied separately on live DB)
-- ============================================================
CREATE TABLE surveys (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  group_id    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  teacher_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT 'تقييم تجربة المنصة',
  is_open     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(group_id)
);

CREATE TABLE survey_responses (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  survey_id       UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  student_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ease_rating     SMALLINT NOT NULL CHECK (ease_rating BETWEEN 1 AND 5),
  prefer_platform BOOLEAN NOT NULL,
  best_feature    TEXT,
  problem_faced   TEXT,
  recommend       BOOLEAN NOT NULL,
  comment         TEXT,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(survey_id, student_id)
);

-- ============================================================
-- AI usage log (see supabase/ai_usage_log_migration.sql for the full
-- migration with the get_tenant_ai_usage() aggregate feed — applied
-- separately on live DB)
-- ============================================================
CREATE TABLE ai_usage_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  feature     TEXT NOT NULL,
  provider    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- Mirrored from the 2026-09-13/15 centre-manager migrations (see those files
-- for rationale). Order: capabilities -> attendance -> dashboard.
-- ============================================================

-- ── center_manager_capabilities_migration.sql ──
-- ============================================================
-- center_manager_capabilities_migration.sql — 2026-09-13
-- Idempotent + re-runnable. Apply in the Supabase SQL Editor.
--
-- The centre manager can now manage teachers, students, groups and courses
-- inside their own university, each behind a per-user capability flag
-- (src/lib/permissions.ts: manage_teachers / manage_students /
-- manage_groups / manage_courses). Every WRITE goes through route handlers
-- that check the capability with the user session and then write with the
-- service-role client — so no write policy is widened here.
--
-- What this migration changes is READ access the centre manager lacked:
--   * courses_select            — centre manager had no course read at all
--   * course_enrollments_select — needed to see who is enrolled
-- users / groups / group_students already allow every non-student staff
-- role in the tenant (verified against pg_policies on 2026-09-13).
--
-- Capability flags are deliberately NOT evaluated in RLS: reads are
-- tenant-scoped metadata the role already sees elsewhere (dashboard counts),
-- matching the announcements_select / schedules_select convention.
-- ============================================================

DROP POLICY IF EXISTS "courses_select" ON courses;
CREATE POLICY "courses_select" ON courses FOR SELECT USING (
  deleted_at IS NULL
  AND (
    (SELECT current_user_role()) = 'super_admin'
    OR (
      tenant_id = (SELECT current_tenant_id())
      AND (
        (SELECT current_user_role()) IN ('university_admin', 'center_manager')
        OR teacher_id = (SELECT auth.uid())
        OR (
          (SELECT current_user_role()) = 'student'
          AND is_published = true
          AND EXISTS (
            SELECT 1 FROM course_enrollments ce
            WHERE ce.course_id = courses.id AND ce.student_id = (SELECT auth.uid())
          )
        )
      )
    )
  )
);

DROP POLICY IF EXISTS "course_enrollments_select" ON course_enrollments;
CREATE POLICY "course_enrollments_select" ON course_enrollments FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin'
  OR (
    tenant_id = (SELECT current_tenant_id())
    AND (
      (SELECT current_user_role()) IN ('university_admin', 'center_manager', 'teacher')
      OR student_id = (SELECT auth.uid())
    )
  )
);

-- ── attendance_migration.sql ──
-- ============================================================
-- attendance_migration.sql — 2026-09-13
-- Idempotent + re-runnable. Apply in the Supabase SQL Editor.
--
-- Class attendance for groups:
--   attendance_sessions — one meeting of a group on a date (optionally tied
--                         to the weekly timetable slot it came from)
--   attendance_records  — one row per student per session
--
-- Writes: ONLY through /api/attendance (service-role client) after the route
-- verifies the caller is the group's teacher, or university_admin /
-- center_manager holding manage_attendance, in the same tenant. So these
-- tables get SELECT policies only (deny-by-default for writes), exactly like
-- announcements / schedules.
--
-- Reads:
--   super_admin              — everything
--   university_admin/center_manager — their tenant
--   teacher                  — sessions/records of groups they teach
--   student                  — their own records (and the sessions behind them)
--
-- Storage cost: one small row per student per class meeting; the hot paths
-- are indexed below. No personal data beyond the status + optional note.
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  group_id         uuid NOT NULL REFERENCES groups(id)  ON DELETE CASCADE,
  schedule_slot_id uuid REFERENCES schedule_slots(id)   ON DELETE SET NULL,
  session_date     date NOT NULL,
  title            text,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- One session per group per date per slot (NULL slot = the ad-hoc session).
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_session
  ON attendance_sessions (group_id, session_date, COALESCE(schedule_slot_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_tenant_date ON attendance_sessions (tenant_id, session_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_slot        ON attendance_sessions (schedule_slot_id);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_created_by  ON attendance_sessions (created_by);

CREATE TABLE IF NOT EXISTS attendance_records (
  session_id uuid NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status     text NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
  note       text CHECK (note IS NULL OR char_length(note) <= 300),
  marked_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  marked_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_records_student   ON attendance_records (student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_tenant    ON attendance_records (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_attendance_records_marked_by ON attendance_records (marked_by);

ALTER TABLE attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "attendance_sessions_select" ON attendance_sessions;
CREATE POLICY "attendance_sessions_select" ON attendance_sessions FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin'
  OR (
    tenant_id = (SELECT current_tenant_id())
    AND (
      (SELECT current_user_role()) IN ('university_admin', 'center_manager')
      OR (
        (SELECT current_user_role()) = 'teacher'
        AND EXISTS (SELECT 1 FROM public.groups g WHERE g.id = attendance_sessions.group_id AND g.teacher_id = (SELECT auth.uid()))
      )
      OR (
        (SELECT current_user_role()) = 'student'
        AND group_id IN (SELECT current_student_group_ids())
      )
    )
  )
);

DROP POLICY IF EXISTS "attendance_records_select" ON attendance_records;
CREATE POLICY "attendance_records_select" ON attendance_records FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin'
  OR (
    tenant_id = (SELECT current_tenant_id())
    AND (
      (SELECT current_user_role()) IN ('university_admin', 'center_manager')
      OR student_id = (SELECT auth.uid())
      OR (
        (SELECT current_user_role()) = 'teacher'
        AND EXISTS (
          SELECT 1 FROM public.attendance_sessions s
          JOIN public.groups g ON g.id = s.group_id
          WHERE s.id = attendance_records.session_id AND g.teacher_id = (SELECT auth.uid())
        )
      )
    )
  )
);

-- Belt and braces: no direct table writes from the browser roles.
REVOKE INSERT, UPDATE, DELETE ON attendance_sessions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON attendance_records  FROM anon, authenticated;

-- ── center_dashboard_migration.sql ──
-- ============================================================
-- center_dashboard_migration.sql — 2026-09-15
-- Idempotent + re-runnable. Apply in the Supabase SQL Editor
-- AFTER attendance_migration.sql (the function reads its tables).
--
-- get_center_dashboard(p_days) — one call returns every aggregate the
-- centre / university dashboard renders, as JSONB.
--
-- Processing & storage:
--   * Computed on demand from the live tables — no new storage, no
--     materialized views, no cron. One round-trip per page load.
--   * Returns AGGREGATES ONLY (counts, rates, averages per group/teacher).
--     No student names, answers or individual grades leave this function —
--     the "numbers, not content" rule from admin_metadata_only_migration.
--   * Tenant comes from public.users by auth.uid(), never from a parameter.
--
-- Access (mirrors src/lib/permissions.ts view_reports):
--   university_admin — allowed unless permissions.view_reports = false
--   center_manager   — only when permissions.view_reports = true
--   anyone else      — raises 42501
-- ============================================================

-- Hot paths for the windowed aggregates.
CREATE INDEX IF NOT EXISTS idx_grades_tenant_graded        ON grades (tenant_id, graded_at DESC);
CREATE INDEX IF NOT EXISTS idx_exam_submissions_tenant_sub ON exam_submissions (tenant_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_progress_tenant     ON student_progress (tenant_id, completed_at DESC);

CREATE OR REPLACE FUNCTION public.get_center_dashboard(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_role   text;
  v_tenant uuid;
  v_perms  jsonb;
  v_days   integer;
  v_from   timestamptz;
  v_people jsonb; v_groups jsonb; v_learning jsonb; v_assess jsonb;
  v_attend jsonb; v_group_rows jsonb; v_teacher_rows jsonb; v_trend jsonb;
  v_sched  jsonb; v_engage jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT u.role, u.tenant_id, COALESCE(u.permissions, '{}'::jsonb)
    INTO v_role, v_tenant, v_perms
  FROM public.users u WHERE u.id = v_uid AND u.is_active = true;

  IF v_tenant IS NULL OR NOT (
       (v_role = 'university_admin' AND COALESCE(v_perms->>'view_reports', 'true') <> 'false')
    OR (v_role = 'center_manager'   AND v_perms->>'view_reports' = 'true')
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_days := LEAST(GREATEST(COALESCE(p_days, 30), 7), 365);
  v_from := now() - make_interval(days => v_days);

  -- ── People ────────────────────────────────────────────────
  SELECT jsonb_build_object(
    'teachers',        count(*) FILTER (WHERE u.role = 'teacher'),
    'active_teachers', count(*) FILTER (WHERE u.role = 'teacher' AND u.is_active),
    'students',        count(*) FILTER (WHERE u.role = 'student'),
    'active_students', count(*) FILTER (WHERE u.role = 'student' AND u.is_active),
    'new_students',    count(*) FILTER (WHERE u.role = 'student' AND u.created_at >= v_from),
    'students_without_group', count(*) FILTER (
      WHERE u.role = 'student' AND u.is_active AND NOT EXISTS (
        SELECT 1 FROM public.group_students gs
        JOIN public.groups g ON g.id = gs.group_id AND g.deleted_at IS NULL AND g.is_active
        WHERE gs.student_id = u.id))
  ) INTO v_people
  FROM public.users u WHERE u.tenant_id = v_tenant;

  -- ── Groups ────────────────────────────────────────────────
  SELECT jsonb_build_object(
    'active',   count(*) FILTER (WHERE g.is_active),
    'archived', count(*) FILTER (WHERE NOT g.is_active),
    'avg_size', COALESCE(round(avg(sz.n) FILTER (WHERE g.is_active), 1), 0)
  ) INTO v_groups
  FROM public.groups g
  LEFT JOIN LATERAL (SELECT count(*) AS n FROM public.group_students gs WHERE gs.group_id = g.id) sz ON true
  WHERE g.tenant_id = v_tenant AND g.deleted_at IS NULL;

  -- ── Courses & progress ────────────────────────────────────
  WITH totals AS (
    SELECT ui.course_id, count(*) AS total
    FROM public.unit_items ui
    JOIN public.course_units cu ON cu.id = ui.unit_id AND cu.is_published
    WHERE ui.tenant_id = v_tenant AND ui.is_published
    GROUP BY ui.course_id
  ), prog AS (
    SELECT sp.student_id, ui.course_id,
           count(*) FILTER (WHERE ui.is_published AND cu.is_published) AS done,
           max(sp.completed_at) AS last_at
    FROM public.student_progress sp
    JOIN public.unit_items ui   ON ui.id = sp.unit_item_id
    JOIN public.course_units cu ON cu.id = ui.unit_id
    WHERE sp.tenant_id = v_tenant
    GROUP BY sp.student_id, ui.course_id
  ), enr AS (
    SELECT ce.student_id, ce.course_id, ce.enrolled_at,
           COALESCE(t.total, 0) AS total, COALESCE(p.done, 0) AS done, p.last_at
    FROM public.course_enrollments ce
    JOIN public.courses c ON c.id = ce.course_id AND c.deleted_at IS NULL
    LEFT JOIN totals t ON t.course_id = ce.course_id
    LEFT JOIN prog p   ON p.course_id = ce.course_id AND p.student_id = ce.student_id
    WHERE ce.tenant_id = v_tenant
  )
  SELECT jsonb_build_object(
    'courses',           (SELECT count(*) FROM public.courses c WHERE c.tenant_id = v_tenant AND c.deleted_at IS NULL),
    'published_courses', (SELECT count(*) FROM public.courses c WHERE c.tenant_id = v_tenant AND c.deleted_at IS NULL AND c.is_published),
    'enrollments',       count(*),
    'avg_progress',      COALESCE(round(avg(LEAST(done::numeric / total, 1)) FILTER (WHERE total > 0) * 100, 1), 0),
    'completed',         count(*) FILTER (WHERE total > 0 AND done >= total),
    'active_learners',   count(DISTINCT student_id) FILTER (WHERE last_at >= v_from),
    'at_risk',           count(*) FILTER (WHERE NOT (total > 0 AND done >= total)
                                            AND COALESCE(last_at, enrolled_at) < now() - interval '14 days')
  ) INTO v_learning
  FROM enr;

  -- ── Assessments (aggregates only) ─────────────────────────
  SELECT jsonb_build_object(
    'graded',    count(*),
    'avg_pct',   COALESCE(round(avg(gr.score / gr.max_score) * 100, 1), 0),
    'pass_rate', COALESCE(round(avg(CASE WHEN gr.score / gr.max_score >= 0.5 THEN 1.0 ELSE 0 END) * 100, 1), 0),
    'submissions', (SELECT count(*) FROM public.exam_submissions s
                    WHERE s.tenant_id = v_tenant AND s.submitted_at >= v_from),
    'flagged',     (SELECT count(*) FROM public.exam_submissions s
                    WHERE s.tenant_id = v_tenant AND s.submitted_at >= v_from AND s.is_flagged)
  ) INTO v_assess
  FROM public.grades gr
  WHERE gr.tenant_id = v_tenant AND gr.graded_at >= v_from AND gr.max_score > 0;

  -- ── Attendance ────────────────────────────────────────────
  SELECT jsonb_build_object(
    'sessions', (SELECT count(*) FROM public.attendance_sessions s
                 WHERE s.tenant_id = v_tenant AND s.session_date >= v_from::date),
    'records',  count(*),
    'present',  count(*) FILTER (WHERE ar.status = 'present'),
    'late',     count(*) FILTER (WHERE ar.status = 'late'),
    'absent',   count(*) FILTER (WHERE ar.status = 'absent'),
    'excused',  count(*) FILTER (WHERE ar.status = 'excused'),
    'rate',     COALESCE(round(100.0 * count(*) FILTER (WHERE ar.status IN ('present', 'late'))
                         / NULLIF(count(*) FILTER (WHERE ar.status <> 'excused'), 0), 1), 0),
    'chronic_absentees', (
      SELECT count(*) FROM (
        SELECT ar2.student_id
        FROM public.attendance_records ar2
        JOIN public.attendance_sessions s2 ON s2.id = ar2.session_id
        WHERE ar2.tenant_id = v_tenant AND s2.session_date >= v_from::date AND ar2.status <> 'excused'
        GROUP BY ar2.student_id
        HAVING count(*) >= 3
           AND count(*) FILTER (WHERE ar2.status = 'absent')::numeric / count(*) >= 0.25
      ) x)
  ) INTO v_attend
  FROM public.attendance_records ar
  JOIN public.attendance_sessions s ON s.id = ar.session_id
  WHERE ar.tenant_id = v_tenant AND s.session_date >= v_from::date;

  -- ── Per group ─────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.students DESC, r.name), '[]'::jsonb) INTO v_group_rows
  FROM (
    SELECT g.id, g.name, u.full_name AS teacher,
      (SELECT count(*) FROM public.group_students gs WHERE gs.group_id = g.id) AS students,
      (SELECT count(*) FROM public.attendance_sessions s
        WHERE s.group_id = g.id AND s.session_date >= v_from::date) AS sessions,
      (SELECT round(100.0 * count(*) FILTER (WHERE ar.status IN ('present', 'late'))
                / NULLIF(count(*) FILTER (WHERE ar.status <> 'excused'), 0), 1)
         FROM public.attendance_records ar
         JOIN public.attendance_sessions s ON s.id = ar.session_id
        WHERE s.group_id = g.id AND s.session_date >= v_from::date) AS attendance_rate,
      (SELECT round(avg(gr.score / gr.max_score) * 100, 1)
         FROM public.grades gr JOIN public.exams e ON e.id = gr.exam_id
        WHERE e.group_id = g.id AND gr.graded_at >= v_from AND gr.max_score > 0) AS avg_pct
    FROM public.groups g
    LEFT JOIN public.users u ON u.id = g.teacher_id
    WHERE g.tenant_id = v_tenant AND g.deleted_at IS NULL AND g.is_active
    ORDER BY g.name
    LIMIT 100
  ) r;

  -- ── Per teacher ───────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.students DESC, r.name), '[]'::jsonb) INTO v_teacher_rows
  FROM (
    SELECT t.id, t.full_name AS name, t.is_active,
      (SELECT count(*) FROM public.groups g
        WHERE g.teacher_id = t.id AND g.deleted_at IS NULL AND g.is_active) AS groups,
      (SELECT count(DISTINCT gs.student_id) FROM public.group_students gs
         JOIN public.groups g ON g.id = gs.group_id AND g.deleted_at IS NULL AND g.is_active
        WHERE g.teacher_id = t.id) AS students,
      (SELECT count(*) FROM public.courses c WHERE c.teacher_id = t.id AND c.deleted_at IS NULL) AS courses,
      (SELECT round(sum(extract(epoch FROM (sl.end_time - sl.start_time))) / 3600.0, 1)
         FROM public.schedule_slots sl WHERE sl.teacher_id = t.id) AS weekly_hours,
      (SELECT round(avg(gr.score / gr.max_score) * 100, 1)
         FROM public.grades gr JOIN public.exams e ON e.id = gr.exam_id
        WHERE e.teacher_id = t.id AND gr.graded_at >= v_from AND gr.max_score > 0) AS avg_pct
    FROM public.users t
    WHERE t.tenant_id = v_tenant AND t.role = 'teacher'
    ORDER BY t.full_name
    LIMIT 100
  ) r;

  -- ── Weekly trend (last 8 weeks) ───────────────────────────
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.week), '[]'::jsonb) INTO v_trend
  FROM (
    SELECT wk::date AS week,
      (SELECT count(*) FROM public.users u WHERE u.tenant_id = v_tenant AND u.role = 'student'
          AND u.created_at >= wk AND u.created_at < wk + interval '1 week') AS new_students,
      (SELECT count(*) FROM public.exam_submissions s WHERE s.tenant_id = v_tenant
          AND s.submitted_at >= wk AND s.submitted_at < wk + interval '1 week') AS submissions,
      (SELECT count(*) FROM public.student_progress sp WHERE sp.tenant_id = v_tenant
          AND sp.completed_at >= wk AND sp.completed_at < wk + interval '1 week') AS completed_items,
      (SELECT round(100.0 * count(*) FILTER (WHERE ar.status IN ('present', 'late'))
                / NULLIF(count(*) FILTER (WHERE ar.status <> 'excused'), 0), 1)
         FROM public.attendance_records ar
         JOIN public.attendance_sessions s ON s.id = ar.session_id
        WHERE ar.tenant_id = v_tenant
          AND s.session_date >= wk::date AND s.session_date < (wk + interval '1 week')::date) AS attendance_rate
    FROM generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()), interval '1 week') wk
  ) r;

  -- ── Timetable ─────────────────────────────────────────────
  SELECT jsonb_build_object(
    'schedules',           (SELECT count(*) FROM public.schedules sc WHERE sc.tenant_id = v_tenant AND sc.kind = 'group'),
    'published_schedules', (SELECT count(*) FROM public.schedules sc WHERE sc.tenant_id = v_tenant AND sc.kind = 'group' AND sc.is_published),
    'groups_without_schedule', (SELECT count(*) FROM public.groups g
                                WHERE g.tenant_id = v_tenant AND g.deleted_at IS NULL AND g.is_active
                                  AND NOT EXISTS (SELECT 1 FROM public.schedules sc WHERE sc.group_id = g.id)),
    'weekly_slots', (SELECT count(*) FROM public.schedule_slots sl
                     JOIN public.schedules sc ON sc.id = sl.schedule_id AND sc.kind = 'group'
                     WHERE sl.tenant_id = v_tenant),
    'weekly_hours', (SELECT COALESCE(round(sum(extract(epoch FROM (sl.end_time - sl.start_time))) / 3600.0, 1), 0)
                     FROM public.schedule_slots sl
                     JOIN public.schedules sc ON sc.id = sl.schedule_id AND sc.kind = 'group'
                     WHERE sl.tenant_id = v_tenant),
    'teacher_conflicts', (SELECT count(*) FROM public.schedule_slots a
                          JOIN public.schedule_slots b
                            ON a.teacher_id = b.teacher_id AND a.day_of_week = b.day_of_week AND a.id < b.id
                           AND a.start_time < b.end_time AND b.start_time < a.end_time
                          WHERE a.tenant_id = v_tenant AND b.tenant_id = v_tenant AND a.teacher_id IS NOT NULL)
  ) INTO v_sched;

  -- ── Engagement & workload ─────────────────────────────────
  SELECT jsonb_build_object(
    'announcements_live', (SELECT count(*) FROM public.announcements a WHERE a.tenant_id = v_tenant AND a.is_published
                            AND (a.starts_at IS NULL OR a.starts_at <= now()) AND (a.ends_at IS NULL OR a.ends_at >= now())),
    'announcements_scheduled', (SELECT count(*) FROM public.announcements a WHERE a.tenant_id = v_tenant
                                 AND a.is_published AND a.starts_at > now()),
    'survey_responses', (SELECT count(*) FROM public.survey_responses sr WHERE sr.tenant_id = v_tenant AND sr.submitted_at >= v_from),
    'survey_ease_avg',  (SELECT round(avg(sr.ease_rating), 2) FROM public.survey_responses sr WHERE sr.tenant_id = v_tenant AND sr.submitted_at >= v_from),
    'survey_recommend_pct', (SELECT round(100.0 * avg(CASE WHEN sr.recommend THEN 1 ELSE 0 END), 1)
                             FROM public.survey_responses sr WHERE sr.tenant_id = v_tenant AND sr.submitted_at >= v_from AND sr.recommend IS NOT NULL),
    'open_requests',   (SELECT count(*) FROM public.staff_requests r WHERE r.tenant_id = v_tenant AND r.status IN ('pending', 'accepted')),
    'pending_appeals', (SELECT count(*) FROM public.exam_appeals ap WHERE ap.tenant_id = v_tenant AND ap.status = 'pending')
  ) INTO v_engage;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'period_days',  v_days,
    'people',       v_people,
    'groups',       v_groups,
    'learning',     v_learning,
    'assessments',  v_assess,
    'attendance',   v_attend,
    'group_rows',   v_group_rows,
    'teacher_rows', v_teacher_rows,
    'trend',        v_trend,
    'schedule',     v_sched,
    'engagement',   v_engage
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_center_dashboard(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_center_dashboard(integer) TO authenticated;
-- EduQuest had no academic structure at all (no faculties/departments, no
-- stages/grades, no semesters). One generic shape serves every institution
-- type; the UI names each level from src/lib/terminology.ts:
--   university → Faculty › Department      school → Stage › Grade
--   institute  → Division › Program       training_center → Track › Program
--   company    → Department › Unit
--
-- Tables
--   academic_units  — level 1 (parent_id NULL) or level 2 (parent = a level-1 unit)
--   academic_terms  — named date ranges; at most one is_current per tenant
--   groups.academic_unit_id, groups.term_id, courses.academic_unit_id — nullable links
--
-- Security (same shape as schedules / announcements):
--   * SELECT policy only, tenant-scoped, archived rows hidden.
--   * Table writes revoked from anon/authenticated — all writes go through
--     /api/academic/* which checks `manage_academic_structure` with the user
--     session and then writes with the service-role client.
--   * Triggers reject any cross-tenant link (parent unit, group→unit/term,
--     course→unit) even for the service role — the lesson from
--     fix_rls_write_path_migration.sql: never trust a foreign id's tenant.
--
-- Nothing existing changes behaviour: new columns are NULL, new tables empty.
-- Idempotent — safe to re-run.
-- =============================================================================

-- ── Academic structure (academic_structure_migration.sql) ─────────────────
-- EduQuest had no academic structure at all (no faculties/departments, no
-- stages/grades, no semesters). One generic shape serves every institution
-- type; the UI names each level from src/lib/terminology.ts:
--   university → Faculty › Department      school → Stage › Grade
--   institute  → Division › Program       training_center → Track › Program
--   company    → Department › Unit
--
-- Tables
--   academic_units  — level 1 (parent_id NULL) or level 2 (parent = a level-1 unit)
--   academic_terms  — named date ranges; at most one is_current per tenant
--   groups.academic_unit_id, groups.term_id, courses.academic_unit_id — nullable links
--
-- Security (same shape as schedules / announcements):
--   * SELECT policy only, tenant-scoped, archived rows hidden.
--   * Table writes revoked from anon/authenticated — all writes go through
--     /api/academic/* which checks `manage_academic_structure` with the user
--     session and then writes with the service-role client.
--   * Triggers reject any cross-tenant link (parent unit, group→unit/term,
--     course→unit) even for the service role — the lesson from
--     fix_rls_write_path_migration.sql: never trust a foreign id's tenant.
--
-- OPT-IN PER TENANT — tenants.structure_mode:
--   'flat'     (DEFAULT) the original structure: groups + courses only. The
--              academic structure is invisible and every write to it — new
--              units/terms, or linking a group/course — is rejected here in
--              the DB, not only in the UI/API.
--   'academic' faculties/departments + terms enabled. Set by super_admin only.
-- Switching back to 'flat' hides everything without deleting anything;
-- switching to 'academic' again brings it all back as it was.
--
-- Nothing existing changes behaviour: every tenant starts 'flat', new columns
-- are NULL, new tables empty.
-- Idempotent — safe to re-run.
-- =============================================================================

-- ── tenants.structure_mode ───────────────────────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS structure_mode TEXT NOT NULL DEFAULT 'flat';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_structure_mode_check') THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_structure_mode_check CHECK (structure_mode IN ('flat', 'academic'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.assert_tenant_academic_mode(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tenants WHERE id = p_tenant_id AND structure_mode = 'academic'
  ) THEN
    RAISE EXCEPTION 'academic structure is not enabled for this tenant' USING ERRCODE = '55000';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assert_tenant_academic_mode(UUID) FROM PUBLIC, anon, authenticated;

-- Units and terms can only be created or edited while the tenant is 'academic'.
CREATE OR REPLACE FUNCTION public.academic_rows_require_mode()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_tenant_academic_mode(NEW.tenant_id);
  RETURN NEW;
END;
$$;

-- ── academic_units ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.academic_units (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  parent_id   UUID REFERENCES public.academic_units(id) ON DELETE CASCADE,
  level       SMALLINT NOT NULL CHECK (level IN (1, 2)),
  name        TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  code        TEXT CHECK (code IS NULL OR char_length(code) <= 30),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT academic_units_level_parent_check
    CHECK ((level = 1 AND parent_id IS NULL) OR (level = 2 AND parent_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_academic_units_tenant ON public.academic_units (tenant_id, level, sort_order)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_academic_units_parent ON public.academic_units (parent_id);

CREATE OR REPLACE FUNCTION public.academic_units_check_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p RECORD;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT tenant_id, level INTO p FROM public.academic_units WHERE id = NEW.parent_id;
  IF NOT FOUND OR p.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'academic unit parent must belong to the same tenant' USING ERRCODE = '42501';
  END IF;
  IF p.level <> 1 THEN
    RAISE EXCEPTION 'academic unit parent must be a level-1 unit' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_academic_units_check_parent ON public.academic_units;
CREATE TRIGGER trg_academic_units_check_parent
  BEFORE INSERT OR UPDATE OF parent_id, tenant_id ON public.academic_units
  FOR EACH ROW EXECUTE FUNCTION public.academic_units_check_parent();

DROP TRIGGER IF EXISTS trg_academic_units_require_mode ON public.academic_units;
CREATE TRIGGER trg_academic_units_require_mode
  BEFORE INSERT OR UPDATE ON public.academic_units
  FOR EACH ROW EXECUTE FUNCTION public.academic_rows_require_mode();

-- ── academic_terms ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.academic_terms (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  starts_on   DATE NOT NULL,
  ends_on     DATE NOT NULL,
  is_current  BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT academic_terms_dates_check CHECK (ends_on > starts_on)
);

CREATE INDEX IF NOT EXISTS idx_academic_terms_tenant ON public.academic_terms (tenant_id, starts_on DESC)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_academic_terms_one_current
  ON public.academic_terms (tenant_id) WHERE is_current AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_academic_terms_require_mode ON public.academic_terms;
CREATE TRIGGER trg_academic_terms_require_mode
  BEFORE INSERT OR UPDATE ON public.academic_terms
  FOR EACH ROW EXECUTE FUNCTION public.academic_rows_require_mode();

-- ── links from existing tables ───────────────────────────────────────────────
ALTER TABLE public.groups  ADD COLUMN IF NOT EXISTS academic_unit_id UUID REFERENCES public.academic_units(id) ON DELETE SET NULL;
ALTER TABLE public.groups  ADD COLUMN IF NOT EXISTS term_id          UUID REFERENCES public.academic_terms(id) ON DELETE SET NULL;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS academic_unit_id UUID REFERENCES public.academic_units(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_groups_academic_unit_id  ON public.groups (academic_unit_id);
CREATE INDEX IF NOT EXISTS idx_groups_term_id           ON public.groups (term_id);
CREATE INDEX IF NOT EXISTS idx_courses_academic_unit_id ON public.courses (academic_unit_id);

CREATE OR REPLACE FUNCTION public.check_academic_links_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_term UUID;
  v_old_term UUID;
  v_old_unit UUID;
BEGIN
  IF TG_TABLE_NAME = 'groups' THEN
    v_new_term := NEW.term_id;
    IF TG_OP = 'UPDATE' THEN v_old_term := OLD.term_id; END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN v_old_unit := OLD.academic_unit_id; END IF;

  -- Setting a NEW non-null link needs academic mode. Clearing a link, or
  -- leaving an existing one untouched (e.g. after reverting to 'flat'), is fine.
  IF (NEW.academic_unit_id IS NOT NULL AND NEW.academic_unit_id IS DISTINCT FROM v_old_unit)
     OR (v_new_term IS NOT NULL AND v_new_term IS DISTINCT FROM v_old_term) THEN
    PERFORM public.assert_tenant_academic_mode(NEW.tenant_id);
  END IF;

  IF NEW.academic_unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.academic_units
    WHERE id = NEW.academic_unit_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'academic unit must belong to the same tenant' USING ERRCODE = '42501';
  END IF;

  IF v_new_term IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.academic_terms
    WHERE id = v_new_term AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'academic term must belong to the same tenant' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_groups_academic_links ON public.groups;
CREATE TRIGGER trg_groups_academic_links
  BEFORE INSERT OR UPDATE OF academic_unit_id, term_id, tenant_id ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.check_academic_links_tenant();

DROP TRIGGER IF EXISTS trg_courses_academic_links ON public.courses;
CREATE TRIGGER trg_courses_academic_links
  BEFORE INSERT OR UPDATE OF academic_unit_id, tenant_id ON public.courses
  FOR EACH ROW EXECUTE FUNCTION public.check_academic_links_tenant();

-- Trigger-only functions: never directly callable
-- (revoke_trigger_function_public_execute_migration.sql pattern).
REVOKE EXECUTE ON FUNCTION public.academic_units_check_parent()  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.academic_rows_require_mode()   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_academic_links_tenant() FROM PUBLIC, anon, authenticated;

-- ── RLS: read-only, tenant-scoped ────────────────────────────────────────────
ALTER TABLE public.academic_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS academic_units_select ON public.academic_units;
CREATE POLICY academic_units_select ON public.academic_units FOR SELECT USING (
  deleted_at IS NULL AND (
    tenant_id = (SELECT current_tenant_id())
    OR (SELECT current_user_role()) = 'super_admin'
  )
);

DROP POLICY IF EXISTS academic_terms_select ON public.academic_terms;
CREATE POLICY academic_terms_select ON public.academic_terms FOR SELECT USING (
  deleted_at IS NULL AND (
    tenant_id = (SELECT current_tenant_id())
    OR (SELECT current_user_role()) = 'super_admin'
  )
);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.academic_units FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.academic_terms FROM anon, authenticated;
REVOKE ALL ON public.academic_units FROM anon;
REVOKE ALL ON public.academic_terms FROM anon;
GRANT SELECT ON public.academic_units TO authenticated;
GRANT SELECT ON public.academic_terms TO authenticated;

-- ── Centre manager requires a centre (institution_type_migration.sql) ───────
CREATE OR REPLACE FUNCTION public.users_center_manager_requires_center()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role = 'center_manager'
     AND (TG_OP = 'INSERT' OR OLD.role IS DISTINCT FROM NEW.role OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id)
     AND EXISTS (SELECT 1 FROM public.tenants WHERE id = NEW.tenant_id AND has_center = FALSE)
  THEN
    RAISE EXCEPTION 'this institution has no continuing-education centre' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_center_manager_requires_center ON public.users;
CREATE TRIGGER trg_users_center_manager_requires_center
  BEFORE INSERT OR UPDATE OF role, tenant_id ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_center_manager_requires_center();

REVOKE EXECUTE ON FUNCTION public.users_center_manager_requires_center() FROM PUBLIC, anon, authenticated;

-- ── Groups ↔ courses + transfers (group_course_transfer_migration.sql) ─────
-- Does NOT touch the curriculum: courses, levels, units, items, student_progress
-- and the course player are read, never altered.
--
-- 1. groups.course_id (optional) — a group MAY be a section of one course. A
--    student sees a group under a course only when BOTH hold: the group is
--    linked to that course AND the student is a member. Membership in both a
--    course and an unlinked group never implies a link. Adding a student to a
--    linked group also enrols them in the course (done in /api/group-students).
-- 2. groups.image_url, groups.max_students (NULL = no cap), groups.instructions.
-- 3. group_transfers — append-only history of moves between groups. When the
--    move changes course, the old course's progress is snapshotted here at the
--    moment of transfer (frozen_*) and the old enrolment is removed, so nothing
--    the student does later is ever counted on the old course and nothing old is
--    counted on the new one. student_progress rows are kept untouched.
-- 4. transfer_student_group() — does the whole move atomically. Service role
--    only (called by /api/group-transfers after the capability check).
--
-- Nothing existing changes behaviour: new columns are NULL, new table empty.
-- Idempotent — safe to re-run.
-- =============================================================================

-- ── 1–2. group columns ───────────────────────────────────────────────────────
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS course_id    UUID REFERENCES public.courses(id) ON DELETE SET NULL;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS image_url    TEXT;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS max_students INTEGER;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS instructions TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'groups_max_students_check') THEN
    ALTER TABLE public.groups ADD CONSTRAINT groups_max_students_check CHECK (max_students IS NULL OR max_students > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'groups_instructions_len_check') THEN
    ALTER TABLE public.groups ADD CONSTRAINT groups_instructions_len_check CHECK (instructions IS NULL OR char_length(instructions) <= 2000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'groups_image_url_check') THEN
    ALTER TABLE public.groups ADD CONSTRAINT groups_image_url_check CHECK (image_url IS NULL OR image_url ~ '^https://');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_groups_course_id ON public.groups (course_id);

CREATE OR REPLACE FUNCTION public.check_group_course_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.course_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.courses WHERE id = NEW.course_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'group course must belong to the same tenant' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_groups_course_tenant ON public.groups;
CREATE TRIGGER trg_groups_course_tenant
  BEFORE INSERT OR UPDATE OF course_id, tenant_id ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.check_group_course_tenant();

REVOKE EXECUTE ON FUNCTION public.check_group_course_tenant() FROM PUBLIC, anon, authenticated;

-- ── 3. transfer history ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.group_transfers (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  student_id          UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  from_group_id       UUID REFERENCES public.groups(id) ON DELETE SET NULL,
  to_group_id         UUID REFERENCES public.groups(id) ON DELETE SET NULL,
  from_course_id      UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  to_course_id        UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  -- Name snapshots: history must still read correctly after a rename or delete.
  from_group_name     TEXT NOT NULL,
  to_group_name       TEXT NOT NULL,
  from_course_title   TEXT,
  to_course_title     TEXT,
  -- Old course progress frozen at the moment of transfer (only when the course changed).
  course_changed      BOOLEAN NOT NULL DEFAULT FALSE,
  frozen_completed    INTEGER,
  frozen_total        INTEGER,
  reason              TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  transferred_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_transfers_student ON public.group_transfers (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_transfers_tenant  ON public.group_transfers (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_transfers_from_group  ON public.group_transfers (from_group_id);
CREATE INDEX IF NOT EXISTS idx_group_transfers_to_group    ON public.group_transfers (to_group_id);
CREATE INDEX IF NOT EXISTS idx_group_transfers_from_course ON public.group_transfers (from_course_id);
CREATE INDEX IF NOT EXISTS idx_group_transfers_to_course   ON public.group_transfers (to_course_id);
CREATE INDEX IF NOT EXISTS idx_group_transfers_by          ON public.group_transfers (transferred_by);

ALTER TABLE public.group_transfers ENABLE ROW LEVEL SECURITY;

-- The student reads their own history; staff read their tenant's. No write policy.
DROP POLICY IF EXISTS group_transfers_select ON public.group_transfers;
CREATE POLICY group_transfers_select ON public.group_transfers FOR SELECT USING (
  student_id = (SELECT auth.uid())
  OR (SELECT current_user_role()) = 'super_admin'
  OR ( (SELECT current_user_role()) IN ('university_admin', 'center_manager')
       AND tenant_id = (SELECT current_tenant_id()) )
);

REVOKE ALL ON public.group_transfers FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.group_transfers FROM authenticated;
GRANT SELECT ON public.group_transfers TO authenticated;

-- ── 4. atomic transfer ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_student_group(
  p_actor      UUID,
  p_student_id UUID,
  p_from_group UUID,
  p_to_group   UUID,
  p_reason     TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor    RECORD;
  v_student  RECORD;
  v_from     RECORD;
  v_to       RECORD;
  v_count    INTEGER;
  v_changed  BOOLEAN;
  v_total    INTEGER;
  v_done     INTEGER;
  v_from_title TEXT;
  v_to_title   TEXT;
  v_id       UUID;
BEGIN
  -- Re-derive every fact; never trust the caller (r1_defense_in_depth pattern).
  SELECT role, tenant_id, is_active INTO v_actor FROM public.users WHERE id = p_actor;
  IF NOT FOUND OR v_actor.is_active IS NOT TRUE
     OR v_actor.role NOT IN ('super_admin', 'university_admin', 'center_manager') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT role, tenant_id INTO v_student FROM public.users WHERE id = p_student_id;
  IF NOT FOUND OR v_student.role <> 'student' THEN
    RAISE EXCEPTION 'STUDENT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_actor.role <> 'super_admin' AND v_actor.tenant_id IS DISTINCT FROM v_student.tenant_id THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF p_from_group = p_to_group THEN
    RAISE EXCEPTION 'SAME_GROUP' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;

  SELECT id, name, tenant_id, course_id INTO v_from FROM public.groups WHERE id = p_from_group;
  -- Lock the destination so two concurrent transfers can't both take the last seat.
  SELECT id, name, tenant_id, course_id, is_active, max_students INTO v_to
    FROM public.groups WHERE id = p_to_group FOR UPDATE;
  IF v_from.id IS NULL OR v_to.id IS NULL
     OR v_from.tenant_id <> v_student.tenant_id OR v_to.tenant_id <> v_student.tenant_id THEN
    RAISE EXCEPTION 'GROUP_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_to.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'GROUP_ARCHIVED' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.group_students WHERE group_id = p_from_group AND student_id = p_student_id) THEN
    RAISE EXCEPTION 'NOT_IN_GROUP' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.group_students WHERE group_id = p_to_group AND student_id = p_student_id) THEN
    RAISE EXCEPTION 'ALREADY_IN_GROUP' USING ERRCODE = '23505';
  END IF;
  IF v_to.max_students IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count FROM public.group_students WHERE group_id = p_to_group;
    IF v_count >= v_to.max_students THEN
      RAISE EXCEPTION 'GROUP_FULL' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_changed := v_from.course_id IS NOT NULL AND v_from.course_id IS DISTINCT FROM v_to.course_id;

  IF v_from.course_id IS NOT NULL THEN
    SELECT title INTO v_from_title FROM public.courses WHERE id = v_from.course_id;
  END IF;
  IF v_to.course_id IS NOT NULL THEN
    SELECT title INTO v_to_title FROM public.courses WHERE id = v_to.course_id;
  END IF;

  IF v_changed THEN
    -- Same counting rule as get_course_progress (read-only).
    SELECT COUNT(*) INTO v_total
      FROM public.unit_items ui JOIN public.course_units cu ON cu.id = ui.unit_id
     WHERE cu.course_id = v_from.course_id AND ui.is_published = TRUE;
    SELECT COUNT(*) INTO v_done
      FROM public.student_progress sp
      JOIN public.unit_items ui   ON ui.id = sp.unit_item_id
      JOIN public.course_units cu ON cu.id = ui.unit_id
     WHERE cu.course_id = v_from.course_id AND sp.student_id = p_student_id AND ui.is_published = TRUE;
  END IF;

  DELETE FROM public.group_students WHERE group_id = p_from_group AND student_id = p_student_id;
  INSERT INTO public.group_students (group_id, student_id) VALUES (p_to_group, p_student_id);

  IF v_to.course_id IS NOT NULL THEN
    INSERT INTO public.course_enrollments (course_id, student_id, tenant_id)
    VALUES (v_to.course_id, p_student_id, v_student.tenant_id)
    ON CONFLICT (course_id, student_id) DO NOTHING;
  END IF;

  -- Leaving the old course: its progress is frozen in the history row above.
  -- The enrolment goes; student_progress rows stay exactly as they were.
  IF v_changed THEN
    DELETE FROM public.course_enrollments WHERE course_id = v_from.course_id AND student_id = p_student_id;
  END IF;

  INSERT INTO public.group_transfers (
    tenant_id, student_id, from_group_id, to_group_id, from_course_id, to_course_id,
    from_group_name, to_group_name, from_course_title, to_course_title,
    course_changed, frozen_completed, frozen_total, reason, transferred_by
  ) VALUES (
    v_student.tenant_id, p_student_id, p_from_group, p_to_group, v_from.course_id, v_to.course_id,
    v_from.name, v_to.name, v_from_title, v_to_title,
    v_changed, CASE WHEN v_changed THEN v_done END, CASE WHEN v_changed THEN v_total END,
    btrim(p_reason), p_actor
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.transfer_student_group(UUID, UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_student_group(UUID, UUID, UUID, UUID, TEXT) TO service_role;

-- ── Institutional mailbox linking (mail_connections_migration.sql) ─────────
-- A staff member (centre manager / university admin) links THEIR OWN mailbox
-- through Google's own OAuth popup; the platform never sees the password. Only
-- the `gmail.send` scope is requested (plus openid/email to learn the address):
-- the app can send as the user, never read their mail.
--
-- mail_connections — one row per user+provider. Tokens are AES-256-GCM
--   encrypted by the app (MAIL_TOKEN_ENCRYPTION_KEY) before they reach the DB.
--   NO policies at all and every grant revoked: not even the owner can read
--   the row through PostgREST. Status is served by /api/mail/connection.
-- mail_messages — send log (who sent what to whom, result). Tenant staff and
--   the sender may read it; writes are service-role only.
--
-- Idempotent — safe to re-run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.mail_connections (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tenant_id          UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider           TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  email              TEXT NOT NULL,
  refresh_token_enc  TEXT NOT NULL,
  access_token_enc   TEXT,
  access_expires_at  TIMESTAMPTZ,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'error')),
  last_error         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_mail_connections_tenant ON public.mail_connections (tenant_id);

ALTER TABLE public.mail_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mail_connections FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.mail_messages (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sender_id      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  connection_id  UUID REFERENCES public.mail_connections(id) ON DELETE SET NULL,
  from_email     TEXT NOT NULL,
  recipient_id   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  to_email       TEXT NOT NULL,
  subject        TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_messages_tenant     ON public.mail_messages (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_messages_sender     ON public.mail_messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_mail_messages_connection ON public.mail_messages (connection_id);
CREATE INDEX IF NOT EXISTS idx_mail_messages_recipient  ON public.mail_messages (recipient_id);

ALTER TABLE public.mail_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mail_messages_select ON public.mail_messages;
CREATE POLICY mail_messages_select ON public.mail_messages FOR SELECT USING (
  sender_id = (SELECT auth.uid())
  OR (SELECT current_user_role()) = 'super_admin'
  OR ( (SELECT current_user_role()) IN ('university_admin', 'center_manager')
       AND tenant_id = (SELECT current_tenant_id()) )
);

REVOKE ALL ON public.mail_messages FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.mail_messages FROM authenticated;
GRANT SELECT ON public.mail_messages TO authenticated;
