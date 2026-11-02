-- 0014 — school subjects per grade, subject teachers, bell schedule and section timetables. Neon only; never
-- run on Supabase. PENDING: needs the owner's approval before it is applied. Idempotent. Needs 0013.
-- Design: docs/claude/tasks/school-structure-plan.md (part 2)
--
-- For tenants whose institution_type = 'school':
--   school_subjects          المواد الدراسية   the school's catalogue: name, code (unique per school, any case),
--                                              optional colour from a fixed token palette (a name, never a hex)
--   school_grade_subjects    مواد الصف         subject ↔ grade with weekly sessions (e.g. Mathematics → Grade 7 → 5)
--   school_subject_teachers  معلم المادة       (section, subject) → teacher; a section is a groups row (0013)
--   school_periods           الحصص             the bell schedule: ordered lessons and breaks with times, per school,
--                                              optionally per shift (NULL = every shift); no overlap inside a shift
--   section timetable        جدول الحصص        REUSES public.schedules / public.schedule_slots: the section's group
--                                              timetable (one per group, already) and one slot per (day, period).
--                                              A school slot carries school_period_id + school_subject_id; its
--                                              times, title and teacher are always copied by a trigger from the
--                                              period, the subject and the subject's teacher (never trusted from
--                                              the writer). So students see it in /student/schedule through the
--                                              existing get_student_schedule() once it is published, teachers in
--                                              /teacher/schedule, staff in /admin/schedules, and attendance can
--                                              keep pointing at a slot (attendance_sessions.schedule_slot_id).
-- Integrity (database, not app code):
--   * a cell's subject must be linked to the section's grade; its period must be a live lesson of the school
--     whose shift (if any) is the section's shift;
--   * one cell per (section timetable, day, period): unique index;
--   * a teacher is never in two places at once inside one academic year: trigger, serialised per teacher with
--     a transaction-level advisory lock (race-free under READ COMMITTED);
--   * a period, a subject or a grade↔subject link that a current timetable uses cannot be archived.
-- The weekly sessions target is not a hard limit: the admin screen shows count / target and warns.
--
-- Reads: app_user under RLS. The catalogue (subjects, grade links, periods) is readable by the school's own
-- accounts, like 0013's structure. Who teaches what (school_subject_teachers) is narrower: staff of the school,
-- a teacher for the sections they teach, a student for their own sections. A subject teacher now also sees the
-- sections they teach (groups_select, and through it the rosters in group_students_select) and those sections'
-- timetables (schedules_select / schedule_slots_select). Homeroom teachers keep everything they had.
-- Writes: app_service only, pinned to the institution (svc_tenant_ok), after /api/school/* checked the caller.
-- No DELETE right on the new tables: archive = deleted_at. Clearing a timetable cell deletes its schedule_slots
-- row, as every timetable slot is deleted today (app_service already holds DELETE on schedule_slots).
-- SECURITY DEFINER functions: schema-qualified, search_path pinned, execute revoked from PUBLIC / anon /
-- authenticated / service_role. The trigger functions never use auth.uid(); current_teacher_section_ids() is a
-- user-session RLS helper (app_user only, like current_student_group_ids) and is never called by app_service.
-- Non-school tenants: new tables empty, new slot columns NULL, partial indexes empty, triggers return at once,
-- and every new RLS clause is a no-op for them (no school sections, no subject teachers).
-- If 0003_roles.sql is ever re-run, re-run 0013 and then 0014 after it (0003 rebuilds app_service grants).

BEGIN;

-- 1. Tables ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_subjects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CONSTRAINT school_subjects_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  code        text NOT NULL CONSTRAINT school_subjects_code_check CHECK (char_length(btrim(code)) BETWEEN 1 AND 30),
  colour      text CONSTRAINT school_subjects_colour_check
                CHECK (colour IS NULL OR colour IN ('neutral', 'accent', 'info', 'success', 'warning', 'danger')),
  sort_order  integer NOT NULL DEFAULT 0,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS school_subjects_tenant_idx ON public.school_subjects (tenant_id, sort_order) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS school_subjects_code_uq ON public.school_subjects (tenant_id, lower(btrim(code)))
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.school_grade_subjects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  grade_id         uuid NOT NULL REFERENCES public.school_grades(id) ON DELETE CASCADE,
  subject_id       uuid NOT NULL REFERENCES public.school_subjects(id) ON DELETE CASCADE,
  weekly_sessions  smallint NOT NULL CONSTRAINT school_grade_subjects_sessions_check CHECK (weekly_sessions BETWEEN 1 AND 40),
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS school_grade_subjects_uq ON public.school_grade_subjects (grade_id, subject_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS school_grade_subjects_grade_idx ON public.school_grade_subjects (grade_id);
CREATE INDEX IF NOT EXISTS school_grade_subjects_subject_idx ON public.school_grade_subjects (subject_id);
CREATE INDEX IF NOT EXISTS school_grade_subjects_tenant_idx ON public.school_grade_subjects (tenant_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.school_periods (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  shift       text CONSTRAINT school_periods_shift_check CHECK (shift IS NULL OR shift IN ('morning', 'evening')),
  kind        text NOT NULL DEFAULT 'lesson' CONSTRAINT school_periods_kind_check CHECK (kind IN ('lesson', 'break')),
  name        text CONSTRAINT school_periods_name_check CHECK (name IS NULL OR char_length(btrim(name)) BETWEEN 1 AND 60),
  starts_at   time NOT NULL,
  ends_at     time NOT NULL,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_periods_time_check CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS school_periods_tenant_idx ON public.school_periods (tenant_id, shift, starts_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.school_subject_teachers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  group_id    uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  subject_id  uuid NOT NULL REFERENCES public.school_subjects(id) ON DELETE CASCADE,
  teacher_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS school_subject_teachers_uq ON public.school_subject_teachers (group_id, subject_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS school_subject_teachers_group_idx ON public.school_subject_teachers (group_id);
CREATE INDEX IF NOT EXISTS school_subject_teachers_subject_idx ON public.school_subject_teachers (subject_id);
CREATE INDEX IF NOT EXISTS school_subject_teachers_teacher_idx ON public.school_subject_teachers (teacher_id);
CREATE INDEX IF NOT EXISTS school_subject_teachers_tenant_idx ON public.school_subject_teachers (tenant_id) WHERE deleted_at IS NULL;

-- 2. Section timetable = schedules / schedule_slots ------------------------------
ALTER TABLE public.schedule_slots ADD COLUMN IF NOT EXISTS school_period_id  uuid REFERENCES public.school_periods(id);
ALTER TABLE public.schedule_slots ADD COLUMN IF NOT EXISTS school_subject_id uuid REFERENCES public.school_subjects(id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'schedule_slots_school_shape_check') THEN
    ALTER TABLE public.schedule_slots ADD CONSTRAINT schedule_slots_school_shape_check
      CHECK ((school_period_id IS NULL) = (school_subject_id IS NULL));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS schedule_slots_school_cell_uq ON public.schedule_slots (schedule_id, day_of_week, school_period_id)
  WHERE school_period_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS schedule_slots_school_period_idx ON public.schedule_slots (school_period_id) WHERE school_period_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS schedule_slots_school_subject_idx ON public.schedule_slots (school_subject_id) WHERE school_subject_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS schedule_slots_school_teacher_idx ON public.schedule_slots (teacher_id, day_of_week)
  WHERE school_period_id IS NOT NULL;

-- 3. Integrity triggers ---------------------------------------------------------

-- Row checks of the four new tables (BEFORE INSERT / UPDATE). Archiving is always allowed here; whether
-- something in use may be archived is decided AFTER, by school_timetable_sync().
CREATE OR REPLACE FUNCTION public.school_curriculum_row_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v record;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'a school row stays in its school' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  PERFORM public.school_assert_school_tenant(NEW.tenant_id);

  IF TG_TABLE_NAME = 'school_grade_subjects' THEN
    IF NOT EXISTS (SELECT 1 FROM public.school_grades g
                    WHERE g.id = NEW.grade_id AND g.tenant_id = NEW.tenant_id AND g.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'a subject link needs a live grade of the same school'
        USING ERRCODE = '42501', CONSTRAINT = 'school_grade_subjects_grade';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.school_subjects s
                    WHERE s.id = NEW.subject_id AND s.tenant_id = NEW.tenant_id AND s.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'a subject link needs a live subject of the same school'
        USING ERRCODE = '42501', CONSTRAINT = 'school_grade_subjects_subject';
    END IF;

  ELSIF TG_TABLE_NAME = 'school_periods' THEN
    -- one writer per school at a time, so two concurrent inserts cannot both pass the overlap check
    PERFORM pg_advisory_xact_lock(hashtextextended('school_periods:' || NEW.tenant_id::text, 0));
    IF EXISTS (SELECT 1 FROM public.school_periods p
                WHERE p.tenant_id = NEW.tenant_id AND p.id <> NEW.id AND p.deleted_at IS NULL
                  AND p.shift IS NOT DISTINCT FROM NEW.shift
                  AND p.starts_at < NEW.ends_at AND p.ends_at > NEW.starts_at) THEN
      RAISE EXCEPTION 'periods of the same bell schedule cannot overlap'
        USING ERRCODE = '23P01', CONSTRAINT = 'school_periods_overlap';
    END IF;

  ELSIF TG_TABLE_NAME = 'school_subject_teachers' THEN
    SELECT g.tenant_id, g.school_grade_id, g.deleted_at INTO v FROM public.groups g WHERE g.id = NEW.group_id;
    IF NOT FOUND OR v.tenant_id <> NEW.tenant_id OR v.school_grade_id IS NULL OR v.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'a subject teacher needs a live section of the same school'
        USING ERRCODE = '42501', CONSTRAINT = 'school_subject_teachers_section';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.school_subjects s
                     JOIN public.school_grade_subjects gs ON gs.subject_id = s.id AND gs.deleted_at IS NULL
                    WHERE s.id = NEW.subject_id AND s.tenant_id = NEW.tenant_id AND s.deleted_at IS NULL
                      AND gs.grade_id = v.school_grade_id) THEN
      RAISE EXCEPTION 'the subject is not taught in the section''s grade'
        USING ERRCODE = '23514', CONSTRAINT = 'school_slot_subject_grade';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.users u
                    WHERE u.id = NEW.teacher_id AND u.tenant_id = NEW.tenant_id AND u.role = 'teacher') THEN
      RAISE EXCEPTION 'the subject teacher must be a teacher of the same school'
        USING ERRCODE = '42501', CONSTRAINT = 'school_subject_teachers_teacher';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.school_curriculum_row_check() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_school_subjects_check ON public.school_subjects;
CREATE TRIGGER trg_school_subjects_check BEFORE INSERT OR UPDATE ON public.school_subjects
  FOR EACH ROW EXECUTE FUNCTION public.school_curriculum_row_check();
DROP TRIGGER IF EXISTS trg_school_grade_subjects_check ON public.school_grade_subjects;
CREATE TRIGGER trg_school_grade_subjects_check BEFORE INSERT OR UPDATE ON public.school_grade_subjects
  FOR EACH ROW EXECUTE FUNCTION public.school_curriculum_row_check();
DROP TRIGGER IF EXISTS trg_school_periods_check ON public.school_periods;
CREATE TRIGGER trg_school_periods_check BEFORE INSERT OR UPDATE ON public.school_periods
  FOR EACH ROW EXECUTE FUNCTION public.school_curriculum_row_check();
DROP TRIGGER IF EXISTS trg_school_subject_teachers_check ON public.school_subject_teachers;
CREATE TRIGGER trg_school_subject_teachers_check BEFORE INSERT OR UPDATE ON public.school_subject_teachers
  FOR EACH ROW EXECUTE FUNCTION public.school_curriculum_row_check();

-- A school timetable cell (BEFORE INSERT / UPDATE on schedule_slots). Ordinary slots return at once.
CREATE OR REPLACE FUNCTION public.school_slot_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  sec   record;
  per   record;
  subj  text;
  busy  text;
BEGIN
  IF NEW.school_period_id IS NULL OR NEW.school_subject_id IS NULL THEN
    RETURN NEW;  -- an ordinary slot; a half-set one is refused by schedule_slots_school_shape_check
  END IF;

  SELECT g.id, g.tenant_id, g.school_grade_id, g.school_year_id, g.shift INTO sec
    FROM public.schedules s JOIN public.groups g ON g.id = s.group_id
   WHERE s.id = NEW.schedule_id AND s.kind = 'group';
  IF NOT FOUND OR sec.school_grade_id IS NULL OR sec.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'a school period belongs to a section timetable of the same school'
      USING ERRCODE = '42501', CONSTRAINT = 'school_slot_section';
  END IF;

  SELECT p.kind, p.shift, p.starts_at, p.ends_at INTO per FROM public.school_periods p
   WHERE p.id = NEW.school_period_id AND p.tenant_id = NEW.tenant_id AND p.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the period is not a live period of the school' USING ERRCODE = '42501', CONSTRAINT = 'school_slot_period';
  END IF;
  IF per.kind <> 'lesson' THEN
    RAISE EXCEPTION 'a break cannot hold a subject' USING ERRCODE = '23514', CONSTRAINT = 'school_slot_period_break';
  END IF;
  IF per.shift IS NOT NULL AND per.shift IS DISTINCT FROM sec.shift THEN
    RAISE EXCEPTION 'the period belongs to another shift' USING ERRCODE = '23514', CONSTRAINT = 'school_slot_period_shift';
  END IF;

  SELECT s.name INTO subj FROM public.school_subjects s
   WHERE s.id = NEW.school_subject_id AND s.tenant_id = NEW.tenant_id AND s.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM public.school_grade_subjects gs
                  WHERE gs.grade_id = sec.school_grade_id AND gs.subject_id = s.id AND gs.deleted_at IS NULL);
  IF subj IS NULL THEN
    RAISE EXCEPTION 'the subject is not taught in the section''s grade' USING ERRCODE = '23514', CONSTRAINT = 'school_slot_subject_grade';
  END IF;

  -- never trusted from the writer: the period's times, the subject's name, the subject's teacher in the section
  NEW.start_time := per.starts_at;
  NEW.end_time   := per.ends_at;
  NEW.title      := subj;
  NEW.teacher_id := (SELECT st.teacher_id FROM public.school_subject_teachers st
                      WHERE st.group_id = sec.id AND st.subject_id = NEW.school_subject_id AND st.deleted_at IS NULL);

  IF NEW.teacher_id IS NOT NULL AND (
       TG_OP = 'INSERT' OR NEW.teacher_id IS DISTINCT FROM OLD.teacher_id OR NEW.schedule_id <> OLD.schedule_id
       OR NEW.day_of_week <> OLD.day_of_week OR NEW.start_time <> OLD.start_time OR NEW.end_time <> OLD.end_time) THEN
    -- serialise per teacher: a concurrent writer for the same teacher waits here, and the check below (a new
    -- snapshot under READ COMMITTED) then sees its committed cell
    PERFORM pg_advisory_xact_lock(hashtextextended('school_teacher:' || NEW.teacher_id::text, 0));
    SELECT g2.name INTO busy
      FROM public.schedule_slots sl2
      JOIN public.schedules s2 ON s2.id = sl2.schedule_id
      JOIN public.groups g2 ON g2.id = s2.group_id
     WHERE sl2.teacher_id = NEW.teacher_id AND sl2.id <> NEW.id AND sl2.school_period_id IS NOT NULL
       AND sl2.day_of_week = NEW.day_of_week AND sl2.start_time < NEW.end_time AND sl2.end_time > NEW.start_time
       AND g2.school_year_id = sec.school_year_id AND g2.deleted_at IS NULL AND g2.is_active
     ORDER BY g2.name
     LIMIT 1;
    IF busy IS NOT NULL THEN
      RAISE EXCEPTION 'the teacher already has a period at this time'
        USING ERRCODE = '23P01', CONSTRAINT = 'school_slot_teacher_busy', DETAIL = busy;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.school_slot_check() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_schedule_slots_school ON public.schedule_slots;
CREATE TRIGGER trg_schedule_slots_school BEFORE INSERT OR UPDATE ON public.schedule_slots
  FOR EACH ROW EXECUTE FUNCTION public.school_slot_check();

-- Keeps current timetables in step with the catalogue (AFTER UPDATE / INSERT). "Current" = a cell of a live
-- section in a live academic year; past years keep what they showed. Touching a cell re-runs
-- school_slot_check(), so a change that would break a cell (a teacher clash, a break, another shift) is refused.
CREATE OR REPLACE FUNCTION public.school_timetable_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'school_periods' THEN
    IF NEW.deleted_at IS NOT NULL THEN
      IF OLD.deleted_at IS NULL AND EXISTS (
           SELECT 1 FROM public.schedule_slots sl
             JOIN public.schedules s ON s.id = sl.schedule_id
             JOIN public.groups g ON g.id = s.group_id AND g.deleted_at IS NULL
             JOIN public.school_years y ON y.id = g.school_year_id AND y.deleted_at IS NULL
            WHERE sl.school_period_id = NEW.id) THEN
        RAISE EXCEPTION 'the period is used by a timetable' USING ERRCODE = '55000', CONSTRAINT = 'school_period_in_use';
      END IF;
    ELSIF (NEW.starts_at, NEW.ends_at, NEW.kind, NEW.shift) IS DISTINCT FROM (OLD.starts_at, OLD.ends_at, OLD.kind, OLD.shift) THEN
      UPDATE public.schedule_slots sl SET start_time = NEW.starts_at, end_time = NEW.ends_at
        FROM public.schedules s
        JOIN public.groups g ON g.id = s.group_id AND g.deleted_at IS NULL
        JOIN public.school_years y ON y.id = g.school_year_id AND y.deleted_at IS NULL
       WHERE s.id = sl.schedule_id AND sl.school_period_id = NEW.id;
    END IF;

  ELSIF TG_TABLE_NAME = 'school_subjects' THEN
    IF NEW.deleted_at IS NOT NULL THEN
      IF OLD.deleted_at IS NULL AND EXISTS (
           SELECT 1 FROM public.schedule_slots sl
             JOIN public.schedules s ON s.id = sl.schedule_id
             JOIN public.groups g ON g.id = s.group_id AND g.deleted_at IS NULL
             JOIN public.school_years y ON y.id = g.school_year_id AND y.deleted_at IS NULL
            WHERE sl.school_subject_id = NEW.id) THEN
        RAISE EXCEPTION 'the subject is used by a timetable' USING ERRCODE = '55000', CONSTRAINT = 'school_subject_in_use';
      END IF;
    ELSIF NEW.name IS DISTINCT FROM OLD.name THEN
      UPDATE public.schedule_slots sl SET title = NEW.name
        FROM public.schedules s
        JOIN public.groups g ON g.id = s.group_id AND g.deleted_at IS NULL
        JOIN public.school_years y ON y.id = g.school_year_id AND y.deleted_at IS NULL
       WHERE s.id = sl.schedule_id AND sl.school_subject_id = NEW.id;
    END IF;

  ELSIF TG_TABLE_NAME = 'school_grade_subjects' THEN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND EXISTS (
         SELECT 1 FROM public.schedule_slots sl
           JOIN public.schedules s ON s.id = sl.schedule_id
           JOIN public.groups g ON g.id = s.group_id AND g.deleted_at IS NULL
           JOIN public.school_years y ON y.id = g.school_year_id AND y.deleted_at IS NULL
          WHERE sl.school_subject_id = NEW.subject_id AND g.school_grade_id = NEW.grade_id) THEN
      RAISE EXCEPTION 'the subject is used by a timetable of this grade' USING ERRCODE = '55000', CONSTRAINT = 'school_subject_in_use';
    END IF;

  ELSIF TG_TABLE_NAME = 'school_subject_teachers' THEN
    -- the cells of this (section, subject) take the subject's current teacher (school_slot_check recomputes it)
    UPDATE public.schedule_slots sl SET teacher_id = NULL
      FROM public.schedules s
      JOIN public.groups g ON g.id = s.group_id AND g.deleted_at IS NULL
      JOIN public.school_years y ON y.id = g.school_year_id AND y.deleted_at IS NULL
     WHERE s.id = sl.schedule_id AND s.group_id = NEW.group_id AND sl.school_subject_id = NEW.subject_id;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.school_timetable_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_school_periods_sync ON public.school_periods;
CREATE TRIGGER trg_school_periods_sync AFTER UPDATE ON public.school_periods
  FOR EACH ROW EXECUTE FUNCTION public.school_timetable_sync();
DROP TRIGGER IF EXISTS trg_school_subjects_sync ON public.school_subjects;
CREATE TRIGGER trg_school_subjects_sync AFTER UPDATE ON public.school_subjects
  FOR EACH ROW EXECUTE FUNCTION public.school_timetable_sync();
DROP TRIGGER IF EXISTS trg_school_grade_subjects_sync ON public.school_grade_subjects;
CREATE TRIGGER trg_school_grade_subjects_sync AFTER UPDATE ON public.school_grade_subjects
  FOR EACH ROW EXECUTE FUNCTION public.school_timetable_sync();
DROP TRIGGER IF EXISTS trg_school_subject_teachers_sync ON public.school_subject_teachers;
CREATE TRIGGER trg_school_subject_teachers_sync AFTER INSERT OR UPDATE ON public.school_subject_teachers
  FOR EACH ROW EXECUTE FUNCTION public.school_timetable_sync();

-- A section changing shift re-checks its cells against the new shift; a section restored from the archive
-- must not bring back a teacher clash with another active section of the same year.
CREATE OR REPLACE FUNCTION public.groups_school_timetable_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  busy text;
BEGIN
  IF NEW.shift IS DISTINCT FROM OLD.shift THEN
    UPDATE public.schedule_slots sl SET start_time = sl.start_time
      FROM public.schedules s
     WHERE s.id = sl.schedule_id AND s.group_id = NEW.id AND sl.school_period_id IS NOT NULL;
  END IF;
  IF NEW.is_active AND NOT OLD.is_active AND NEW.deleted_at IS NULL THEN
    SELECT gb.name INTO busy
      FROM public.schedules sa
      JOIN public.schedule_slots a ON a.schedule_id = sa.id AND a.school_period_id IS NOT NULL AND a.teacher_id IS NOT NULL
      JOIN public.schedule_slots b ON b.teacher_id = a.teacher_id AND b.id <> a.id AND b.school_period_id IS NOT NULL
                                  AND b.day_of_week = a.day_of_week AND b.start_time < a.end_time AND b.end_time > a.start_time
      JOIN public.schedules sb ON sb.id = b.schedule_id
      JOIN public.groups gb ON gb.id = sb.group_id AND gb.id <> NEW.id AND gb.school_year_id = NEW.school_year_id
                           AND gb.is_active AND gb.deleted_at IS NULL
     WHERE sa.group_id = NEW.id
     ORDER BY gb.name
     LIMIT 1;
    IF busy IS NOT NULL THEN
      RAISE EXCEPTION 'a teacher of this section already has a period at the same time'
        USING ERRCODE = '23P01', CONSTRAINT = 'school_slot_teacher_busy', DETAIL = busy;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.groups_school_timetable_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_groups_school_timetable ON public.groups;
CREATE TRIGGER trg_groups_school_timetable AFTER UPDATE OF shift, is_active ON public.groups
  FOR EACH ROW WHEN (NEW.school_grade_id IS NOT NULL)
  EXECUTE FUNCTION public.groups_school_timetable_sync();

-- 4. RLS helper: the sections a teacher teaches (homeroom or a subject) -----------
-- SECURITY DEFINER so the policies below can use it without RLS recursion (groups ↔ school_subject_teachers).
CREATE OR REPLACE FUNCTION public.current_teacher_section_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT st.group_id FROM public.school_subject_teachers st
    JOIN public.users u ON u.id = st.teacher_id AND u.is_active IS NOT FALSE
   WHERE st.teacher_id = auth.uid() AND st.deleted_at IS NULL
  UNION
  SELECT g.id FROM public.groups g
    JOIN public.users u ON u.id = g.teacher_id AND u.is_active IS NOT FALSE
   WHERE g.teacher_id = auth.uid() AND g.school_grade_id IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.current_teacher_section_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_teacher_section_ids() TO app_user;

-- Neon's default privileges hand service_role (a Supabase leftover the app never uses) rights on new objects.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON FUNCTION public.school_curriculum_row_check() FROM service_role;
    REVOKE ALL ON FUNCTION public.school_slot_check() FROM service_role;
    REVOKE ALL ON FUNCTION public.school_timetable_sync() FROM service_role;
    REVOKE ALL ON FUNCTION public.groups_school_timetable_sync() FROM service_role;
    REVOKE ALL ON FUNCTION public.current_teacher_section_ids() FROM service_role;
  END IF;
END $$;

-- 5. RLS + privileges on the new tables -------------------------------------------
ALTER TABLE public.school_subjects         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_grade_subjects   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_periods          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_subject_teachers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.school_subjects, public.school_grade_subjects, public.school_periods, public.school_subject_teachers
  FROM PUBLIC, anon, authenticated, app_user, app_service, app_system;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON public.school_subjects, public.school_grade_subjects, public.school_periods, public.school_subject_teachers
      FROM service_role;
  END IF;
END $$;
GRANT SELECT ON public.school_subjects, public.school_grade_subjects, public.school_periods, public.school_subject_teachers TO app_user;
GRANT SELECT, INSERT, UPDATE ON public.school_subjects, public.school_grade_subjects, public.school_periods, public.school_subject_teachers
  TO app_service;

-- the catalogue: the school's own accounts (names only), like 0013's structure
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['school_subjects', 'school_grade_subjects', 'school_periods'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO app_user USING (deleted_at IS NULL AND ('
      || 'tenant_id = (SELECT public.current_tenant_id()) OR (SELECT public.current_user_role()) = ''super_admin''))',
      t || '_select', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['school_subjects', 'school_grade_subjects', 'school_periods', 'school_subject_teachers'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'svc_' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO app_service USING (public.svc_tenant_ok(tenant_id)) WITH CHECK (public.svc_tenant_ok(tenant_id))',
      'svc_' || t, t);
  END LOOP;
END $$;

-- who teaches what: staff of the school; a teacher for the sections they teach; a student for their own sections
DROP POLICY IF EXISTS school_subject_teachers_select ON public.school_subject_teachers;
CREATE POLICY school_subject_teachers_select ON public.school_subject_teachers FOR SELECT TO app_user USING (
  deleted_at IS NULL
  AND (
    (SELECT public.current_user_role()) = 'super_admin'
    OR (
      tenant_id = (SELECT public.current_tenant_id())
      AND (
        (SELECT public.current_user_role()) IN ('university_admin', 'center_manager')
        OR ((SELECT public.current_user_role()) = 'teacher' AND group_id IN (SELECT public.current_teacher_section_ids()))
        OR ((SELECT public.current_user_role()) = 'student' AND group_id IN (SELECT public.current_student_group_ids()))
      )
    )
  )
);

-- 6. A subject teacher also sees the sections they teach (homeroom rule of 0013 unchanged) --------
ALTER POLICY groups_select ON public.groups TO anon, authenticated, app_user USING (
  deleted_at IS NULL
  AND (
    (SELECT public.current_user_role()) = 'super_admin'
    OR ((SELECT public.current_user_role()) <> 'student' AND tenant_id = (SELECT public.current_tenant_id()))
    OR ((SELECT public.current_user_role()) = 'student' AND id IN (SELECT public.current_student_group_ids()))
  )
  AND (
    school_grade_id IS NULL
    OR (SELECT public.current_user_role()) IS DISTINCT FROM 'teacher'
    OR teacher_id = (SELECT auth.uid())
    OR id IN (SELECT public.current_teacher_section_ids())
  )
);

-- ... and those sections' timetables (a section has one group timetable, like every group)
ALTER POLICY schedules_select ON public.schedules TO anon, authenticated, app_user USING (
  (SELECT public.current_user_role()) = 'super_admin'
  OR (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      (SELECT public.current_user_role()) IN ('university_admin', 'center_manager')
      OR (
        (SELECT public.current_user_role()) = 'teacher'
        AND (teacher_id = (SELECT auth.uid())
             OR group_id IN (SELECT g.id FROM public.groups g WHERE g.teacher_id = (SELECT auth.uid()))
             OR group_id IN (SELECT public.current_teacher_section_ids()))
      )
    )
  )
);

ALTER POLICY schedule_slots_select ON public.schedule_slots TO anon, authenticated, app_user USING (
  EXISTS (
    SELECT 1 FROM public.schedules s
     WHERE s.id = schedule_slots.schedule_id
       AND (
         (SELECT public.current_user_role()) = 'super_admin'
         OR (
           s.tenant_id = (SELECT public.current_tenant_id())
           AND (
             (SELECT public.current_user_role()) IN ('university_admin', 'center_manager')
             OR (
               (SELECT public.current_user_role()) = 'teacher'
               AND (s.teacher_id = (SELECT auth.uid())
                    OR s.group_id IN (SELECT g.id FROM public.groups g WHERE g.teacher_id = (SELECT auth.uid()))
                    OR s.group_id IN (SELECT public.current_teacher_section_ids()))
             )
           )
         )
       )
  )
);

COMMIT;
