-- =============================================================================
-- Academic structure — a flexible two-level tree + academic terms
-- =============================================================================
-- EduQuest had no academic structure at all (no faculties/departments, no
-- stages/grades, no semesters). One generic shape serves every institution
-- type; the UI names each level from src/lib/terminology.ts:
--   university → Faculty › Department      school → Stage › Grade
--   institute  → Division › Program       training_center → Track › Program
--   company    → Department › Unit
--
-- Tables
--   academic_units  — level 1 (parent_id NULL) or level 2 (parent = a level-1 unit)
--   academic_terms  — named date ranges; at most one is_current per tenant
--   groups.academic_unit_id, groups.term_id, courses.academic_unit_id — nullable links
--
-- Security (same shape as schedules / announcements):
--   * SELECT policy only, tenant-scoped, archived rows hidden.
--   * Table writes revoked from anon/authenticated — all writes go through
--     /api/academic/* which checks `manage_academic_structure` with the user
--     session and then writes with the service-role client.
--   * Triggers reject any cross-tenant link (parent unit, group→unit/term,
--     course→unit) even for the service role — the lesson from
--     fix_rls_write_path_migration.sql: never trust a foreign id's tenant.
--
-- OPT-IN PER TENANT — tenants.structure_mode:
--   'flat'     (DEFAULT) the original structure: groups + courses only. The
--              academic structure is invisible and every write to it — new
--              units/terms, or linking a group/course — is rejected here in
--              the DB, not only in the UI/API.
--   'academic' faculties/departments + terms enabled. Set by super_admin only.
-- Switching back to 'flat' hides everything without deleting anything;
-- switching to 'academic' again brings it all back as it was.
--
-- Nothing existing changes behaviour: every tenant starts 'flat', new columns
-- are NULL, new tables empty.
-- Idempotent — safe to re-run.
-- =============================================================================

-- ── tenants.structure_mode ───────────────────────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS structure_mode TEXT NOT NULL DEFAULT 'flat';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_structure_mode_check') THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_structure_mode_check CHECK (structure_mode IN ('flat', 'academic'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.assert_tenant_academic_mode(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tenants WHERE id = p_tenant_id AND structure_mode = 'academic'
  ) THEN
    RAISE EXCEPTION 'academic structure is not enabled for this tenant' USING ERRCODE = '55000';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assert_tenant_academic_mode(UUID) FROM PUBLIC, anon, authenticated;

-- Units and terms can only be created or edited while the tenant is 'academic'.
CREATE OR REPLACE FUNCTION public.academic_rows_require_mode()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_tenant_academic_mode(NEW.tenant_id);
  RETURN NEW;
END;
$$;

-- ── academic_units ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.academic_units (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  parent_id   UUID REFERENCES public.academic_units(id) ON DELETE CASCADE,
  level       SMALLINT NOT NULL CHECK (level IN (1, 2)),
  name        TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  code        TEXT CHECK (code IS NULL OR char_length(code) <= 30),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT academic_units_level_parent_check
    CHECK ((level = 1 AND parent_id IS NULL) OR (level = 2 AND parent_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_academic_units_tenant ON public.academic_units (tenant_id, level, sort_order)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_academic_units_parent ON public.academic_units (parent_id);

CREATE OR REPLACE FUNCTION public.academic_units_check_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p RECORD;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT tenant_id, level INTO p FROM public.academic_units WHERE id = NEW.parent_id;
  IF NOT FOUND OR p.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'academic unit parent must belong to the same tenant' USING ERRCODE = '42501';
  END IF;
  IF p.level <> 1 THEN
    RAISE EXCEPTION 'academic unit parent must be a level-1 unit' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_academic_units_check_parent ON public.academic_units;
CREATE TRIGGER trg_academic_units_check_parent
  BEFORE INSERT OR UPDATE OF parent_id, tenant_id ON public.academic_units
  FOR EACH ROW EXECUTE FUNCTION public.academic_units_check_parent();

DROP TRIGGER IF EXISTS trg_academic_units_require_mode ON public.academic_units;
CREATE TRIGGER trg_academic_units_require_mode
  BEFORE INSERT OR UPDATE ON public.academic_units
  FOR EACH ROW EXECUTE FUNCTION public.academic_rows_require_mode();

-- ── academic_terms ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.academic_terms (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  starts_on   DATE NOT NULL,
  ends_on     DATE NOT NULL,
  is_current  BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT academic_terms_dates_check CHECK (ends_on > starts_on)
);

CREATE INDEX IF NOT EXISTS idx_academic_terms_tenant ON public.academic_terms (tenant_id, starts_on DESC)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_academic_terms_one_current
  ON public.academic_terms (tenant_id) WHERE is_current AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_academic_terms_require_mode ON public.academic_terms;
CREATE TRIGGER trg_academic_terms_require_mode
  BEFORE INSERT OR UPDATE ON public.academic_terms
  FOR EACH ROW EXECUTE FUNCTION public.academic_rows_require_mode();

-- ── links from existing tables ───────────────────────────────────────────────
ALTER TABLE public.groups  ADD COLUMN IF NOT EXISTS academic_unit_id UUID REFERENCES public.academic_units(id) ON DELETE SET NULL;
ALTER TABLE public.groups  ADD COLUMN IF NOT EXISTS term_id          UUID REFERENCES public.academic_terms(id) ON DELETE SET NULL;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS academic_unit_id UUID REFERENCES public.academic_units(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_groups_academic_unit_id  ON public.groups (academic_unit_id);
CREATE INDEX IF NOT EXISTS idx_groups_term_id           ON public.groups (term_id);
CREATE INDEX IF NOT EXISTS idx_courses_academic_unit_id ON public.courses (academic_unit_id);

CREATE OR REPLACE FUNCTION public.check_academic_links_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_term UUID;
  v_old_term UUID;
  v_old_unit UUID;
BEGIN
  IF TG_TABLE_NAME = 'groups' THEN
    v_new_term := NEW.term_id;
    IF TG_OP = 'UPDATE' THEN v_old_term := OLD.term_id; END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN v_old_unit := OLD.academic_unit_id; END IF;

  -- Setting a NEW non-null link needs academic mode. Clearing a link, or
  -- leaving an existing one untouched (e.g. after reverting to 'flat'), is fine.
  IF (NEW.academic_unit_id IS NOT NULL AND NEW.academic_unit_id IS DISTINCT FROM v_old_unit)
     OR (v_new_term IS NOT NULL AND v_new_term IS DISTINCT FROM v_old_term) THEN
    PERFORM public.assert_tenant_academic_mode(NEW.tenant_id);
  END IF;

  IF NEW.academic_unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.academic_units
    WHERE id = NEW.academic_unit_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'academic unit must belong to the same tenant' USING ERRCODE = '42501';
  END IF;

  IF v_new_term IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.academic_terms
    WHERE id = v_new_term AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'academic term must belong to the same tenant' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_groups_academic_links ON public.groups;
CREATE TRIGGER trg_groups_academic_links
  BEFORE INSERT OR UPDATE OF academic_unit_id, term_id, tenant_id ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.check_academic_links_tenant();

DROP TRIGGER IF EXISTS trg_courses_academic_links ON public.courses;
CREATE TRIGGER trg_courses_academic_links
  BEFORE INSERT OR UPDATE OF academic_unit_id, tenant_id ON public.courses
  FOR EACH ROW EXECUTE FUNCTION public.check_academic_links_tenant();

-- Trigger-only functions: never directly callable
-- (revoke_trigger_function_public_execute_migration.sql pattern).
REVOKE EXECUTE ON FUNCTION public.academic_units_check_parent()  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.academic_rows_require_mode()   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_academic_links_tenant() FROM PUBLIC, anon, authenticated;

-- ── RLS: read-only, tenant-scoped ────────────────────────────────────────────
ALTER TABLE public.academic_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS academic_units_select ON public.academic_units;
CREATE POLICY academic_units_select ON public.academic_units FOR SELECT USING (
  deleted_at IS NULL AND (
    tenant_id = (SELECT current_tenant_id())
    OR (SELECT current_user_role()) = 'super_admin'
  )
);

DROP POLICY IF EXISTS academic_terms_select ON public.academic_terms;
CREATE POLICY academic_terms_select ON public.academic_terms FOR SELECT USING (
  deleted_at IS NULL AND (
    tenant_id = (SELECT current_tenant_id())
    OR (SELECT current_user_role()) = 'super_admin'
  )
);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.academic_units FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.academic_terms FROM anon, authenticated;
REVOKE ALL ON public.academic_units FROM anon;
REVOKE ALL ON public.academic_terms FROM anon;
GRANT SELECT ON public.academic_units TO authenticated;
GRANT SELECT ON public.academic_terms TO authenticated;
