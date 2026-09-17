-- =============================================================================
-- Groups ↔ courses, group image/rules, and student transfers with frozen progress
-- =============================================================================
-- Does NOT touch the curriculum: courses, levels, units, items, student_progress
-- and the course player are read, never altered.
--
-- 1. groups.course_id (optional) — a group MAY be a section of one course. A
--    student sees a group under a course only when BOTH hold: the group is
--    linked to that course AND the student is a member. Membership in both a
--    course and an unlinked group never implies a link. Adding a student to a
--    linked group also enrols them in the course (done in /api/group-students).
-- 2. groups.image_url, groups.max_students (NULL = no cap), groups.instructions.
-- 3. group_transfers — append-only history of moves between groups. When the
--    move changes course, the old course's progress is snapshotted here at the
--    moment of transfer (frozen_*) and the old enrolment is removed, so nothing
--    the student does later is ever counted on the old course and nothing old is
--    counted on the new one. student_progress rows are kept untouched.
-- 4. transfer_student_group() — does the whole move atomically. Service role
--    only (called by /api/group-transfers after the capability check).
--
-- Nothing existing changes behaviour: new columns are NULL, new table empty.
-- Idempotent — safe to re-run.
-- =============================================================================

-- ── 1–2. group columns ───────────────────────────────────────────────────────
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS course_id    UUID REFERENCES public.courses(id) ON DELETE SET NULL;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS image_url    TEXT;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS max_students INTEGER;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS instructions TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'groups_max_students_check') THEN
    ALTER TABLE public.groups ADD CONSTRAINT groups_max_students_check CHECK (max_students IS NULL OR max_students > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'groups_instructions_len_check') THEN
    ALTER TABLE public.groups ADD CONSTRAINT groups_instructions_len_check CHECK (instructions IS NULL OR char_length(instructions) <= 2000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'groups_image_url_check') THEN
    ALTER TABLE public.groups ADD CONSTRAINT groups_image_url_check CHECK (image_url IS NULL OR image_url ~ '^https://');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_groups_course_id ON public.groups (course_id);

CREATE OR REPLACE FUNCTION public.check_group_course_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.course_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.courses WHERE id = NEW.course_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'group course must belong to the same tenant' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_groups_course_tenant ON public.groups;
CREATE TRIGGER trg_groups_course_tenant
  BEFORE INSERT OR UPDATE OF course_id, tenant_id ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.check_group_course_tenant();

REVOKE EXECUTE ON FUNCTION public.check_group_course_tenant() FROM PUBLIC, anon, authenticated;

