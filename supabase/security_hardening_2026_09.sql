-- EduQuest security hardening — 2026-09
-- Apply AFTER the existing migrations.
--
-- Fixes:
-- 1. soft-delete/archive SECURITY DEFINER RPCs were callable directly by any
--    authenticated user and trusted caller-supplied tenant/actor IDs.
-- 2. get_tenant_archive exposed cross-tenant historical data when called with
--    another tenant UUID.
-- 3. check_rate_limit was exposed as a generic RPC, allowing callers to poison
--    other users' rate-limit keys and windows.
-- 4. Public invitation max_uses was check-then-increment, allowing concurrent
--    redemptions to exceed the configured cap.

-- ── 1. Lock down admin-only archive RPCs ──────────────────────────
-- The application invokes these with the service-role client after doing the
-- ownership check in the API route. They do not need to be Data API-callable.
REVOKE EXECUTE ON FUNCTION public.soft_delete_entity(TEXT, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_entity(TEXT, UUID, UUID, UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.restore_entity(TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_entity(TEXT, UUID, UUID) TO service_role;

-- get_tenant_archive is used by the server-side admin archive page with the
-- user's session client, so keep authenticated EXECUTE but enforce the caller
-- inside the SECURITY DEFINER function.
CREATE OR REPLACE FUNCTION public.get_tenant_archive(
  p_tenant_id UUID,
  p_year INTEGER DEFAULT NULL
)
RETURNS TABLE (
  kind TEXT,
  id UUID,
  title TEXT,
  teacher_id UUID,
  teacher_name TEXT,
  created_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  is_archived BOOLEAN,
  student_count BIGINT,
  lesson_count BIGINT,
  exam_count BIGINT,
  submission_count BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _role TEXT;
  _tenant UUID;
BEGIN
  SELECT role, tenant_id INTO _role, _tenant
  FROM public.users
  WHERE id = auth.uid();

  IF _role IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF _role <> 'super_admin' AND (_role <> 'university_admin' OR _tenant IS DISTINCT FROM p_tenant_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN QUERY
  SELECT
    'group'::text, g.id, g.name, g.teacher_id, u.full_name,
    g.created_at, g.deleted_at, (g.deleted_at IS NOT NULL),
    (SELECT count(*) FROM public.group_students gs WHERE gs.group_id = g.id),
    (SELECT count(*) FROM public.lessons l WHERE l.group_id = g.id),
    (SELECT count(*) FROM public.exams e WHERE e.group_id = g.id),
    (SELECT count(*) FROM public.exam_submissions s JOIN public.exams e ON e.id = s.exam_id WHERE e.group_id = g.id)
  FROM public.groups g
  LEFT JOIN public.users u ON u.id = g.teacher_id
  WHERE g.tenant_id = p_tenant_id
    AND (p_year IS NULL OR EXTRACT(YEAR FROM g.created_at) = p_year)

  UNION ALL

  SELECT
    'course'::text, c.id, c.title, c.teacher_id, u.full_name,
    c.created_at, c.deleted_at, (c.deleted_at IS NOT NULL),
    (SELECT count(*) FROM public.course_enrollments ce WHERE ce.course_id = c.id),
    0,
    (SELECT count(*) FROM public.exams e WHERE e.course_id = c.id),
    (SELECT count(*) FROM public.exam_submissions s JOIN public.exams e ON e.id = s.exam_id WHERE e.course_id = c.id)
  FROM public.courses c
  LEFT JOIN public.users u ON u.id = c.teacher_id
  WHERE c.tenant_id = p_tenant_id
    AND (p_year IS NULL OR EXTRACT(YEAR FROM c.created_at) = p_year)

  ORDER BY created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_tenant_archive(UUID, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_archive(UUID, INTEGER) TO authenticated;

-- ── 2. Rate limiter is server-only ────────────────────────────────
-- rateLimit() always uses the service-role client. Exposing the primitive RPC
-- to browser sessions lets users manipulate arbitrary limiter keys.
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INT, INT) TO service_role;

-- ── 3. Atomic public-invitation redemption ─────────────────────────
-- A public invitation's use_count must be incremented under a row lock, before
-- the account is created. This prevents two concurrent requests from both
-- consuming the final available slot.
CREATE OR REPLACE FUNCTION public.redeem_public_invitation(p_invitation_id UUID)
RETURNS TABLE (
  id UUID,
  role TEXT,
  tenant_id UUID,
  group_id UUID,
  course_id UUID,
  use_count INTEGER,
  max_uses INTEGER,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.invitations i
  SET
    use_count = COALESCE(i.use_count, 0) + 1,
    status = CASE
      WHEN i.max_uses IS NOT NULL AND COALESCE(i.use_count, 0) + 1 >= i.max_uses THEN 'revoked'
      ELSE i.status
    END
  WHERE i.id = p_invitation_id
    AND i.is_public = true
    AND i.status = 'pending'
    AND i.expires_at > NOW()
    AND (i.max_uses IS NULL OR COALESCE(i.use_count, 0) < i.max_uses)
  RETURNING i.id, i.role, i.tenant_id, i.group_id, i.course_id,
            i.use_count, i.max_uses, i.expires_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_UNAVAILABLE';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.redeem_public_invitation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_public_invitation(UUID) TO service_role;
