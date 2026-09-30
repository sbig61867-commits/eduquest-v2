-- ============================================================
-- Batch 1, PART B — apply ONLY AFTER the code that reads
-- get_student_exam_list() is live in production (see
-- student_exam_list_migration.sql, PART A).
--
-- Once no student screen calls get_student_exams(), a student has no reason to
-- execute it — and every reason not to: it returns the questions of every exam
-- they are enrolled in, including exams whose window has not opened yet. The
-- only legitimate way to a question is now /api/exam/start (roster, window,
-- SEB checked; attempt recorded), which reads the exam with the service role.
--
-- The function itself is kept (service_role only) so PART B can be undone with
-- a single GRANT if a rollback of the code ever needs it:
--   GRANT EXECUTE ON FUNCTION public.get_student_exams() TO authenticated;
--
-- Idempotent.
-- ============================================================

REVOKE ALL ON FUNCTION public.get_student_exams() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_exams() TO service_role;

-- Verification: expect anon false, authenticated false, service_role true.
SELECT has_function_privilege('anon',          'public.get_student_exams()', 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', 'public.get_student_exams()', 'EXECUTE') AS authenticated_can_execute,
       has_function_privilege('service_role',  'public.get_student_exams()', 'EXECUTE') AS service_role_can_execute;
