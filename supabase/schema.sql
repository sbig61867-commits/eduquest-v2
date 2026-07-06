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
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT UNIQUE NOT NULL,
  full_name   TEXT NOT NULL,
  avatar_url  TEXT,
  role        TEXT NOT NULL CHECK (role IN ('super_admin','university_admin','teacher','student')),
  tenant_id   UUID REFERENCES tenants(id) ON DELETE SET NULL,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
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
CREATE POLICY "users_update" ON users FOR UPDATE USING (
  current_user_role() = 'super_admin' OR
  (current_user_role() = 'university_admin' AND tenant_id = current_tenant_id()) OR
  id = auth.uid()
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

-- LESSONS: published lessons visible to students in same tenant
CREATE POLICY "lessons_select" ON lessons FOR SELECT USING (
  current_user_role() = 'super_admin' OR
  tenant_id = current_tenant_id()
);
CREATE POLICY "lessons_insert" ON lessons FOR INSERT WITH CHECK (
  current_user_role() IN ('teacher','university_admin','super_admin') AND
  tenant_id = current_tenant_id()
);
CREATE POLICY "lessons_update" ON lessons FOR UPDATE USING (
  current_user_role() = 'super_admin' OR
  (current_user_role() = 'teacher' AND teacher_id = auth.uid())
);

-- EXAMS: same pattern as lessons
-- Students do NOT get direct row access (questions JSONB embeds correct_answer);
-- they read exams only via get_student_exams() which strips the answers.
-- See exam_answer_leak_fix_migration.sql.
CREATE POLICY "exams_select" ON exams FOR SELECT USING (
  current_user_role() = 'super_admin'
  OR (current_user_role() = 'university_admin' AND tenant_id = current_tenant_id())
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

-- SUBMISSIONS: student sees own; teacher sees only their own exams' submissions; admin sees tenant
CREATE POLICY "submissions_select" ON exam_submissions FOR SELECT USING (
  current_user_role() = 'super_admin' OR
  student_id = auth.uid() OR
  (current_user_role() = 'university_admin' AND tenant_id = current_tenant_id()) OR
  (current_user_role() = 'teacher' AND EXISTS (
     SELECT 1 FROM exams
     WHERE exams.id = exam_submissions.exam_id
       AND exams.teacher_id = auth.uid()
  ))
);
CREATE POLICY "submissions_insert" ON exam_submissions FOR INSERT WITH CHECK (
  student_id = auth.uid() AND tenant_id = current_tenant_id()
);

-- GRADES
CREATE POLICY "grades_select" ON grades FOR SELECT USING (
  current_user_role() = 'super_admin' OR
  student_id = auth.uid() OR
  tenant_id = current_tenant_id()
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
