-- ============================================================
-- fk_covering_indexes_migration.sql — 2026-09-05  (APPLIED)
-- Idempotent + re-runnable.
--
-- The Supabase performance advisor reported 31 foreign keys with no
-- covering index. An unindexed FK forces a sequential scan of the child
-- table on parent DELETE/UPDATE, and makes the column slow to join/filter.
--
-- Indexed here: every `tenant_id` FK (multi-tenant scoping appears in
-- essentially every query and in cascade checks) plus the hot join/filter
-- columns, and the FKs on the tables added in this session.
--
-- Deliberately NOT indexed: audit columns (deleted_by, granted_by,
-- accepted_by, invited_by, created_by). They are never filtered on, so an
-- index would only add write amplification. Revisit if a "who deleted
-- this" view is ever built.
-- ============================================================

-- tenant scoping
CREATE INDEX IF NOT EXISTS idx_course_enrollments_tenant     ON course_enrollments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_course_levels_tenant          ON course_levels(tenant_id);
CREATE INDEX IF NOT EXISTS idx_course_units_tenant           ON course_units(tenant_id);
CREATE INDEX IF NOT EXISTS idx_exam_retake_tenant            ON exam_retake_permissions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_exam_submissions_tenant       ON exam_submissions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_feature_flags_tenant          ON feature_flags(tenant_id);
CREATE INDEX IF NOT EXISTS idx_grades_tenant                 ON grades(tenant_id);
CREATE INDEX IF NOT EXISTS idx_student_progress_tenant       ON student_progress(tenant_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_tenant       ON survey_responses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_surveys_tenant                ON surveys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_unit_items_tenant             ON unit_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_unit_quiz_submissions_tenant  ON unit_quiz_submissions(tenant_id);

-- hot joins / filters
CREATE INDEX IF NOT EXISTS idx_exams_course_id               ON exams(course_id);
CREATE INDEX IF NOT EXISTS idx_invitations_group_id          ON invitations(group_id);
CREATE INDEX IF NOT EXISTS idx_unit_items_course_id          ON unit_items(course_id);
CREATE INDEX IF NOT EXISTS idx_student_progress_unit_item    ON student_progress(unit_item_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_student      ON survey_responses(student_id);
CREATE INDEX IF NOT EXISTS idx_surveys_teacher               ON surveys(teacher_id);
CREATE INDEX IF NOT EXISTS idx_exam_retake_student           ON exam_retake_permissions(student_id);

-- tables added 2026-09-04/05
CREATE INDEX IF NOT EXISTS idx_announcement_groups_group     ON announcement_groups(group_id);
CREATE INDEX IF NOT EXISTS idx_staff_requests_group          ON staff_requests(group_id);
CREATE INDEX IF NOT EXISTS idx_request_messages_sender       ON request_messages(sender_id);

-- Duplicate index: `invitations_token_key` is the UNIQUE constraint's own
-- index and must stay; `idx_invitations_token` was an identical copy costing
-- a second write on every invitation insert.
DROP INDEX IF EXISTS idx_invitations_token;

-- NOTE: the advisor will report the indexes created above as "unused" until
-- queries actually scan them. On a near-empty database that is expected and
-- is NOT a reason to drop them.
