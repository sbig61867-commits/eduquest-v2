-- ============================================================
-- security_rls_fix_migration.sql
-- Idempotent. Run once in the Supabase SQL Editor.
--
-- Fixes three RLS vulnerabilities identified in the security audit:
--
-- 1. CRITICAL  users_update  — no WITH CHECK allowed any authenticated
--              user to PATCH their own row and escalate role/tenant_id/
--              is_active. Fixed with a WITH CHECK that locks those
--              columns for self-service updates.
--
-- 2. MEDIUM    grades_select — third branch `tenant_id = current_tenant_id()`
--              let every tenant member (including students) read all grades.
--              Fixed by requiring teacher/university_admin role for that branch.
--
-- 3. LOW       lessons_select — any tenant member (student, teacher) could
--              read every lesson regardless of publication state or group
--              enrollment. Fixed: students see only published lessons in
--              their enrolled groups; staff see all.
-- ============================================================

-- ── 1. USERS: prevent self-service privilege escalation ─────

DROP POLICY IF EXISTS "users_update" ON users;

CREATE POLICY "users_update" ON users FOR UPDATE
  USING (
    (SELECT current_user_role()) = 'super_admin'
    OR (
      (SELECT current_user_role()) = 'university_admin'
      AND tenant_id = (SELECT current_tenant_id())
    )
    OR id = (SELECT auth.uid())
  )
  WITH CHECK (
    -- super_admin: unrestricted
    (SELECT current_user_role()) = 'super_admin'
    OR (
      -- university_admin: can update others in same tenant,
      -- but cannot promote anyone to super_admin, and cannot
      -- modify their own role/tenant_id
      (SELECT current_user_role()) = 'university_admin'
      AND tenant_id = (SELECT current_tenant_id())
      AND role <> 'super_admin'
      AND id <> (SELECT auth.uid())
    )
    OR (
      -- self-service: users may update own non-sensitive profile fields.
      -- role, tenant_id, and is_active are frozen — they must equal what
      -- is already stored.  The sub-select re-reads the DB row so the
      -- comparison is against the persisted value, not the payload.
      id = (SELECT auth.uid())
      AND role      = (SELECT u.role      FROM users u WHERE u.id = auth.uid())
      AND tenant_id IS NOT DISTINCT FROM
                      (SELECT u.tenant_id FROM users u WHERE u.id = auth.uid())
      AND is_active = (SELECT u.is_active FROM users u WHERE u.id = auth.uid())
    )
  );

-- ── 2. GRADES: scope reads to owner or staff ────────────────

DROP POLICY IF EXISTS "grades_select" ON grades;

CREATE POLICY "grades_select" ON grades FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin'
  OR student_id = (SELECT auth.uid())
  OR (
    (SELECT current_user_role()) IN ('teacher', 'university_admin')
    AND tenant_id = (SELECT current_tenant_id())
  )
);

-- ── 3. LESSONS: enforce is_published + enrollment for students

DROP POLICY IF EXISTS "lessons_select" ON lessons;

CREATE POLICY "lessons_select" ON lessons FOR SELECT USING (
  deleted_at IS NULL
  AND (
    (SELECT current_user_role()) = 'super_admin'
    OR (
      (SELECT current_user_role()) IN ('teacher', 'university_admin')
      AND tenant_id = (SELECT current_tenant_id())
    )
    OR (
      (SELECT current_user_role()) = 'student'
      AND is_published = true
      AND group_id IN (
        SELECT gs.group_id
        FROM   group_students gs
        WHERE  gs.student_id = (SELECT auth.uid())
      )
    )
  )
);
