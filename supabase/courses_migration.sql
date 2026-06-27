-- ============================================================
-- Continuing Education Center — Courses Migration
-- Run in Supabase SQL Editor AFTER phase1_migration.sql
-- ============================================================

-- ============================================================
-- 1. COURSES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS courses (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  teacher_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT,
  thumbnail_url   TEXT,
  language        TEXT,                      -- e.g. 'English', 'Arabic'
  has_levels      BOOLEAN NOT NULL DEFAULT TRUE,  -- FALSE = flat (units only, no levels)
  is_published    BOOLEAN NOT NULL DEFAULT FALSE,
  source_text     TEXT,                          -- extracted text of the imported file; AI content is generated strictly from this
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. COURSE LEVELS (Months / Stages)
-- ============================================================
CREATE TABLE IF NOT EXISTS course_levels (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id    UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,               -- e.g. "Month 1 – Beginner"
  order_index  INTEGER NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(course_id, order_index)
);

-- ============================================================
-- 3. COURSE UNITS (Within each Level)
-- ============================================================
CREATE TABLE IF NOT EXISTS course_units (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  level_id     UUID REFERENCES course_levels(id) ON DELETE CASCADE, -- NULL for flat courses
  course_id    UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,               -- e.g. "Unit 3 – Daily Routines"
  order_index  INTEGER NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 4. UNIT ITEMS (Content blocks inside each Unit)
--    type: grammar | idioms | rules | task | quiz | video | text
-- ============================================================
CREATE TABLE IF NOT EXISTS unit_items (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  unit_id      UUID NOT NULL REFERENCES course_units(id) ON DELETE CASCADE,
  course_id    UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('grammar','idioms','rules','task','quiz','video','text')),
  title        TEXT NOT NULL,
  content      JSONB NOT NULL DEFAULT '{}', -- flexible per type
  order_index  INTEGER NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(unit_id, order_index)
);

-- ============================================================
-- 5. COURSE ENROLLMENTS
--    Students can be external (not necessarily in a group)
-- ============================================================
CREATE TABLE IF NOT EXISTS course_enrollments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(course_id, student_id)
);

-- ============================================================
-- 6. STUDENT PROGRESS (Which items the student completed)
-- ============================================================
CREATE TABLE IF NOT EXISTS student_progress (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  unit_item_id UUID NOT NULL REFERENCES unit_items(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, unit_item_id)
);

-- ============================================================
-- 7. UNIT QUIZ SUBMISSIONS
--    Answers and scores for quizzes inside units
-- ============================================================
CREATE TABLE IF NOT EXISTS unit_quiz_submissions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  unit_item_id UUID NOT NULL REFERENCES unit_items(id) ON DELETE CASCADE,
  student_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  answers      JSONB NOT NULL DEFAULT '{}',
  score        NUMERIC,
  max_score    NUMERIC,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(unit_item_id, student_id)  -- one submission per quiz per student
);

-- ============================================================
-- 8. EXAM RETAKE PERMISSIONS
--    Owner/admin grants specific students a retake
-- ============================================================
CREATE TABLE IF NOT EXISTS exam_retake_permissions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  exam_id     UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  granted_by  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(exam_id, student_id)
);

-- ============================================================
-- 9. MODIFY EXISTING TABLES
-- ============================================================

-- Add course creation permission flag to teachers
-- Granted by university_admin or super_admin
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS can_create_courses BOOLEAN NOT NULL DEFAULT FALSE;

-- exams: group_id was NOT NULL — relax it so course exams don't need a group
ALTER TABLE exams
  ALTER COLUMN group_id DROP NOT NULL;

-- Add optional course_id for continuing education exams
ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS course_id UUID REFERENCES courses(id) ON DELETE CASCADE;

-- Ensure exam belongs to either a group or a course, not both, not neither
ALTER TABLE exams DROP CONSTRAINT IF EXISTS exam_must_belong_to_group_or_course;
ALTER TABLE exams ADD CONSTRAINT exam_must_belong_to_group_or_course
  CHECK (
    (group_id IS NOT NULL AND course_id IS NULL) OR
    (group_id IS NULL  AND course_id IS NOT NULL)
  );

-- exam_submissions: add grading_status for manual review workflow
ALTER TABLE exam_submissions
  ADD COLUMN IF NOT EXISTS grading_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (grading_status IN ('pending', 'reviewing', 'published'));

-- invitations: add optional course_id for course enrollment via link
ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS course_id UUID REFERENCES courses(id) ON DELETE SET NULL;

