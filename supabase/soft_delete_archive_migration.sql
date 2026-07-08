-- ============================================================
-- Unified soft-delete / archive foundation
-- ------------------------------------------------------------
-- Deleting a group / lesson / exam / course no longer destroys data.
-- Instead the row is stamped deleted_at = now() (deleted_by = actor).
-- Live queries filter `deleted_at IS NULL`; the archive keeps everything
-- so the university can, years later, ask "what was taught in 2026, by
-- whom, to which students, and what did they do".
--
-- Idempotent / re-runnable. Apply in the Supabase SQL editor (or via the
-- Management API).
-- ============================================================

-- ── 1. Soft-delete columns on every archivable entity ──────────────
ALTER TABLE groups  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE groups  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE exams   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE exams   ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Partial indexes: live queries only ever want the non-deleted rows.
CREATE INDEX IF NOT EXISTS idx_groups_live  ON groups (tenant_id)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lessons_live ON lessons (group_id)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_exams_live   ON exams (group_id)    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_courses_live ON courses (tenant_id) WHERE deleted_at IS NULL;

-- ── 2. Unified soft-delete RPC ─────────────────────────────────────
-- Cascades the archive stamp downward so a deleted group also archives
-- its lessons and exams (their submissions/grades stay intact and remain
-- reachable through the archive). Ownership is enforced by the caller;
-- this only stamps rows inside the given tenant.
CREATE OR REPLACE FUNCTION public.soft_delete_entity(
  p_kind      TEXT,   -- 'group' | 'lesson' | 'exam' | 'course'
  p_id        UUID,
  p_actor     UUID,
  p_tenant_id UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE _now TIMESTAMPTZ := now();
BEGIN
  IF p_kind = 'group' THEN
    UPDATE groups  SET deleted_at = _now, deleted_by = p_actor
      WHERE id = p_id AND tenant_id = p_tenant_id AND deleted_at IS NULL;
    UPDATE lessons SET deleted_at = _now, deleted_by = p_actor
      WHERE group_id = p_id AND deleted_at IS NULL;
    UPDATE exams   SET deleted_at = _now, deleted_by = p_actor
      WHERE group_id = p_id AND deleted_at IS NULL;

  ELSIF p_kind = 'lesson' THEN
    UPDATE lessons SET deleted_at = _now, deleted_by = p_actor
      WHERE id = p_id AND tenant_id = p_tenant_id AND deleted_at IS NULL;
    UPDATE exams   SET deleted_at = _now, deleted_by = p_actor
      WHERE lesson_id = p_id AND deleted_at IS NULL;

  ELSIF p_kind = 'exam' THEN
    UPDATE exams   SET deleted_at = _now, deleted_by = p_actor
      WHERE id = p_id AND tenant_id = p_tenant_id AND deleted_at IS NULL;

  ELSIF p_kind = 'course' THEN
    UPDATE courses SET deleted_at = _now, deleted_by = p_actor
      WHERE id = p_id AND tenant_id = p_tenant_id AND deleted_at IS NULL;

  ELSE
    RAISE EXCEPTION 'UNKNOWN_KIND';
  END IF;

  RETURN jsonb_build_object('ok', true, 'kind', p_kind, 'id', p_id, 'deleted_at', _now);
END $$;

-- Restore (un-archive) a single entity. Does NOT auto-restore children —
-- the admin restores the group, then chooses which lessons/exams to revive.
CREATE OR REPLACE FUNCTION public.restore_entity(
  p_kind      TEXT,
  p_id        UUID,
  p_tenant_id UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF    p_kind = 'group'  THEN UPDATE groups  SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id AND tenant_id = p_tenant_id;
  ELSIF p_kind = 'lesson' THEN UPDATE lessons SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id AND tenant_id = p_tenant_id;
  ELSIF p_kind = 'exam'   THEN UPDATE exams   SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id AND tenant_id = p_tenant_id;
  ELSIF p_kind = 'course' THEN UPDATE courses SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id AND tenant_id = p_tenant_id;
  ELSE RAISE EXCEPTION 'UNKNOWN_KIND';
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- ── 3. Unified historical archive view ─────────────────────────────
-- One query the university admin (or owner) uses to explore any year:
-- every group/course that existed, the teacher who ran it, how many
-- students were in it, how many lessons/exams, submissions, and whether
-- it is currently live or archived. Scoped to the caller's tenant.
CREATE OR REPLACE FUNCTION public.get_tenant_archive(
  p_tenant_id UUID,
  p_year      INTEGER DEFAULT NULL   -- NULL = all years
)
RETURNS TABLE (
  kind            TEXT,
  id              UUID,
  title           TEXT,
  teacher_id      UUID,
  teacher_name    TEXT,
  created_at      TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  is_archived     BOOLEAN,
  student_count   BIGINT,
  lesson_count    BIGINT,
  exam_count      BIGINT,
  submission_count BIGINT
)
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Groups (class sections)
  SELECT
    'group'::text, g.id, g.name, g.teacher_id, u.full_name,
    g.created_at, g.deleted_at, (g.deleted_at IS NOT NULL),
    (SELECT count(*) FROM group_students gs WHERE gs.group_id = g.id),
    (SELECT count(*) FROM lessons l WHERE l.group_id = g.id),
    (SELECT count(*) FROM exams e WHERE e.group_id = g.id),
    (SELECT count(*) FROM exam_submissions s
       JOIN exams e ON e.id = s.exam_id WHERE e.group_id = g.id)
  FROM groups g
  LEFT JOIN users u ON u.id = g.teacher_id
  WHERE g.tenant_id = p_tenant_id
    AND (p_year IS NULL OR EXTRACT(YEAR FROM g.created_at) = p_year)

  UNION ALL

  -- Courses (self-paced)
  SELECT
    'course'::text, c.id, c.title, c.teacher_id, u.full_name,
    c.created_at, c.deleted_at, (c.deleted_at IS NOT NULL),
    (SELECT count(*) FROM course_enrollments ce WHERE ce.course_id = c.id),
    0,
    (SELECT count(*) FROM exams e WHERE e.course_id = c.id),
    (SELECT count(*) FROM exam_submissions s
       JOIN exams e ON e.id = s.exam_id WHERE e.course_id = c.id)
  FROM courses c
  LEFT JOIN users u ON u.id = c.teacher_id
  WHERE c.tenant_id = p_tenant_id
    AND (p_year IS NULL OR EXTRACT(YEAR FROM c.created_at) = p_year)

  ORDER BY created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.soft_delete_entity(TEXT, UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_entity(TEXT, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_archive(UUID, INTEGER) TO authenticated;
