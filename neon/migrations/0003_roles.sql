-- Neon only (Cloudflare + Neon migration, step 9.1). Never run on Supabase.
-- Idempotent: safe to run more than once.
--
-- The app reaches Postgres through Hyperdrive as app_gateway, a login role
-- with no table rights and no BYPASSRLS (Neon's owner role bypasses RLS, so
-- the app must never connect as it). Each unit of work switches, inside its
-- own transaction, to exactly one of:
--   app_user     a signed-in user. Same rights as Neon's `authenticated`; all
--                user RLS policies apply.
--   app_service  privileged writes after the route authorized the caller. RLS
--                stays ON: its own policies pin every row to the institution
--                set in app.tenant_id (or app.scope = 'platform', set only for
--                a verified super_admin). User policies never apply to it.
--   app_system   rate limiting and scheduled cleanup only.
-- The app_gateway password is set outside this file (never committed).

BEGIN;

-- 1. Roles ------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user')    THEN CREATE ROLE app_user    NOLOGIN NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_service') THEN CREATE ROLE app_service NOLOGIN NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_system')  THEN CREATE ROLE app_system  NOLOGIN NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_gateway') THEN CREATE ROLE app_gateway LOGIN NOINHERIT NOBYPASSRLS; END IF;
END $$;
ALTER ROLE app_user    NOLOGIN NOBYPASSRLS;
ALTER ROLE app_service NOLOGIN NOBYPASSRLS;
ALTER ROLE app_system  NOLOGIN NOBYPASSRLS;
ALTER ROLE app_gateway LOGIN NOINHERIT NOBYPASSRLS NOCREATEDB NOCREATEROLE;

-- app_gateway may only switch into the three runtime roles (NOINHERIT: it
-- gets none of their rights without switching).
GRANT app_user, app_service, app_system TO app_gateway;
-- The migration owner may switch too, so the isolation tests can run as each role.
DO $$ BEGIN EXECUTE format('GRANT app_user, app_service, app_system TO %I', current_user); END $$;

GRANT USAGE ON SCHEMA public, auth TO app_user, app_service, app_system;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO app_user, app_service, app_system;

-- 2. app_user mirrors `authenticated` exactly --------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT table_name, privilege_type FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND grantee = 'authenticated' AND privilege_type <> 'TRUNCATE'
  LOOP
    EXECUTE format('GRANT %s ON public.%I TO app_user', r.privilege_type, r.table_name);
  END LOOP;
  -- column-level grants (users: full_name, locale)
  FOR r IN
    SELECT cp.table_name, cp.column_name, cp.privilege_type FROM information_schema.column_privileges cp
     WHERE cp.table_schema = 'public' AND cp.grantee = 'authenticated'
       AND NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants g
                        WHERE g.table_schema = 'public' AND g.table_name = cp.table_name
                          AND g.grantee = 'authenticated' AND g.privilege_type = cp.privilege_type)
  LOOP
    EXECUTE format('GRANT %s (%I) ON public.%I TO app_user', r.privilege_type, r.column_name, r.table_name);
  END LOOP;
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO app_user', r.sig);
  END LOOP;
  FOR r IN
    SELECT object_name FROM information_schema.usage_privileges
     WHERE object_schema = 'public' AND object_type = 'SEQUENCE' AND grantee = 'authenticated'
  LOOP
    EXECUTE format('GRANT USAGE ON SEQUENCE public.%I TO app_user', r.object_name);
  END LOOP;
END $$;

-- 3. User policies apply to the API roles and app_user, never to the
--    service/system roles. Policies written TO public applied to every role,
--    so a service request carrying a user's identity could read another
--    institution (proved in phase 9.0).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname, tablename, roles FROM pg_policies
     WHERE schemaname = 'public' AND policyname NOT LIKE 'svc\_%' AND policyname NOT LIKE 'sys\_%'
  LOOP
    IF r.roles = '{public}'::name[] THEN
      EXECUTE format('ALTER POLICY %I ON public.%I TO anon, authenticated, app_user', r.policyname, r.tablename);
    ELSIF NOT ('app_user' = ANY (r.roles)) THEN
      EXECUTE format('ALTER POLICY %I ON public.%I TO %s', r.policyname, r.tablename,
                     (SELECT string_agg(quote_ident(x), ', ') FROM unnest(array_append(r.roles, 'app_user'::name)) x));
    END IF;
  END LOOP;
END $$;

