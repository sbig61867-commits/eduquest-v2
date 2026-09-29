-- ════════════════════════════════════════════════════════════════════════
-- Thumbnail wall for live proctoring  (2026-09-27) — PENDING, not applied
-- ════════════════════════════════════════════════════════════════════════
-- Apply AFTER live_proctoring_channel_migration.sql.
--
-- The teacher's monitoring page can show every student as a small picture
-- refreshed every few seconds — far cheaper than video, and nothing stored:
-- students send a ~4 KB thumbnail as a Realtime broadcast on a SECOND private
-- topic, `exam-thumbs:<exam>`, only while the teacher's wall is open (the
-- teacher switches it on over the existing `exam-live:<exam>` channel).
--
-- The new topic is one-way:
--   read  (join, receive)   the exam's teacher only — students never see each
--                           other's pictures
--   write broadcast         a student whose attempt on that exam is in progress
--                           (sent over HTTP with httpSend, no join needed)
-- `exam-live:` keeps exactly the rules of live_proctoring_channel_migration.sql.
--
-- Idempotent: CREATE OR REPLACE + DROP POLICY IF EXISTS.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- 'teacher' | 'student' | NULL for the calling user on an exam-live or
-- exam-thumbs topic. Same checks as exam_live_role(), both prefixes.
CREATE OR REPLACE FUNCTION public.exam_topic_role(p_topic TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_exam UUID;
BEGIN
  IF v_uid IS NULL OR p_topic IS NULL
     OR p_topic !~ '^exam-(live|thumbs):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  v_exam := substr(p_topic, strpos(p_topic, ':') + 1)::uuid;

  IF EXISTS (
    SELECT 1 FROM public.exams e
    WHERE e.id = v_exam AND e.teacher_id = v_uid
      AND e.proctoring_enabled AND e.deleted_at IS NULL
  ) THEN
    RETURN 'teacher';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.exam_submissions s
    WHERE s.exam_id = v_exam AND s.student_id = v_uid AND s.status = 'in_progress'
  ) THEN
    RETURN 'student';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.exam_topic_role(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exam_topic_role(TEXT) TO authenticated;

DROP POLICY IF EXISTS exam_live_read ON realtime.messages;
CREATE POLICY exam_live_read ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.messages.extension IN ('broadcast', 'presence')
    AND (
      ((SELECT realtime.topic()) LIKE 'exam-live:%'
        AND public.exam_topic_role((SELECT realtime.topic())) IS NOT NULL)
      OR
      ((SELECT realtime.topic()) LIKE 'exam-thumbs:%'
        AND public.exam_topic_role((SELECT realtime.topic())) = 'teacher')
    )
  );

DROP POLICY IF EXISTS exam_live_write ON realtime.messages;
CREATE POLICY exam_live_write ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    ((SELECT realtime.topic()) LIKE 'exam-live:%' AND realtime.messages.extension = 'presence'
      AND public.exam_topic_role((SELECT realtime.topic())) IS NOT NULL)
    OR
    ((SELECT realtime.topic()) LIKE 'exam-live:%' AND realtime.messages.extension = 'broadcast'
      AND public.exam_topic_role((SELECT realtime.topic())) = 'teacher')
    OR
    ((SELECT realtime.topic()) LIKE 'exam-thumbs:%' AND realtime.messages.extension = 'broadcast'
      AND public.exam_topic_role((SELECT realtime.topic())) = 'student')
  );

COMMIT;
