-- =============================================================================
-- exam_appeals — student dispute/appeal on a recorded proctoring violation
-- =============================================================================
-- Requested by the owner directly (2026-09-13): a student who believes a
-- proctoring violation was flagged in error needs a formal channel to appeal
-- it to the exam's teacher, and the appeal must carry enough detail (exam,
-- teacher, group/subject, timestamps, the student's own account) that an
-- admin can pull a complete report on demand — not just a free-text message.
--
-- Design notes:
--   - One appeal targets ONE specific violation event (identified by its type
--     + timestamp inside exam_submissions.proctoring_events — events have no
--     independent id, so type+timestamp is the natural key). A student can
--     also file a general appeal (violation_type/violation_at both NULL) if
--     they dispute the whole flagged status rather than one event.
--   - status: 'pending' -> 'upheld' (teacher agrees, violation dismissed) or
--     'rejected' (teacher disagrees, violation stands). Teacher/admin-only
--     transition, enforced in src/app/api/appeals/[id]/route.ts (there is no
--     RPC; browser roles have no UPDATE policy on this table).
--   - No RLS write policy: mirrors the codebase's privileged-write pattern
--     (service-role client after app-level authorization) used everywhere
--     else — see api/requests, api/announcements, etc.
--   - Read policies ARE defined, so the teacher's own dashboard and a
--     student's own appeal history can read directly through the session
--     client without a bespoke RPC for every list view.
-- =============================================================================

CREATE TABLE IF NOT EXISTS exam_appeals (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  exam_id           UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  submission_id     UUID NOT NULL REFERENCES exam_submissions(id) ON DELETE CASCADE,
  student_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teacher_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- the exam's proctor/owner, denormalized for fast reporting
  group_id          UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,

  -- The specific flagged event being disputed (NULL = disputing the exam's
  -- flagged status generally, not one event).
  violation_type    TEXT,
  violation_at      TIMESTAMPTZ,

  -- Denormalized snapshots (same pattern as invitations.group_name_snapshot):
  -- a student has no direct RLS read on exams/users, so the appeal row must
  -- be self-contained to display in their own history, and an admin report
  -- needs none of this to change retroactively if a name is edited later.
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

-- The snapshot columns were added to the live DB by a second ALTER after the
-- table already existed (2026-09-13). CREATE TABLE IF NOT EXISTS above is a
-- no-op on such a database, so repeat them here to keep this file re-runnable.
ALTER TABLE exam_appeals
  ADD COLUMN IF NOT EXISTS student_name TEXT,
  ADD COLUMN IF NOT EXISTS teacher_name TEXT,
  ADD COLUMN IF NOT EXISTS group_name   TEXT,
  ADD COLUMN IF NOT EXISTS exam_title   TEXT;

CREATE INDEX IF NOT EXISTS idx_exam_appeals_teacher   ON exam_appeals(teacher_id);
CREATE INDEX IF NOT EXISTS idx_exam_appeals_student    ON exam_appeals(student_id);
CREATE INDEX IF NOT EXISTS idx_exam_appeals_tenant     ON exam_appeals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_exam_appeals_submission ON exam_appeals(submission_id);

ALTER TABLE exam_appeals ENABLE ROW LEVEL SECURITY;

-- Student reads only their own appeals.
DROP POLICY IF EXISTS "exam_appeals_select" ON exam_appeals;
CREATE POLICY "exam_appeals_select" ON exam_appeals FOR SELECT USING (
  current_user_role() = 'super_admin'
  OR student_id = auth.uid()
  OR teacher_id = auth.uid()
  OR (current_user_role() = 'university_admin' AND tenant_id = current_tenant_id())
);

-- One appeal per (submission, violation_type, violation_at): a student cannot
-- spam the same event repeatedly. NULLs are distinct per SQL semantics, so a
-- "general" appeal (both NULL) can only be filed once per submission too —
-- enforced with a partial unique index since the columns are nullable.
CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_appeals_one_per_event
  ON exam_appeals (submission_id, COALESCE(violation_type, ''), COALESCE(violation_at, 'epoch'::timestamptz));

COMMENT ON TABLE exam_appeals IS
  'Student-filed disputes over a recorded proctoring violation. Written via service-role after app-level authorization (see api/appeals/*) — no INSERT/UPDATE RLS policy, matching the codebase convention.';
