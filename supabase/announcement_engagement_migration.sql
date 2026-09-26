-- ============================================================
-- announcement_engagement_migration.sql — 2026-09-26
-- Idempotent + re-runnable. Apply in the Supabase SQL Editor.
--
-- Turns an announcement into something a student can act on, and tells the
-- author whether it worked:
--
--   announcements.collect_interest — show an "I'm interested" button; the
--                                     author gets the list of students who
--                                     pressed it (registration intent).
--   announcements.pinned           — keep it first in the student feed.
--   announcement_events            — one row per (announcement, student,
--                                     kind) for kind ∈ view | click | interest.
--
-- Write path: /api/announcements/events (student session → visibility is
-- re-checked through get_student_announcements() → service-role upsert).
-- The table therefore has SELECT policies only and no write grants, the same
-- write-only-via-service-role shape as staff_requests / announcements.
-- Read path: a student sees only their own rows; tenant staff who may see
-- announcements (same roles as announcements_select) see their tenant's rows.
--
-- get_student_announcements() gains three OUT columns (collect_interest,
-- pinned, interested) and orders pinned first, so it must be dropped and
-- recreated; the grant matrix is re-asserted afterwards. Until this is
-- applied the app hides the interest button, the stats and pinning — nothing
-- breaks.
-- ============================================================

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS collect_interest BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pinned           BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.announcement_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  student_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('view', 'click', 'interest')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (announcement_id, student_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_announcement_events_announcement_kind
  ON public.announcement_events (announcement_id, kind);
CREATE INDEX IF NOT EXISTS idx_announcement_events_student
  ON public.announcement_events (student_id);
CREATE INDEX IF NOT EXISTS idx_announcement_events_tenant
  ON public.announcement_events (tenant_id);

ALTER TABLE public.announcement_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS announcement_events_select ON public.announcement_events;
CREATE POLICY announcement_events_select ON public.announcement_events
  FOR SELECT USING (
    student_id = (SELECT auth.uid())
    OR (SELECT current_user_role()) = 'super_admin'
    OR (
      tenant_id = (SELECT current_tenant_id())
      AND (SELECT current_user_role()) IN ('university_admin', 'center_manager', 'teacher')
    )
  );

-- Writes only through the service-role client (after the route's checks).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.announcement_events FROM anon, authenticated;
REVOKE ALL ON public.announcement_events FROM anon;

-- ── Student feed ──────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_student_announcements();

CREATE FUNCTION public.get_student_announcements()
RETURNS TABLE (
  id               UUID,
  title            TEXT,
  body             TEXT,
  image_url        TEXT,
  link_url         TEXT,
  cta_label        TEXT,
  created_at       TIMESTAMPTZ,
  ends_at          TIMESTAMPTZ,
  collect_interest BOOLEAN,
  pinned           BOOLEAN,
  interested       BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (
    SELECT
      u.id,
      u.tenant_id,
      u.is_university_student,
      -- A centre student is anyone flagged as non-university OR enrolled in at
      -- least one course. Dual-enrolled students match both populations.
      (u.is_university_student = false
       OR EXISTS (SELECT 1 FROM public.course_enrollments ce WHERE ce.student_id = u.id)
      ) AS is_center_student
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role = 'student'
  )
  SELECT a.id, a.title, a.body, a.image_url, a.link_url, a.cta_label, a.created_at, a.ends_at,
         a.collect_interest,
         a.pinned,
         EXISTS (
           SELECT 1 FROM public.announcement_events e
           WHERE e.announcement_id = a.id AND e.student_id = me.id AND e.kind = 'interest'
         ) AS interested
  FROM public.announcements a
  CROSS JOIN me
  WHERE a.is_published = true
    AND a.tenant_id = me.tenant_id
    AND (a.starts_at IS NULL OR a.starts_at <= now())
    AND (a.ends_at   IS NULL OR a.ends_at   >= now())
    -- Author lacked `announce_to_university`: centre students only, whatever
    -- the audience says.
    AND (a.center_students_only = false OR me.is_center_student)
    AND CASE a.audience
          WHEN 'all'        THEN true
          WHEN 'university' THEN me.is_university_student
          WHEN 'center'     THEN me.is_center_student
          ELSE EXISTS (
            SELECT 1
            FROM public.announcement_groups ag
            JOIN public.group_students gs ON gs.group_id = ag.group_id
            WHERE ag.announcement_id = a.id
              AND gs.student_id = me.id
          )
        END
  ORDER BY a.pinned DESC, a.created_at DESC
  LIMIT 20;
$$;

-- anon inherits EXECUTE through PUBLIC, so revoke from PUBLIC too.
REVOKE ALL ON FUNCTION public.get_student_announcements() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_announcements() TO authenticated;
