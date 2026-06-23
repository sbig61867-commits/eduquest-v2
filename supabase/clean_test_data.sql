-- ============================================================
-- EduQuest — Clean Test Data
-- Deletes ALL users/data except the super_admin owner account.
-- Super admin preserved: sbig61867@gmail.com (622217fa-6849-4734-a519-9b403934df4b)
-- Run in Supabase SQL Editor.
-- ============================================================

DO $$
DECLARE
  _owner_id UUID := '622217fa-6849-4734-a519-9b403934df4b';
BEGIN

  -- 1. Delete all exam submissions
  DELETE FROM exam_submissions;

  -- 2. Delete all grades
  DELETE FROM grades;

  -- 3. Delete all group_students enrollments
  DELETE FROM group_students;

  -- 4. Delete all course_enrollments (if table exists)
  BEGIN
    DELETE FROM course_enrollments;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  -- 5. Delete all course unit items (if table exists)
  BEGIN
    DELETE FROM course_unit_items;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  -- 6. Delete all course units (if table exists)
  BEGIN
    DELETE FROM course_units;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  -- 7. Delete all course levels (if table exists)
  BEGIN
    DELETE FROM course_levels;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  -- 8. Delete all courses (if table exists)
  BEGIN
    DELETE FROM courses;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  -- 9. Delete all exams
  DELETE FROM exams;

  -- 10. Delete all lessons
  DELETE FROM lessons;

  -- 11. Delete all groups
  DELETE FROM groups;

  -- 12. Delete all invitations
  DELETE FROM invitations;

  -- 13. Delete all feature flags (they'll be recreated as needed)
  DELETE FROM feature_flags;

  -- 14. Delete all non-owner users from public.users
  DELETE FROM public.users WHERE id <> _owner_id;

  -- 15. Delete all non-owner tenants (cascade will clean refs)
  DELETE FROM tenants;

  -- 16. Delete non-owner auth users via auth.users
  --     (must be done last — public.users foreign key references auth.users)
  DELETE FROM auth.users WHERE id <> _owner_id;

  RAISE NOTICE 'Cleanup complete. Owner account preserved: %', _owner_id;
END;
$$;

-- Verify
SELECT id, email, role, tenant_id, is_active FROM public.users;
SELECT COUNT(*) AS auth_users_remaining FROM auth.users;
SELECT COUNT(*) AS tenants_remaining FROM tenants;
SELECT COUNT(*) AS invitations_remaining FROM invitations;
