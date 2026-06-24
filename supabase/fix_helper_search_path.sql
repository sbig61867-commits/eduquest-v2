-- ============================================================
-- EduQuest — Fix: pin search_path on RLS helper functions
-- Run on the live DB. Safe to re-run (CREATE OR REPLACE).
--
-- ROOT CAUSE
-- current_user_role() / current_tenant_id() are SECURITY DEFINER but did NOT
-- pin search_path. SECURITY DEFINER functions inherit the CALLER's search_path.
-- Under PostgREST the `authenticated` role runs with a restricted search_path,
-- so the unqualified `FROM users` failed:
--     ERROR 42P01: relation "users" does not exist
-- The function then returns NULL, so every RLS policy that calls it
-- (groups_insert, lessons_insert, exams_insert, ...) evaluates to NULL/false
-- and PostgREST rejects the write with 403 Forbidden.
--
-- The same statements worked in the SQL editor only because that session's
-- search_path already included `public`.
--
-- FIX: schema-qualify the table AND pin search_path on the function.
-- ============================================================

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