-- ============================================================
-- 10. INDEXES FOR PERFORMANCE
-- ============================================================
-- Partial unique indexes for course_units order (handles nullable level_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_course_units_order_leveled
  ON course_units(level_id, order_index)
  WHERE level_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_course_units_order_flat
  ON course_units(course_id, order_index)
  WHERE level_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_courses_tenant         ON courses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_courses_teacher        ON courses(teacher_id);
CREATE INDEX IF NOT EXISTS idx_course_levels_course   ON course_levels(course_id);
CREATE INDEX IF NOT EXISTS idx_course_units_level     ON course_units(level_id);
CREATE INDEX IF NOT EXISTS idx_unit_items_unit        ON unit_items(unit_id);
CREATE INDEX IF NOT EXISTS idx_course_enrollments_student ON course_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_course_enrollments_course  ON course_enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_student_progress_student   ON student_progress(student_id);
CREATE INDEX IF NOT EXISTS idx_unit_quiz_submissions_student ON unit_quiz_submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_exam_retake_exam_student ON exam_retake_permissions(exam_id, student_id);

-- ============================================================
-- 11. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE courses                ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_levels          ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_units           ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_enrollments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_progress       ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_quiz_submissions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_retake_permissions ENABLE ROW LEVEL SECURITY;

-- ── courses ──────────────────────────────────────────────────
CREATE POLICY "courses_select" ON courses FOR SELECT
  USING (
    current_user_role() = 'super_admin' OR
    tenant_id = current_tenant_id()
  );

CREATE POLICY "courses_insert" ON courses FOR INSERT
  WITH CHECK (
    tenant_id = current_tenant_id() AND (
      current_user_role() = 'super_admin' OR
      current_user_role() = 'university_admin' OR
      (current_user_role() = 'teacher' AND
        EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND can_create_courses = TRUE))
    )
  );

CREATE POLICY "courses_update" ON courses FOR UPDATE
  USING (
    current_user_role() = 'super_admin' OR
    (current_user_role() IN ('teacher','university_admin') AND tenant_id = current_tenant_id() AND
     (current_user_role() = 'university_admin' OR teacher_id = auth.uid()))
  );

CREATE POLICY "courses_delete" ON courses FOR DELETE
  USING (
    current_user_role() = 'super_admin' OR
    (current_user_role() IN ('teacher','university_admin') AND tenant_id = current_tenant_id() AND
     (current_user_role() = 'university_admin' OR teacher_id = auth.uid()))
  );

-- ── course_levels ─────────────────────────────────────────────
CREATE POLICY "course_levels_select" ON course_levels FOR SELECT
  USING (current_user_role() = 'super_admin' OR tenant_id = current_tenant_id());

CREATE POLICY "course_levels_insert" ON course_levels FOR INSERT
  WITH CHECK (
    current_user_role() IN ('teacher','university_admin','super_admin') AND
    tenant_id = current_tenant_id()
  );

CREATE POLICY "course_levels_update" ON course_levels FOR UPDATE
  USING (current_user_role() IN ('teacher','university_admin','super_admin') AND tenant_id = current_tenant_id());

CREATE POLICY "course_levels_delete" ON course_levels FOR DELETE
  USING (current_user_role() IN ('teacher','university_admin','super_admin') AND tenant_id = current_tenant_id());

-- ── course_units ──────────────────────────────────────────────
CREATE POLICY "course_units_select" ON course_units FOR SELECT
  USING (current_user_role() = 'super_admin' OR tenant_id = current_tenant_id());

CREATE POLICY "course_units_insert" ON course_units FOR INSERT
  WITH CHECK (current_user_role() IN ('teacher','university_admin','super_admin') AND tenant_id = current_tenant_id());

CREATE POLICY "course_units_update" ON course_units FOR UPDATE
  USING (current_user_role() IN ('teacher','university_admin','super_admin') AND tenant_id = current_tenant_id());

CREATE POLICY "course_units_delete" ON course_units FOR DELETE
  USING (current_user_role() IN ('teacher','university_admin','super_admin') AND tenant_id = current_tenant_id());

-- ── unit_items ────────────────────────────────────────────────
CREATE POLICY "unit_items_select" ON unit_items FOR SELECT
  USING (current_user_role() = 'super_admin' OR tenant_id = current_tenant_id());

CREATE POLICY "unit_items_insert" ON unit_items FOR INSERT
  WITH CHECK (current_user_role() IN ('teacher','university_admin','super_admin') AND tenant_id = current_tenant_id());

CREATE POLICY "unit_items_update" ON unit_items FOR UPDATE
  USING (current_user_role() IN ('teacher','university_admin','super_admin') AND tenant_id = current_tenant_id());

CREATE POLICY "unit_items_delete" ON unit_items FOR DELETE
  USING (current_user_role() IN ('teacher','university_admin','super_admin') AND tenant_id = current_tenant_id());

-- ── course_enrollments ────────────────────────────────────────
CREATE POLICY "course_enrollments_select" ON course_enrollments FOR SELECT
  USING (
    current_user_role() = 'super_admin' OR
    (tenant_id = current_tenant_id() AND (
      current_user_role() IN ('university_admin','teacher') OR
      student_id = auth.uid()
    ))
  );

CREATE POLICY "course_enrollments_insert" ON course_enrollments FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY "course_enrollments_delete" ON course_enrollments FOR DELETE
  USING (
    current_user_role() IN ('super_admin','university_admin') OR
    (current_user_role() = 'teacher' AND tenant_id = current_tenant_id())
  );

