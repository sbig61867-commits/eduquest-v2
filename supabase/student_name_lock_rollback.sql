-- ════════════════════════════════════════════════════════════════════════
-- Rollback of student_name_lock_migration.sql  (2026-09-29)
-- ════════════════════════════════════════════════════════════════════════
-- Restores users_update EXACTLY as it was on the live DB before the migration
-- (read from pg_policy 2026-09-29, WITH CHECK md5 5e8f53e304baa406b0a4ee6f0b55f066)
-- and removes the new objects.
--
-- WARNING: dropping student_names deletes every student's middle names. Before
-- running this, copy the four parts back into users.full_name if they must be
-- kept:
--   UPDATE public.users u SET full_name = concat_ws(' ', s.first_name, s.father_name, s.grandfather_name, s.family_name)
--   FROM public.student_names s WHERE s.user_id = u.id;
--
-- The app keeps working after a rollback: saveStudentName() finds no table and
-- stores the whole four-part name in full_name (src/lib/student-names.ts).
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS users_update ON public.users;

CREATE POLICY users_update ON public.users FOR UPDATE
USING (
  (SELECT current_user_role()) = 'super_admin'
  OR id = (SELECT auth.uid())
)
WITH CHECK (
  (SELECT current_user_role()) = 'super_admin'
  OR (
    id = (SELECT auth.uid())
    AND role = (SELECT current_user_role())
    AND NOT (tenant_id             IS DISTINCT FROM (SELECT current_tenant_id()))
    AND NOT (is_active             IS DISTINCT FROM (SELECT current_is_active()))
    AND NOT (permissions           IS DISTINCT FROM (SELECT current_permissions()))
    AND NOT (can_create_courses    IS DISTINCT FROM (SELECT current_can_create_courses()))
    AND NOT (is_university_student IS DISTINCT FROM (SELECT current_is_university_student()))
    AND NOT (suspended_by_tenant   IS DISTINCT FROM (SELECT current_suspended_by_tenant()))
  )
);

DROP FUNCTION IF EXISTS public.current_full_name();
DROP FUNCTION IF EXISTS public.current_name_complete();
ALTER TABLE public.users DROP COLUMN IF EXISTS name_complete;
DROP TABLE IF EXISTS public.student_names;

COMMIT;
