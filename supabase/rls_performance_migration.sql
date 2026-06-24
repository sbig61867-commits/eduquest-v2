-- ============================================================
-- EduQuest — RLS Performance Migration (InitPlan optimization)
-- Run AFTER schema.sql + invitations_migration.sql
--
-- Wraps every helper-function / auth.uid() call inside a scalar subquery
-- `(SELECT ...)`. Postgres then evaluates it ONCE per statement (as an
-- InitPlan) instead of once per row. On large tenant tables this turns a
-- per-row function call into a single cached lookup — the single biggest
-- RLS latency win, and behaviorally identical to the original policies.
--
-- Also adds hot-path indexes used by the exam attempt + enrollment flows.
-- ============================================================

-- ── TENANTS ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "tenants_select" ON tenants;
CREATE POLICY "tenants_select" ON tenants FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin' OR id = (SELECT current_tenant_id())
);
DROP POLICY IF EXISTS "tenants_manage" ON tenants;
CREATE POLICY "tenants_manage" ON tenants FOR ALL USING (
  (SELECT current_user_role()) = 'super_admin'
);

-- ── USERS ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "users_select" ON users;
CREATE POLICY "users_select" ON users FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin' OR tenant_id = (SELECT current_tenant_id()) OR id = (SELECT auth.uid())
);
DROP POLICY IF EXISTS "users_insert" ON users;
CREATE POLICY "users_insert" ON users FOR INSERT WITH CHECK (
  (SELECT current_user_role()) IN ('super_admin','university_admin')
);
DROP POLICY IF EXISTS "users_update" ON users;
CREATE POLICY "users_update" ON users FOR UPDATE USING (
  (SELECT current_user_role()) = 'super_admin' OR
  ((SELECT current_user_role()) = 'university_admin' AND tenant_id = (SELECT current_tenant_id())) OR
  id = (SELECT auth.uid())
);

-- ── GROUPS ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "groups_select" ON groups;
CREATE POLICY "groups_select" ON groups FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin' OR tenant_id = (SELECT current_tenant_id())
);
DROP POLICY IF EXISTS "groups_insert" ON groups;
CREATE POLICY "groups_insert" ON groups FOR INSERT WITH CHECK (
  (SELECT current_user_role()) IN ('teacher','university_admin','super_admin') AND
  tenant_id = (SELECT current_tenant_id())
);
DROP POLICY IF EXISTS "groups_update" ON groups;
CREATE POLICY "groups_update" ON groups FOR UPDATE USING (
  (SELECT current_user_role()) = 'super_admin' OR
  ((SELECT current_user_role()) = 'teacher' AND teacher_id = (SELECT auth.uid()))
);

-- ── LESSONS ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "lessons_select" ON lessons;
CREATE POLICY "lessons_select" ON lessons FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin' OR tenant_id = (SELECT current_tenant_id())
);
DROP POLICY IF EXISTS "lessons_insert" ON lessons;
CREATE POLICY "lessons_insert" ON lessons FOR INSERT WITH CHECK (
  (SELECT current_user_role()) IN ('teacher','university_admin','super_admin') AND
  tenant_id = (SELECT current_tenant_id())
);
DROP POLICY IF EXISTS "lessons_update" ON lessons;
CREATE POLICY "lessons_update" ON lessons FOR UPDATE USING (
  (SELECT current_user_role()) = 'super_admin' OR
  ((SELECT current_user_role()) = 'teacher' AND teacher_id = (SELECT auth.uid()))
);

-- ── EXAMS ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "exams_select" ON exams;
-- Students excluded — they read via get_student_exams() (answers stripped).
-- See exam_answer_leak_fix_migration.sql.
CREATE POLICY "exams_select" ON exams FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin'
  OR ((SELECT current_user_role()) = 'university_admin' AND tenant_id = (SELECT current_tenant_id()))
  OR ((SELECT current_user_role()) = 'teacher' AND teacher_id = (SELECT auth.uid()))
);
DROP POLICY IF EXISTS "exams_insert" ON exams;
CREATE POLICY "exams_insert" ON exams FOR INSERT WITH CHECK (
  (SELECT current_user_role()) IN ('teacher','university_admin','super_admin') AND
  tenant_id = (SELECT current_tenant_id())
);
DROP POLICY IF EXISTS "exams_update" ON exams;
CREATE POLICY "exams_update" ON exams FOR UPDATE USING (
  (SELECT current_user_role()) = 'super_admin' OR
  ((SELECT current_user_role()) = 'teacher' AND teacher_id = (SELECT auth.uid()))
);

-- ── EXAM SUBMISSIONS ────────────────────────────────────────
DROP POLICY IF EXISTS "submissions_select" ON exam_submissions;
CREATE POLICY "submissions_select" ON exam_submissions FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin' OR
  student_id = (SELECT auth.uid()) OR
  tenant_id = (SELECT current_tenant_id())
);
DROP POLICY IF EXISTS "submissions_insert" ON exam_submissions;
CREATE POLICY "submissions_insert" ON exam_submissions FOR INSERT WITH CHECK (
  student_id = (SELECT auth.uid()) AND tenant_id = (SELECT current_tenant_id())
);

-- ── GRADES ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "grades_select" ON grades;
CREATE POLICY "grades_select" ON grades FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin' OR
  student_id = (SELECT auth.uid()) OR
  tenant_id = (SELECT current_tenant_id())
);
DROP POLICY IF EXISTS "grades_insert" ON grades;
CREATE POLICY "grades_insert" ON grades FOR INSERT WITH CHECK (
  (SELECT current_user_role()) IN ('teacher','university_admin','super_admin') AND
  tenant_id = (SELECT current_tenant_id())
);

-- ── INVITATIONS ─────────────────────────────────────────────
DROP POLICY IF EXISTS "invitations_select" ON invitations;
CREATE POLICY "invitations_select" ON invitations FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin' OR tenant_id = (SELECT current_tenant_id())
);
DROP POLICY IF EXISTS "invitations_insert" ON invitations;
-- Enforce role hierarchy + tenant scoping at the DB level (mirrors API ROLE_CEILING).
-- See invitations_insert_hardening_migration.sql for rationale.
CREATE POLICY "invitations_insert" ON invitations FOR INSERT WITH CHECK (
  (SELECT current_user_role()) = 'super_admin'
  OR (
    tenant_id = (SELECT current_tenant_id())
    AND invited_by = (SELECT auth.uid())
    AND (
      ((SELECT current_user_role()) = 'university_admin' AND role IN ('teacher','student'))
      OR ((SELECT current_user_role()) = 'teacher' AND role = 'student')
    )
  )
);
DROP POLICY IF EXISTS "invitations_update" ON invitations;
CREATE POLICY "invitations_update" ON invitations FOR UPDATE USING (
  (SELECT current_user_role()) = 'super_admin' OR
  invited_by = (SELECT auth.uid()) OR
  ((SELECT current_user_role()) = 'university_admin' AND tenant_id = (SELECT current_tenant_id()))
);

-- ── HOT-PATH INDEXES ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_exam_submissions_exam_student ON exam_submissions(exam_id, student_id);
CREATE INDEX IF NOT EXISTS idx_group_students_student ON group_students(student_id);
CREATE INDEX IF NOT EXISTS idx_exams_group_published ON exams(group_id) WHERE is_published = true;