-- ── student_progress ─────────────────────────────────────────
CREATE POLICY "student_progress_select" ON student_progress FOR SELECT
  USING (
    current_user_role() = 'super_admin' OR
    (tenant_id = current_tenant_id() AND (
      current_user_role() IN ('university_admin','teacher') OR
      student_id = auth.uid()
    ))
  );

CREATE POLICY "student_progress_insert" ON student_progress FOR INSERT
  WITH CHECK (student_id = auth.uid() AND tenant_id = current_tenant_id());

-- ── unit_quiz_submissions ─────────────────────────────────────
CREATE POLICY "unit_quiz_submissions_select" ON unit_quiz_submissions FOR SELECT
  USING (
    current_user_role() = 'super_admin' OR
    (tenant_id = current_tenant_id() AND (
      current_user_role() IN ('university_admin','teacher') OR
      student_id = auth.uid()
    ))
  );

CREATE POLICY "unit_quiz_submissions_insert" ON unit_quiz_submissions FOR INSERT
  WITH CHECK (student_id = auth.uid() AND tenant_id = current_tenant_id());

-- ── exam_retake_permissions ───────────────────────────────────
CREATE POLICY "exam_retake_select" ON exam_retake_permissions FOR SELECT
  USING (
    current_user_role() = 'super_admin' OR
    (tenant_id = current_tenant_id() AND (
      current_user_role() IN ('university_admin','teacher') OR
      student_id = auth.uid()
    ))
  );

CREATE POLICY "exam_retake_insert" ON exam_retake_permissions FOR INSERT
  WITH CHECK (
    current_user_role() IN ('super_admin','university_admin') AND
    tenant_id = current_tenant_id()
  );

CREATE POLICY "exam_retake_delete" ON exam_retake_permissions FOR DELETE
  USING (
    current_user_role() IN ('super_admin','university_admin') AND
    tenant_id = current_tenant_id()
  );

-- ============================================================
-- 12. UPDATE accept_invitation RPC
--     Now handles course_id enrollment in addition to group_id
-- ============================================================
CREATE OR REPLACE FUNCTION accept_invitation(
  p_token     TEXT,
  p_user_id   UUID,
  p_full_name TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv          RECORD;
  _user_exists BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) INTO _user_exists;
  IF NOT _user_exists THEN
    RAISE EXCEPTION 'USER_PROFILE_NOT_FOUND';
  END IF;

  SELECT * INTO inv
  FROM invitations
  WHERE token     = p_token
    AND status    = 'pending'
    AND expires_at > NOW()
    AND (max_uses IS NULL OR use_count < max_uses)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_INVALID_OR_EXPIRED';
  END IF;

  IF inv.is_public THEN
    UPDATE invitations
    SET use_count = use_count + 1,
        status    = CASE
                      WHEN max_uses IS NOT NULL AND (use_count + 1) >= max_uses
                      THEN 'revoked'
                      ELSE 'pending'
                    END
    WHERE id = inv.id;
  ELSE
    UPDATE invitations
    SET status      = 'accepted',
        accepted_at = NOW(),
        accepted_by = p_user_id
    WHERE id = inv.id;
  END IF;

  -- Set role + tenant on the user profile
  UPDATE users
  SET role      = inv.role,
      tenant_id = inv.tenant_id,
      full_name = p_full_name
  WHERE id = p_user_id;

  -- Auto-enroll student into academic group if specified
  IF inv.group_id IS NOT NULL AND inv.role = 'student' THEN
    INSERT INTO group_students (group_id, student_id)
    VALUES (inv.group_id, p_user_id)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Auto-enroll student into course if specified
  IF inv.course_id IS NOT NULL AND inv.role = 'student' THEN
    INSERT INTO course_enrollments (course_id, student_id, tenant_id)
    VALUES (inv.course_id, p_user_id, inv.tenant_id)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN json_build_object(
    'role',      inv.role,
    'tenant_id', inv.tenant_id,
    'group_id',  inv.group_id,
    'course_id', inv.course_id
  );
END;
$$;

-- ============================================================
-- 13. RPC: get_course_progress
--     Returns how many items a student completed in a course
-- ============================================================
CREATE OR REPLACE FUNCTION get_course_progress(p_course_id UUID, p_student_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_items     INTEGER;
  completed_items INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_items
  FROM unit_items ui
  JOIN course_units cu ON cu.id = ui.unit_id
  JOIN course_levels cl ON cl.id = cu.level_id
  WHERE cl.course_id = p_course_id
    AND ui.is_published = TRUE;

  SELECT COUNT(*) INTO completed_items
  FROM student_progress sp
  JOIN unit_items ui ON ui.id = sp.unit_item_id
  JOIN course_units cu ON cu.id = ui.unit_id
  JOIN course_levels cl ON cl.id = cu.level_id
  WHERE cl.course_id = p_course_id
    AND sp.student_id = p_student_id;

  RETURN json_build_object(
    'total',     total_items,
    'completed', completed_items,
    'percent',   CASE WHEN total_items = 0 THEN 0
                      ELSE ROUND((completed_items::NUMERIC / total_items) * 100)
                 END
  );
END;
$$;
