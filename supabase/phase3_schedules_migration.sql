-- ============================================================
-- phase3_schedules_migration.sql — 2026-09-05
-- Idempotent + re-runnable. Apply in the Supabase SQL Editor.
--
-- Phase 3 of the staff-collaboration build: weekly timetables.
--
-- Owner's spec: every group/section has a 7-day weekly timetable. The
-- university_admin or centre manager arranges it in coordination with the
-- teacher, picks which group to create/edit, and publishes it — students
-- then see their own group's timetable. They may additionally keep a
-- teacher-private timetable for that teacher's informal (unofficial)
-- exams, which students never see.
--
-- Authorization mirrors Phase 2: the `manage_schedules` capability gates
-- every write (checked in the API with the user session), and the writes
-- themselves run on the service-role client. Reads are RLS-scoped for
-- staff/teachers; students get the filtered get_student_schedule() feed.
--
-- All policy predicates wrap auth.uid() / current_user_role() /
-- current_tenant_id() in (SELECT ...) so they are evaluated once per
-- query rather than once per row (see rls_initplan_optimization_migration).
-- ============================================================

-- ── 1. Tables ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schedules (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- exactly one of group_id / teacher_id is set, matching `kind`
  kind         text NOT NULL DEFAULT 'group' CHECK (kind IN ('group','teacher')),
  group_id     uuid REFERENCES groups(id) ON DELETE CASCADE,
  teacher_id   uuid REFERENCES users(id)  ON DELETE CASCADE,
  title        text NOT NULL,
  is_published boolean NOT NULL DEFAULT false,
  created_by   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedules_target_check CHECK (
    (kind = 'group'   AND group_id   IS NOT NULL AND teacher_id IS NULL)
    OR
    (kind = 'teacher' AND teacher_id IS NOT NULL AND group_id   IS NULL)
  )
);

-- One timetable per group, and one private timetable per teacher.
CREATE UNIQUE INDEX IF NOT EXISTS uq_schedules_group
  ON schedules(group_id)   WHERE group_id   IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_schedules_teacher
  ON schedules(teacher_id) WHERE teacher_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS schedule_slots (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id uuid NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  -- 0 = Sunday … 6 = Saturday (the week starts on Sunday for these tenants)
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  title       text NOT NULL,
  teacher_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  location    text,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_slots_time_check CHECK (end_time > start_time)
);

-- ── 2. Indexes (FK covering + the hot read path) ────────────
CREATE INDEX IF NOT EXISTS idx_schedules_tenant        ON schedules(tenant_id, is_published);
CREATE INDEX IF NOT EXISTS idx_schedule_slots_schedule ON schedule_slots(schedule_id, day_of_week, start_time);
CREATE INDEX IF NOT EXISTS idx_schedule_slots_tenant   ON schedule_slots(tenant_id);
CREATE INDEX IF NOT EXISTS idx_schedule_slots_teacher  ON schedule_slots(teacher_id);

-- ── 3. RLS ──────────────────────────────────────────────────
ALTER TABLE schedules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_slots ENABLE ROW LEVEL SECURITY;

-- Staff see their tenant's timetables; a teacher sees their own private
-- timetable plus the timetables of groups they teach. Students get NO
-- direct row read — get_student_schedule() below applies publication and
-- enrolment filtering for them.
DROP POLICY IF EXISTS "schedules_select" ON schedules;
CREATE POLICY "schedules_select" ON schedules FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin'
  OR (
    tenant_id = (SELECT current_tenant_id())
    AND (
      (SELECT current_user_role()) IN ('university_admin','center_manager')
      OR (
        (SELECT current_user_role()) = 'teacher'
        AND (
          teacher_id = (SELECT auth.uid())
          OR group_id IN (
            SELECT g.id FROM public.groups g WHERE g.teacher_id = (SELECT auth.uid())
          )
        )
      )
    )
  )
);

-- Slots repeat the parent's visibility explicitly rather than relying on
-- RLS inheritance through the sub-query, so the rule stays readable and
-- cannot silently widen if the parent policy changes.
DROP POLICY IF EXISTS "schedule_slots_select" ON schedule_slots;
CREATE POLICY "schedule_slots_select" ON schedule_slots FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.id = schedule_slots.schedule_id
      AND (
        (SELECT current_user_role()) = 'super_admin'
        OR (
          s.tenant_id = (SELECT current_tenant_id())
          AND (
            (SELECT current_user_role()) IN ('university_admin','center_manager')
            OR (
              (SELECT current_user_role()) = 'teacher'
              AND (
                s.teacher_id = (SELECT auth.uid())
                OR s.group_id IN (
                  SELECT g.id FROM public.groups g WHERE g.teacher_id = (SELECT auth.uid())
                )
              )
            )
          )
        )
      )
  )
);

-- Writes go through the service-role client in the API after the
-- `manage_schedules` capability check, so no INSERT/UPDATE/DELETE policies
-- are granted here (deny by default).

-- ── 4. Student-facing timetable feed ────────────────────────
CREATE OR REPLACE FUNCTION get_student_schedule()
RETURNS TABLE (
  slot_id      uuid,
  group_id     uuid,
  group_name   text,
  day_of_week  smallint,
  start_time   time,
  end_time     time,
  title        text,
  teacher_name text,
  location     text,
  note         text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT sl.id, s.group_id, g.name, sl.day_of_week, sl.start_time, sl.end_time,
         sl.title, t.full_name, sl.location, sl.note
  FROM schedule_slots sl
  JOIN schedules s  ON s.id = sl.schedule_id
  JOIN groups    g  ON g.id = s.group_id
  LEFT JOIN users t ON t.id = sl.teacher_id
  WHERE auth.uid() IS NOT NULL
    AND s.kind = 'group'
    AND s.is_published = true
    AND s.tenant_id = (SELECT u.tenant_id FROM users u WHERE u.id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM group_students gs
      WHERE gs.group_id = s.group_id AND gs.student_id = auth.uid()
    )
  ORDER BY sl.day_of_week, sl.start_time;
$$;

REVOKE ALL ON FUNCTION public.get_student_schedule() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_schedule() TO authenticated;
