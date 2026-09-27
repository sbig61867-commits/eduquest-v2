-- ════════════════════════════════════════════════════════════════════════
-- On-demand live proctoring: the per-exam Realtime channel  (2026-09-27)
-- ════════════════════════════════════════════════════════════════════════
-- Live video used to stream from every student for the whole exam. It now
-- streams only from the students a teacher picks, and only while that teacher
-- has the monitoring page open. The "doorbell" between them is a PRIVATE
-- Supabase Realtime channel per exam, topic `exam-live:<exam uuid>`:
--   • students in the exam track presence there (who is in the exam, their
--     violation/snapshot counts) — no table is read or written for this;
--   • the exam's teacher broadcasts the set of students to watch.
-- LiveKit itself stays the authority for streaming: /api/proctor/live-token
-- only issues a student token while the teacher is in the room AND watching
-- that student (checked against LiveKit, not against this channel).
--
-- Who may do what on `exam-live:<exam>` (RLS on realtime.messages, evaluated
-- by Realtime when a client joins — not per message):
--   read   (join, receive)      the exam's teacher; a student whose attempt
--                               on that exam is in progress
--   write  presence             the same two
--   write  broadcast            the exam's teacher only (students cannot send
--                               the "watch" signal to each other)
-- Nothing else is granted: realtime.messages had no policies before this, so
-- every other private topic stays closed.
--
-- Idempotent: CREATE OR REPLACE + DROP POLICY IF EXISTS.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- 'teacher' | 'student' | NULL for the calling user on an exam-live topic.
-- SECURITY DEFINER so it can read exams / exam_submissions regardless of the
-- caller's table policies; search_path pinned (see fix_helper_search_path.sql).
CREATE OR REPLACE FUNCTION public.exam_live_role(p_topic TEXT)
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
     OR p_topic !~ '^exam-live:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  v_exam := substr(p_topic, 11)::uuid;

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

REVOKE ALL ON FUNCTION public.exam_live_role(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exam_live_role(TEXT) TO authenticated;

DROP POLICY IF EXISTS exam_live_read ON realtime.messages;
CREATE POLICY exam_live_read ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.messages.extension IN ('broadcast', 'presence')
    AND public.exam_live_role((SELECT realtime.topic())) IS NOT NULL
  );

DROP POLICY IF EXISTS exam_live_write ON realtime.messages;
CREATE POLICY exam_live_write ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    (realtime.messages.extension = 'presence'
      AND public.exam_live_role((SELECT realtime.topic())) IS NOT NULL)
    OR
    (realtime.messages.extension = 'broadcast'
      AND public.exam_live_role((SELECT realtime.topic())) = 'teacher')
  );

COMMIT;
