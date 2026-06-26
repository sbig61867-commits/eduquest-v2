-- ============================================================
-- EduQuest — Complete Groups Fix
-- Run this in the Supabase SQL Editor on the LIVE project.
-- Safe to re-run (all statements are idempotent).
--
-- This fixes ALL layers of the group creation 403 error:
-- 1. Fixes the SECURITY DEFINER helper functions (search_path)
-- 2. Removes & re-creates all group-related RLS policies
-- 3. Grants correct permissions to the authenticated role
-- ============================================================

-- ── Step 1: Fix SECURITY DEFINER helper functions ────────────
-- These must have SET search_path or they return NULL under PostgREST.
-- NULL → every policy that calls them silently denies with 403.

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS UUID
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT tenant_id FROM public.users WHERE id = auth.uid();
$$;

-- ── Step 2: Re-create groups RLS policies ────────────────────
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "groups_select"        ON public.groups;
DROP POLICY IF EXISTS "groups_insert"        ON public.groups;
DROP POLICY IF EXISTS "groups_update"        ON public.groups;
DROP POLICY IF EXISTS "groups_delete"        ON public.groups;
-- also drop any legacy policy names
DROP POLICY IF EXISTS "Teachers can manage their groups"      ON public.groups;
DROP POLICY IF EXISTS "Admins can manage groups"              ON public.groups;
DROP POLICY IF EXISTS "Students can view their groups"        ON public.groups;

-- SELECT: super_admin sees all; others see groups in their tenant
CREATE POLICY "groups_select" ON public.groups
FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin'
  OR tenant_id = (SELECT current_tenant_id())
);

-- INSERT: teacher / admin can create groups in their own tenant
CREATE POLICY "groups_insert" ON public.groups
FOR INSERT WITH CHECK (
  (SELECT current_user_role()) IN ('teacher', 'university_admin', 'super_admin')
  AND tenant_id = (SELECT current_tenant_id())
);

-- UPDATE: super_admin can update any; teacher can only update own groups
CREATE POLICY "groups_update" ON public.groups
FOR UPDATE USING (
  (SELECT current_user_role()) = 'super_admin'
  OR (
    (SELECT current_user_role()) IN ('teacher', 'university_admin')
    AND tenant_id = (SELECT current_tenant_id())
    AND (
      (SELECT current_user_role()) = 'university_admin'
      OR teacher_id = (SELECT auth.uid())
    )
  )
);

-- DELETE: super_admin, university_admin (same tenant), teacher (own groups)
CREATE POLICY "groups_delete" ON public.groups
FOR DELETE USING (
  (SELECT current_user_role()) = 'super_admin'
  OR (
    (SELECT current_user_role()) = 'university_admin'
    AND tenant_id = (SELECT current_tenant_id())
  )
  OR (
    (SELECT current_user_role()) = 'teacher'
    AND teacher_id = (SELECT auth.uid())
  )
);

-- ── Step 3: Re-create group_students RLS policies ────────────
ALTER TABLE public.group_students ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "group_students_select" ON public.group_students;
DROP POLICY IF EXISTS "group_students_insert" ON public.group_students;
DROP POLICY IF EXISTS "group_students_delete" ON public.group_students;
-- legacy names
DROP POLICY IF EXISTS "Teachers can manage group members"     ON public.group_students;
DROP POLICY IF EXISTS "Students can view their memberships"   ON public.group_students;

-- SELECT: teacher sees members of their groups; students see own enrollment
CREATE POLICY "group_students_select" ON public.group_students
FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin'
  OR EXISTS (
    SELECT 1 FROM public.groups g
    WHERE g.id = group_id
      AND (
        g.tenant_id = (SELECT current_tenant_id())
        OR g.teacher_id = (SELECT auth.uid())
      )
  )
  OR student_id = (SELECT auth.uid())
);

-- INSERT: teacher (own group), university_admin (same tenant), super_admin
CREATE POLICY "group_students_insert" ON public.group_students
FOR INSERT WITH CHECK (
  (SELECT current_user_role()) = 'super_admin'
  OR EXISTS (
    SELECT 1 FROM public.groups g
    WHERE g.id = group_id
      AND (
        ((SELECT current_user_role()) = 'teacher' AND g.teacher_id = (SELECT auth.uid()))
        OR ((SELECT current_user_role()) = 'university_admin' AND g.tenant_id = (SELECT current_tenant_id()))
      )
  )
);

-- DELETE: same as INSERT
CREATE POLICY "group_students_delete" ON public.group_students
FOR DELETE USING (
  (SELECT current_user_role()) = 'super_admin'
  OR EXISTS (
    SELECT 1 FROM public.groups g
    WHERE g.id = group_id
      AND (
        ((SELECT current_user_role()) = 'teacher' AND g.teacher_id = (SELECT auth.uid()))
        OR ((SELECT current_user_role()) = 'university_admin' AND g.tenant_id = (SELECT current_tenant_id()))
      )
  )
);

-- ── Step 4: Verify the fix ────────────────────────────────────
-- Run this SELECT to confirm both functions work in this session:
SELECT
  public.current_user_role()   AS my_role,
  public.current_tenant_id()   AS my_tenant_id,
  auth.uid()                   AS my_uid;
-- If my_role and my_tenant_id are NOT null, the fix worked.
-- If they ARE null, you are running as anon (log in first in SQL editor).
