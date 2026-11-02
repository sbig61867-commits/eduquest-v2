-- 0013 — school structure (الهيكل المدرسي). Neon only; never run on Supabase.
-- PENDING: needs the owner's approval before it is applied. Idempotent.
-- Design: docs/claude/tasks/school-structure-plan.md
--
-- For tenants whose institution_type = 'school':
--   school_stages   المراحل   typed kindergarten / basic / secondary, ordered, optional code
--   school_grades   الصفوف    under a stage, ordered, optional track (general / scientific / literary)
--   school_years    السنة الدراسية  dates, at most ONE active year per tenant
--   school_terms    الفصول    under a year, numbered, inside the year's dates
--   sections (الشعب) REUSE public.groups: a group with school_grade_id + school_year_id + section_label
--                   (+ optional shift). Capacity = groups.max_students; homeroom teacher = groups.teacher_id,
--                   which becomes optional for sections ONLY (every other group still needs a teacher).
--   placement (التسكين) REUSES public.group_students; school_year_id is copied from the group by a trigger
--                   and a partial unique index allows one section per student per year.
--
-- Reads: app_user under RLS (own tenant; the structure is the school's catalogue). Teachers see only the
-- sections they are homeroom teacher of (one new clause in groups_select, no-op for non-section groups).
-- Writes: app_service only, pinned to the institution (svc_tenant_ok), after /api/school/* has checked the
-- caller's manage_academic_structure capability. No DELETE right: archive = deleted_at.
-- Every function here is a trigger function: SECURITY DEFINER, schema-qualified, search_path pinned,
-- execute revoked from PUBLIC/anon/authenticated, no auth.uid() (CLAUDE.md hard rules 1–3).
-- Non-school tenants: new tables empty, new columns NULL, partial indexes empty, triggers return at once.

BEGIN;

-- 1. Helper ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_assert_school_tenant(p_tenant uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = p_tenant AND t.institution_type = 'school') THEN
    RAISE EXCEPTION 'the school structure is only available to schools' USING ERRCODE = '55000';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.school_assert_school_tenant(uuid) FROM PUBLIC, anon, authenticated;

-- 2. Tables ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_stages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind        text NOT NULL CONSTRAINT school_stages_kind_check CHECK (kind IN ('kindergarten', 'basic', 'secondary')),
  name        text NOT NULL CONSTRAINT school_stages_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  code        text CONSTRAINT school_stages_code_check CHECK (code IS NULL OR char_length(btrim(code)) BETWEEN 1 AND 30),
  sort_order  integer NOT NULL DEFAULT 0,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS school_stages_tenant_idx ON public.school_stages (tenant_id, sort_order) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS school_stages_code_uq ON public.school_stages (tenant_id, lower(code))
  WHERE deleted_at IS NULL AND code IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.school_grades (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  stage_id    uuid NOT NULL REFERENCES public.school_stages(id) ON DELETE CASCADE,
  name        text NOT NULL CONSTRAINT school_grades_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  code        text CONSTRAINT school_grades_code_check CHECK (code IS NULL OR char_length(btrim(code)) BETWEEN 1 AND 30),
  track       text CONSTRAINT school_grades_track_check CHECK (track IS NULL OR track IN ('general', 'scientific', 'literary')),
  sort_order  integer NOT NULL DEFAULT 0,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS school_grades_stage_idx ON public.school_grades (stage_id, sort_order);
CREATE INDEX IF NOT EXISTS school_grades_tenant_idx ON public.school_grades (tenant_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS school_grades_code_uq ON public.school_grades (tenant_id, lower(code))
  WHERE deleted_at IS NULL AND code IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.school_years (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CONSTRAINT school_years_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  is_active   boolean NOT NULL DEFAULT false,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_years_dates_check CHECK (ends_on > starts_on),
  CONSTRAINT school_years_archived_inactive_check CHECK (deleted_at IS NULL OR NOT is_active)
);
CREATE INDEX IF NOT EXISTS school_years_tenant_idx ON public.school_years (tenant_id, starts_on DESC) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS school_years_one_active_uq ON public.school_years (tenant_id) WHERE is_active AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS school_years_name_uq ON public.school_years (tenant_id, lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.school_terms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  year_id     uuid NOT NULL REFERENCES public.school_years(id) ON DELETE CASCADE,
  term_no     smallint NOT NULL CONSTRAINT school_terms_no_check CHECK (term_no BETWEEN 1 AND 4),
  name        text NOT NULL CONSTRAINT school_terms_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_terms_dates_check CHECK (ends_on > starts_on)
);
CREATE INDEX IF NOT EXISTS school_terms_year_idx ON public.school_terms (year_id, term_no);
CREATE INDEX IF NOT EXISTS school_terms_tenant_idx ON public.school_terms (tenant_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS school_terms_no_uq ON public.school_terms (year_id, term_no) WHERE deleted_at IS NULL;

-- 3. Sections = groups --------------------------------------------------------
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS school_grade_id uuid REFERENCES public.school_grades(id);
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS school_year_id  uuid REFERENCES public.school_years(id);
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS section_label   text;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS shift           text;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS section_order   integer;

-- The homeroom teacher is optional for a section; every other group keeps a required teacher.
ALTER TABLE public.groups ALTER COLUMN teacher_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'groups_teacher_required_check') THEN
    ALTER TABLE public.groups ADD CONSTRAINT groups_teacher_required_check
      CHECK (teacher_id IS NOT NULL OR school_grade_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'groups_section_shape_check') THEN
    ALTER TABLE public.groups ADD CONSTRAINT groups_section_shape_check CHECK (
      (school_grade_id IS NULL AND school_year_id IS NULL AND section_label IS NULL AND shift IS NULL AND section_order IS NULL)
      OR (school_grade_id IS NOT NULL AND school_year_id IS NOT NULL AND section_label IS NOT NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'groups_section_label_check') THEN
    ALTER TABLE public.groups ADD CONSTRAINT groups_section_label_check
      CHECK (section_label IS NULL OR char_length(btrim(section_label)) BETWEEN 1 AND 20);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'groups_shift_check') THEN
    ALTER TABLE public.groups ADD CONSTRAINT groups_shift_check
      CHECK (shift IS NULL OR shift IN ('morning', 'evening'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS groups_school_grade_idx ON public.groups (school_grade_id) WHERE school_grade_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS groups_school_year_idx ON public.groups (tenant_id, school_year_id, school_grade_id) WHERE school_grade_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS groups_school_year_fk_idx ON public.groups (school_year_id) WHERE school_year_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS groups_section_label_uq ON public.groups (school_year_id, school_grade_id, lower(btrim(section_label)))
  WHERE school_grade_id IS NOT NULL AND deleted_at IS NULL;

-- 4. Placement = group_students ----------------------------------------------
ALTER TABLE public.group_students ADD COLUMN IF NOT EXISTS school_year_id uuid REFERENCES public.school_years(id);
CREATE UNIQUE INDEX IF NOT EXISTS group_students_one_section_per_year_uq ON public.group_students (student_id, school_year_id)
  WHERE school_year_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS group_students_school_year_idx ON public.group_students (school_year_id) WHERE school_year_id IS NOT NULL;

-- 5. Integrity triggers -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_structure_row_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v record;
BEGIN
  -- archiving is always allowed; anything else needs a school
  IF NEW.deleted_at IS NOT NULL AND TG_OP = 'UPDATE' THEN
    RETURN NEW;
  END IF;
  PERFORM public.school_assert_school_tenant(NEW.tenant_id);

  IF TG_TABLE_NAME = 'school_grades' THEN
    IF TG_OP = 'INSERT' OR NEW.stage_id IS DISTINCT FROM OLD.stage_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      IF NOT EXISTS (SELECT 1 FROM public.school_stages s
                      WHERE s.id = NEW.stage_id AND s.tenant_id = NEW.tenant_id AND s.deleted_at IS NULL) THEN
        RAISE EXCEPTION 'a grade needs a live stage of the same school' USING ERRCODE = '42501';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'school_terms' THEN
    SELECT y.tenant_id, y.starts_on, y.ends_on, y.deleted_at INTO v FROM public.school_years y WHERE y.id = NEW.year_id;
    IF NOT FOUND OR v.tenant_id <> NEW.tenant_id THEN
      RAISE EXCEPTION 'a term needs a year of the same school' USING ERRCODE = '42501';
    END IF;
    IF v.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'the academic year is archived' USING ERRCODE = '55000';
    END IF;
    IF NEW.starts_on < v.starts_on OR NEW.ends_on > v.ends_on THEN
      RAISE EXCEPTION 'a term must lie inside its academic year' USING ERRCODE = '23514';
    END IF;

  ELSIF TG_TABLE_NAME = 'school_years' AND TG_OP = 'UPDATE' THEN
    IF EXISTS (SELECT 1 FROM public.school_terms t
                WHERE t.year_id = NEW.id AND t.deleted_at IS NULL
                  AND (t.starts_on < NEW.starts_on OR t.ends_on > NEW.ends_on)) THEN
      RAISE EXCEPTION 'a term would fall outside the academic year' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.school_structure_row_check() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_school_stages_check ON public.school_stages;
CREATE TRIGGER trg_school_stages_check BEFORE INSERT OR UPDATE ON public.school_stages
  FOR EACH ROW EXECUTE FUNCTION public.school_structure_row_check();
DROP TRIGGER IF EXISTS trg_school_grades_check ON public.school_grades;
CREATE TRIGGER trg_school_grades_check BEFORE INSERT OR UPDATE ON public.school_grades
  FOR EACH ROW EXECUTE FUNCTION public.school_structure_row_check();
DROP TRIGGER IF EXISTS trg_school_years_check ON public.school_years;
CREATE TRIGGER trg_school_years_check BEFORE INSERT OR UPDATE ON public.school_years
  FOR EACH ROW EXECUTE FUNCTION public.school_structure_row_check();
DROP TRIGGER IF EXISTS trg_school_terms_check ON public.school_terms;
CREATE TRIGGER trg_school_terms_check BEFORE INSERT OR UPDATE ON public.school_terms
  FOR EACH ROW EXECUTE FUNCTION public.school_structure_row_check();

CREATE OR REPLACE FUNCTION public.groups_school_section_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.school_year_id IS NOT NULL AND NEW.school_year_id IS DISTINCT FROM OLD.school_year_id THEN
    RAISE EXCEPTION 'a section stays in its academic year' USING ERRCODE = '55000';
  END IF;
  IF NEW.school_grade_id IS NULL THEN
    RETURN NEW;  -- an ordinary group: nothing to check
  END IF;

  IF TG_OP = 'INSERT' OR NEW.school_grade_id IS DISTINCT FROM OLD.school_grade_id
     OR NEW.school_year_id IS DISTINCT FROM OLD.school_year_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    PERFORM public.school_assert_school_tenant(NEW.tenant_id);
    IF NOT EXISTS (SELECT 1 FROM public.school_grades g
                    WHERE g.id = NEW.school_grade_id AND g.tenant_id = NEW.tenant_id AND g.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'a section needs a live grade of the same school' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.school_years y
                    WHERE y.id = NEW.school_year_id AND y.tenant_id = NEW.tenant_id AND y.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'a section needs a live academic year of the same school' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.teacher_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.teacher_id IS DISTINCT FROM OLD.teacher_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.users u
                    WHERE u.id = NEW.teacher_id AND u.tenant_id = NEW.tenant_id AND u.role = 'teacher') THEN
      RAISE EXCEPTION 'the homeroom teacher must be a teacher of the same school' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.groups_school_section_check() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_groups_school_section ON public.groups;
CREATE TRIGGER trg_groups_school_section
  BEFORE INSERT OR UPDATE OF school_grade_id, school_year_id, teacher_id, tenant_id ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.groups_school_section_check();

CREATE OR REPLACE FUNCTION public.group_students_fill_school_year()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v record;
BEGIN
  -- never trusted from the writer: always the group's own year (NULL for an ordinary group)
  SELECT g.school_year_id, g.tenant_id INTO v FROM public.groups g WHERE g.id = NEW.group_id;
  NEW.school_year_id := v.school_year_id;
  IF v.school_year_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.users u WHERE u.id = NEW.student_id AND u.tenant_id = v.tenant_id AND u.role = 'student') THEN
    RAISE EXCEPTION 'only a student of the same school can be placed in a section' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.group_students_fill_school_year() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_group_students_school_year ON public.group_students;
CREATE TRIGGER trg_group_students_school_year
  BEFORE INSERT OR UPDATE OF group_id, student_id, school_year_id ON public.group_students
  FOR EACH ROW EXECUTE FUNCTION public.group_students_fill_school_year();

-- 6. RLS + privileges on the new tables -----------------------------------------
ALTER TABLE public.school_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_years  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_terms  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.school_stages, public.school_grades, public.school_years, public.school_terms
  FROM PUBLIC, anon, authenticated, app_user, app_service, app_system;
-- Neon's default privileges hand service_role (a Supabase leftover the app never uses) every right on new tables.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON public.school_stages, public.school_grades, public.school_years, public.school_terms FROM service_role;
  END IF;
END $$;
GRANT SELECT ON public.school_stages, public.school_grades, public.school_years, public.school_terms TO app_user;
GRANT SELECT, INSERT, UPDATE ON public.school_stages, public.school_grades, public.school_years, public.school_terms TO app_service;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['school_stages', 'school_grades', 'school_years', 'school_terms'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO app_user USING (deleted_at IS NULL AND ('
      || 'tenant_id = (SELECT public.current_tenant_id()) OR (SELECT public.current_user_role()) = ''super_admin''))',
      t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'svc_' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO app_service USING (public.svc_tenant_ok(tenant_id)) WITH CHECK (public.svc_tenant_ok(tenant_id))',
      'svc_' || t, t);
  END LOOP;
END $$;

-- 7. Teachers see only their own sections (no change for ordinary groups) ------
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
  )
);

COMMIT;
