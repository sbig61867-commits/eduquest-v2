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
