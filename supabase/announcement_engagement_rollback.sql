-- ============================================================
-- ROLLBACK for announcement_engagement_migration.sql — only if needed.
-- Restores get_student_announcements() exactly as it was on the live DB
-- before 2026-09-26 (definition captured from production), then removes the
-- engagement table and columns. Deletes all recorded views/clicks/interest.
-- The app works in both states (it detects the table and hides the features).
-- ============================================================
BEGIN;

DROP FUNCTION IF EXISTS public.get_student_announcements();

CREATE FUNCTION public.get_student_announcements()
RETURNS TABLE(id uuid, title text, body text, image_url text, link_url text, cta_label text,
              created_at timestamp with time zone, ends_at timestamp with time zone)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH me AS (
    SELECT
      u.id,
      u.tenant_id,
      u.is_university_student,
      (u.is_university_student = false
       OR EXISTS (SELECT 1 FROM public.course_enrollments ce WHERE ce.student_id = u.id)
      ) AS is_center_student
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role = 'student'
  )
  SELECT a.id, a.title, a.body, a.image_url, a.link_url, a.cta_label, a.created_at, a.ends_at
  FROM public.announcements a
  CROSS JOIN me
  WHERE a.is_published = true
    AND a.tenant_id = me.tenant_id
    AND (a.starts_at IS NULL OR a.starts_at <= now())
    AND (a.ends_at   IS NULL OR a.ends_at   >= now())
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
  ORDER BY a.created_at DESC
  LIMIT 20;
$function$;

REVOKE ALL ON FUNCTION public.get_student_announcements() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_announcements() TO authenticated;

DROP TABLE IF EXISTS public.announcement_events;
ALTER TABLE public.announcements DROP COLUMN IF EXISTS collect_interest, DROP COLUMN IF EXISTS pinned;

COMMIT;
