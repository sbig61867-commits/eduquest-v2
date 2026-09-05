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
  created_at  TIMESTAMPTZ DEFAULT NOW()
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
  permissions        JSONB NOT NULL DEFAULT '{}'::jsonb
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

-- TENANTS: super_admin sees all; others see only their own
CREATE POLICY "tenants_select" ON tenants FOR SELECT USING (
  current_user_role() = 'super_admin' OR id = current_tenant_id()
);
CREATE POLICY "tenants_manage" ON tenants FOR ALL USING (
  current_user_role() = 'super_admin'
);

-- USERS: super_admin sees all; others see users in same tenant
CREATE POLICY "users_select" ON users FOR SELECT USING (
  current_user_role() = 'super_admin' OR tenant_id = current_tenant_id() OR id = auth.uid()
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
      AND permissions IS NOT DISTINCT FROM
                      (SELECT u.permissions FROM users u WHERE u.id = auth.uid())
      AND can_create_courses IS NOT DISTINCT FROM
                      (SELECT u.can_create_courses FROM users u WHERE u.id = auth.uid())
    )
  );

-- GROUPS: scoped to tenant; teacher manages their own
CREATE POLICY "groups_select" ON groups FOR SELECT USING (
  current_user_role() = 'super_admin' OR tenant_id = current_tenant_id()
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
CREATE POLICY "submissions_insert" ON exam_submissions FOR INSERT WITH CHECK (
  student_id = auth.uid() AND tenant_id = current_tenant_id()
);

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
CREATE POLICY "grades_insert" ON grades FOR INSERT WITH CHECK (
  current_user_role() IN ('teacher','university_admin','super_admin') AND
  tenant_id = current_tenant_id()
);

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
