-- P-09 — groups_select: evaluate current_user_role() / current_tenant_id() once per query, not once per row.
--
-- Performance only — no access rule changes. The predicate is the live definition (pg_policies, 2026-10-03) with
-- each current_user_role() / current_tenant_id() call wrapped in (SELECT …), which makes it an init-plan
-- evaluated once per query (the same technique as rls_initplan_optimization_migration.sql and
-- rls_initplan_followup_migration.sql). Both helpers are STABLE and depend only on auth.uid(), which is fixed for
-- the statement, so every role sees exactly the same rows. The student branch (current_student_group_ids()) and
-- every other policy, function, grant and index are unchanged.
--
-- Why it matters: `group_students_select` checks EXISTS (… FROM groups g …) for every membership row, and that
-- read of `groups` goes through `groups_select`. With bare calls, a per-group member count (PostgREST
-- `group_students(count)` on /center/groups and /center/mail) ran the helpers ~3 times per membership row:
-- 19 281 rows ≈ 1 028 ms at 1 000 groups (12–24 ms without RLS). See supabase/tests/groups_select_initplan_check.sql.
--
-- Idempotent (ALTER POLICY can be re-run).
-- Rollback (the exact pre-P-09 live definition):
--   ALTER POLICY groups_select ON public.groups USING (
--     (deleted_at IS NULL) AND ((current_user_role() = 'super_admin'::text)
--       OR ((current_user_role() <> 'student'::text) AND (tenant_id = current_tenant_id()))
--       OR ((current_user_role() = 'student'::text) AND (id IN ( SELECT current_student_group_ids() AS current_student_group_ids))))
--   );

ALTER POLICY groups_select ON public.groups USING (
  (deleted_at IS NULL)
  AND (
    ((SELECT public.current_user_role()) = 'super_admin'::text)
    OR (((SELECT public.current_user_role()) <> 'student'::text)
        AND (tenant_id = (SELECT public.current_tenant_id())))
    OR (((SELECT public.current_user_role()) = 'student'::text)
        AND (id IN (SELECT public.current_student_group_ids())))
  )
);