-- 4. Institution scope for app_service ---------------------------------------
CREATE OR REPLACE FUNCTION public.svc_tenant_ok(p_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(current_setting('app.scope', true), '') = 'platform'
      OR (p_tenant IS NOT NULL AND p_tenant = nullif(current_setting('app.tenant_id', true), '')::uuid);
$$;

-- The institution of a parent row, for tables without tenant_id. SECURITY
-- DEFINER so the policy does not need SELECT on the parent table.
CREATE OR REPLACE FUNCTION public.svc_parent_tenant(p_kind text, p_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_kind
    WHEN 'group'        THEN (SELECT g.tenant_id FROM public.groups g WHERE g.id = p_id)
    WHEN 'announcement' THEN (SELECT a.tenant_id FROM public.announcements a WHERE a.id = p_id)
    WHEN 'user'         THEN (SELECT u.tenant_id FROM public.users u WHERE u.id = p_id)
    WHEN 'request'      THEN (SELECT s.tenant_id FROM public.staff_requests s WHERE s.id = p_id)
  END;
$$;

REVOKE ALL ON FUNCTION public.svc_tenant_ok(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.svc_parent_tenant(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.svc_tenant_ok(uuid), public.svc_parent_tenant(text, uuid) TO app_service;

-- 5. app_service: rights per table, from the inventory of service-role code
--    (refined table by table in 9.4 as each query is rewritten; the grants
--    matrix test pins the result). UPDATE/DELETE with a WHERE clause and
--    INSERT ... RETURNING need SELECT, so SELECT goes with them.
DO $$
DECLARE
  r record;
  spec text[][] := ARRAY[
    -- table                  privileges                          institution of the row
    ['academic_terms',        'SELECT, INSERT, UPDATE',           'tenant_id'],
    ['academic_units',        'SELECT, UPDATE',                   'tenant_id'],
    ['ai_usage_log',          'SELECT, INSERT',                   'tenant_id'],
    ['announcement_events',   'SELECT, DELETE',                   'tenant_id'],
    ['announcement_groups',   'SELECT, INSERT, DELETE',           'public.svc_parent_tenant(''announcement'', announcement_id)'],
    ['announcements',         'SELECT, UPDATE, DELETE',           'tenant_id'],
    ['attendance_records',    'SELECT, INSERT, UPDATE',           'tenant_id'],
    ['attendance_sessions',   'SELECT, INSERT, UPDATE, DELETE',   'tenant_id'],
    ['course_enrollments',    'SELECT, INSERT, UPDATE, DELETE',   'tenant_id'],
    ['course_units',          'SELECT, INSERT',                   'tenant_id'],
    ['courses',               'SELECT, INSERT, UPDATE',           'tenant_id'],
    ['exam_appeals',          'SELECT, UPDATE',                   'tenant_id'],
    ['exam_submissions',      'SELECT, UPDATE',                   'tenant_id'],
    ['exams',                 'SELECT, INSERT, UPDATE',           'tenant_id'],
    ['grades',                'SELECT, UPDATE',                   'tenant_id'],
    ['group_students',        'SELECT, DELETE',                   'public.svc_parent_tenant(''group'', group_id)'],
    ['groups',                'SELECT, UPDATE',                   'tenant_id'],
    ['invitations',           'SELECT, UPDATE, DELETE',           'tenant_id'],
    ['lessons',               'SELECT, INSERT, UPDATE',           'tenant_id'],
    ['mail_connections',      'SELECT, DELETE',                   'tenant_id'],
    ['mail_messages',         'SELECT, INSERT',                   'tenant_id'],
    ['request_messages',      'SELECT, INSERT',                   'public.svc_parent_tenant(''request'', request_id)'],
    ['schedule_slots',        'SELECT, INSERT, UPDATE, DELETE',   'tenant_id'],
    ['schedules',             'SELECT, INSERT, UPDATE, DELETE',   'tenant_id'],
    ['staff_requests',        'SELECT, INSERT, UPDATE',           'tenant_id'],
    ['student_names',         'SELECT, INSERT, UPDATE',           'public.svc_parent_tenant(''user'', user_id)'],
    ['survey_responses',      'SELECT, INSERT',                   'tenant_id'],
    ['surveys',               'SELECT, INSERT, UPDATE',           'tenant_id'],
    ['tenants',               'SELECT, UPDATE, DELETE',           'id'],
    ['unit_items',            'SELECT, INSERT',                   'tenant_id'],
    ['users',                 'SELECT, INSERT, UPDATE',           'tenant_id']
  ];
  i int;
BEGIN
  -- start from nothing, so a right removed from the list is really removed
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM app_service', r.relname);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'svc_' || r.relname, r.relname);
  END LOOP;
  FOR i IN 1 .. array_length(spec, 1) LOOP
    EXECUTE format('GRANT %s ON public.%I TO app_service', spec[i][2], spec[i][1]);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO app_service USING (public.svc_tenant_ok(%s)) WITH CHECK (public.svc_tenant_ok(%s))',
                   'svc_' || spec[i][1], spec[i][1], spec[i][3], spec[i][3]);
  END LOOP;
END $$;

-- Tables with no institution: the public contact form may add a message;
-- reading messages and platform settings is platform scope only.
GRANT SELECT, INSERT ON public.contact_messages TO app_service;
DROP POLICY IF EXISTS svc_contact_messages_insert ON public.contact_messages;
CREATE POLICY svc_contact_messages_insert ON public.contact_messages FOR INSERT TO app_service WITH CHECK (true);
DROP POLICY IF EXISTS svc_contact_messages_read ON public.contact_messages;
CREATE POLICY svc_contact_messages_read ON public.contact_messages FOR SELECT TO app_service USING (public.svc_tenant_ok(NULL));
GRANT SELECT ON public.platform_settings TO app_service;
DROP POLICY IF EXISTS svc_platform_settings ON public.platform_settings;
CREATE POLICY svc_platform_settings ON public.platform_settings FOR SELECT TO app_service USING (public.svc_tenant_ok(NULL));

-- Service RPCs (SECURITY DEFINER, no auth.uid(): they take the actor as an
-- argument and re-derive it from public.users).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN (
       'accept_invitation', 'append_proctoring_events', 'check_ai_allowance', 'check_email_in_auth',
       'finalize_exam_submission', 'get_invitation_by_token', 'record_ai_usage', 'restore_entity',
       'start_exam_attempt', 'transfer_student_group', 'get_student_announcements')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO app_service', r.sig);
  END LOOP;
END $$;

-- 6. app_system: rate limiting only -----------------------------------------
REVOKE ALL ON public.rate_limits FROM app_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rate_limits TO app_system;
DROP POLICY IF EXISTS sys_rate_limits ON public.rate_limits;
CREATE POLICY sys_rate_limits ON public.rate_limits FOR ALL TO app_system USING (true) WITH CHECK (true);
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'check_rate_limit'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO app_system', r.sig);
  END LOOP;
END $$;

COMMIT;
