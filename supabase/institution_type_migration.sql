-- =============================================================================
-- tenants.institution_type — EduQuest serves every kind of institution
-- =============================================================================
-- Until now every tenant was implicitly a university. The type drives the
-- vocabulary shown in the UI (src/lib/terminology.ts): "مدير المدرسة" vs
-- "مدير الجامعة", "صف" vs "قسم", and so on. Role names in the database
-- (university_admin, …) are deliberately NOT renamed — they are baked into RLS
-- policies and JWT claims; only the labels change.
--
-- DEFAULT 'university' ⇒ every existing tenant keeps its exact current look.
-- Writable by super_admin only — the existing "tenants_manage" policy already
-- covers it, and api/admin/tenant-branding (the tenant admin's own route)
-- does not accept this column.
--
-- Idempotent — safe to re-run.
-- =============================================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS institution_type TEXT NOT NULL DEFAULT 'university';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_institution_type_check'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_institution_type_check
      CHECK (institution_type IN ('university','school','institute','training_center','company'));
  END IF;
END $$;

-- =============================================================================
-- tenants.has_center — the "university student / centre student" split and the
-- centre_manager role only exist for institutions with an attached
-- continuing-education centre.
-- =============================================================================
-- DEFAULT TRUE ⇒ every existing tenant keeps the centre features it has today.
-- New tenants get it set explicitly from /super-admin/tenants (on for a
-- university, off for other types by default).
--
-- When FALSE the app hides the centre UI, treats every student as a student of
-- the institution (no affiliation split, every announcement audience open),
-- and refuses to create centre managers. The trigger below enforces the last
-- rule in the DB too, so no route can create one by mistake. Turning it off
-- never deletes or demotes existing centre managers.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS has_center BOOLEAN NOT NULL DEFAULT TRUE;

CREATE OR REPLACE FUNCTION public.users_center_manager_requires_center()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role = 'center_manager'
     AND (TG_OP = 'INSERT' OR OLD.role IS DISTINCT FROM NEW.role OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id)
     AND EXISTS (SELECT 1 FROM public.tenants WHERE id = NEW.tenant_id AND has_center = FALSE)
  THEN
    RAISE EXCEPTION 'this institution has no continuing-education centre' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_center_manager_requires_center ON public.users;
CREATE TRIGGER trg_users_center_manager_requires_center
  BEFORE INSERT OR UPDATE OF role, tenant_id ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_center_manager_requires_center();

REVOKE EXECUTE ON FUNCTION public.users_center_manager_requires_center() FROM PUBLIC, anon, authenticated;