-- ── 3. transfer history ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.group_transfers (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  student_id          UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  from_group_id       UUID REFERENCES public.groups(id) ON DELETE SET NULL,
  to_group_id         UUID REFERENCES public.groups(id) ON DELETE SET NULL,
  from_course_id      UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  to_course_id        UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  -- Name snapshots: history must still read correctly after a rename or delete.
  from_group_name     TEXT NOT NULL,
  to_group_name       TEXT NOT NULL,
  from_course_title   TEXT,
  to_course_title     TEXT,
  -- Old course progress frozen at the moment of transfer (only when the course changed).
  course_changed      BOOLEAN NOT NULL DEFAULT FALSE,
  frozen_completed    INTEGER,
  frozen_total        INTEGER,
  reason              TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  transferred_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_transfers_student ON public.group_transfers (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_transfers_tenant  ON public.group_transfers (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_transfers_from_group  ON public.group_transfers (from_group_id);
CREATE INDEX IF NOT EXISTS idx_group_transfers_to_group    ON public.group_transfers (to_group_id);
CREATE INDEX IF NOT EXISTS idx_group_transfers_from_course ON public.group_transfers (from_course_id);
CREATE INDEX IF NOT EXISTS idx_group_transfers_to_course   ON public.group_transfers (to_course_id);
CREATE INDEX IF NOT EXISTS idx_group_transfers_by          ON public.group_transfers (transferred_by);

ALTER TABLE public.group_transfers ENABLE ROW LEVEL SECURITY;

-- The student reads their own history; staff read their tenant's. No write policy.
DROP POLICY IF EXISTS group_transfers_select ON public.group_transfers;
CREATE POLICY group_transfers_select ON public.group_transfers FOR SELECT USING (
  student_id = (SELECT auth.uid())
  OR (SELECT current_user_role()) = 'super_admin'
  OR ( (SELECT current_user_role()) IN ('university_admin', 'center_manager')
       AND tenant_id = (SELECT current_tenant_id()) )
);

REVOKE ALL ON public.group_transfers FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.group_transfers FROM authenticated;
GRANT SELECT ON public.group_transfers TO authenticated;

-- ── 4. atomic transfer ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_student_group(
  p_actor      UUID,
  p_student_id UUID,
  p_from_group UUID,
  p_to_group   UUID,
  p_reason     TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor    RECORD;
  v_student  RECORD;
  v_from     RECORD;
  v_to       RECORD;
  v_count    INTEGER;
  v_changed  BOOLEAN;
  v_total    INTEGER;
  v_done     INTEGER;
  v_from_title TEXT;
  v_to_title   TEXT;
  v_id       UUID;
BEGIN
  -- Re-derive every fact; never trust the caller (r1_defense_in_depth pattern).
  SELECT role, tenant_id, is_active INTO v_actor FROM public.users WHERE id = p_actor;
  IF NOT FOUND OR v_actor.is_active IS NOT TRUE
     OR v_actor.role NOT IN ('super_admin', 'university_admin', 'center_manager') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT role, tenant_id INTO v_student FROM public.users WHERE id = p_student_id;
  IF NOT FOUND OR v_student.role <> 'student' THEN
    RAISE EXCEPTION 'STUDENT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_actor.role <> 'super_admin' AND v_actor.tenant_id IS DISTINCT FROM v_student.tenant_id THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF p_from_group = p_to_group THEN
    RAISE EXCEPTION 'SAME_GROUP' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;

  SELECT id, name, tenant_id, course_id INTO v_from FROM public.groups WHERE id = p_from_group;
  -- Lock the destination so two concurrent transfers can't both take the last seat.
  SELECT id, name, tenant_id, course_id, is_active, max_students INTO v_to
    FROM public.groups WHERE id = p_to_group FOR UPDATE;
  IF v_from.id IS NULL OR v_to.id IS NULL
     OR v_from.tenant_id <> v_student.tenant_id OR v_to.tenant_id <> v_student.tenant_id THEN
    RAISE EXCEPTION 'GROUP_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_to.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'GROUP_ARCHIVED' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.group_students WHERE group_id = p_from_group AND student_id = p_student_id) THEN
    RAISE EXCEPTION 'NOT_IN_GROUP' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.group_students WHERE group_id = p_to_group AND student_id = p_student_id) THEN
    RAISE EXCEPTION 'ALREADY_IN_GROUP' USING ERRCODE = '23505';
  END IF;
  IF v_to.max_students IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count FROM public.group_students WHERE group_id = p_to_group;
    IF v_count >= v_to.max_students THEN
      RAISE EXCEPTION 'GROUP_FULL' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_changed := v_from.course_id IS NOT NULL AND v_from.course_id IS DISTINCT FROM v_to.course_id;

  IF v_from.course_id IS NOT NULL THEN
    SELECT title INTO v_from_title FROM public.courses WHERE id = v_from.course_id;
  END IF;
  IF v_to.course_id IS NOT NULL THEN
    SELECT title INTO v_to_title FROM public.courses WHERE id = v_to.course_id;
  END IF;

  IF v_changed THEN
    -- Same counting rule as get_course_progress (read-only).
    SELECT COUNT(*) INTO v_total
      FROM public.unit_items ui JOIN public.course_units cu ON cu.id = ui.unit_id
     WHERE cu.course_id = v_from.course_id AND ui.is_published = TRUE;
    SELECT COUNT(*) INTO v_done
      FROM public.student_progress sp
      JOIN public.unit_items ui   ON ui.id = sp.unit_item_id
      JOIN public.course_units cu ON cu.id = ui.unit_id
     WHERE cu.course_id = v_from.course_id AND sp.student_id = p_student_id AND ui.is_published = TRUE;
  END IF;

  DELETE FROM public.group_students WHERE group_id = p_from_group AND student_id = p_student_id;
  INSERT INTO public.group_students (group_id, student_id) VALUES (p_to_group, p_student_id);

  IF v_to.course_id IS NOT NULL THEN
    INSERT INTO public.course_enrollments (course_id, student_id, tenant_id)
    VALUES (v_to.course_id, p_student_id, v_student.tenant_id)
    ON CONFLICT (course_id, student_id) DO NOTHING;
  END IF;

  -- Leaving the old course: its progress is frozen in the history row above.
  -- The enrolment goes; student_progress rows stay exactly as they were.
  IF v_changed THEN
    DELETE FROM public.course_enrollments WHERE course_id = v_from.course_id AND student_id = p_student_id;
  END IF;

  INSERT INTO public.group_transfers (
    tenant_id, student_id, from_group_id, to_group_id, from_course_id, to_course_id,
    from_group_name, to_group_name, from_course_title, to_course_title,
    course_changed, frozen_completed, frozen_total, reason, transferred_by
  ) VALUES (
    v_student.tenant_id, p_student_id, p_from_group, p_to_group, v_from.course_id, v_to.course_id,
    v_from.name, v_to.name, v_from_title, v_to_title,
    v_changed, CASE WHEN v_changed THEN v_done END, CASE WHEN v_changed THEN v_total END,
    btrim(p_reason), p_actor
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.transfer_student_group(UUID, UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_student_group(UUID, UUID, UUID, UUID, TEXT) TO service_role;
