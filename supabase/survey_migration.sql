-- ============================================================
-- Pilot Feedback Survey — one survey per group, one response per student.
-- Feeds the "pilot" report scope (src/lib/reports.ts buildPilotReport).
-- Run in Supabase SQL Editor.
-- ============================================================

-- ============================================================
-- 1. SURVEYS
-- ============================================================
CREATE TABLE IF NOT EXISTS surveys (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  group_id    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  teacher_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT 'تقييم تجربة المنصة',
  is_open     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(group_id)
);

-- ============================================================
-- 2. SURVEY RESPONSES
-- ============================================================
CREATE TABLE IF NOT EXISTS survey_responses (
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

CREATE INDEX IF NOT EXISTS idx_surveys_group_id ON surveys(group_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_survey_id ON survey_responses(survey_id);

-- ============================================================
-- 3. RLS
-- ============================================================
ALTER TABLE surveys           ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_responses  ENABLE ROW LEVEL SECURITY;

-- ── surveys ──────────────────────────────────────────────────
-- Students need to see their group's survey (to answer it) even though
-- they have no other visibility into `groups` management data — so allow
-- select to any member of the group, not just the teacher/admin.
CREATE POLICY "surveys_select" ON surveys FOR SELECT
  USING (
    current_user_role() = 'super_admin' OR
    (tenant_id = current_tenant_id() AND (
      current_user_role() = 'university_admin' OR
      teacher_id = auth.uid() OR
      EXISTS (SELECT 1 FROM group_students gs WHERE gs.group_id = surveys.group_id AND gs.student_id = auth.uid())
    ))
  );

CREATE POLICY "surveys_insert" ON surveys FOR INSERT
  WITH CHECK (
    tenant_id = current_tenant_id() AND
    current_user_role() = 'teacher' AND
    teacher_id = auth.uid()
  );

CREATE POLICY "surveys_update" ON surveys FOR UPDATE
  USING (
    current_user_role() = 'super_admin' OR
    (current_user_role() = 'teacher' AND teacher_id = auth.uid() AND tenant_id = current_tenant_id())
  );

-- ── survey_responses ─────────────────────────────────────────
-- Student: insert own response only for an open survey they belong to;
-- read only their own response. Teacher: read responses for own surveys
-- (aggregated by the report builder, never exposes raw text outside
-- their own group). Super admin: read all.
CREATE POLICY "survey_responses_select" ON survey_responses FOR SELECT
  USING (
    current_user_role() = 'super_admin' OR
    student_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM surveys s
      WHERE s.id = survey_responses.survey_id
        AND (
          (current_user_role() = 'teacher' AND s.teacher_id = auth.uid()) OR
          (current_user_role() = 'university_admin' AND s.tenant_id = current_tenant_id())
        )
    )
  );

CREATE POLICY "survey_responses_insert" ON survey_responses FOR INSERT
  WITH CHECK (
    current_user_role() = 'student' AND
    student_id = auth.uid() AND
    tenant_id = current_tenant_id() AND
    EXISTS (
      SELECT 1 FROM surveys s
      JOIN group_students gs ON gs.group_id = s.group_id
      WHERE s.id = survey_responses.survey_id
        AND s.is_open = TRUE
        AND gs.student_id = auth.uid()
    )
  );

-- ============================================================
-- 4. Verify
-- ============================================================
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('surveys', 'survey_responses');
