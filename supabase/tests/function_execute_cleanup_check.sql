-- =============================================================================
-- Function EXECUTE cleanup check
-- =============================================================================
-- Companion to supabase/function_execute_cleanup_migration.sql.
--
--   F-01  member_role_letter: PUBLIC / anon / authenticated / service_role   -> f / f / f / t
--   F-02  the 5 retired functions: any API role can execute                -> 0
--   F-03  owner postgres can still execute all 6                           -> 6
--   F-04  authenticated calling member_role_letter                         -> blocked (42501)
--   F-05  authenticated calling get_admin_exams                            -> blocked (42501)
--   F-06  member code issued on signup (auth.users -> handle_new_user)     -> EQ-S…
--   F-07  service_role gives the user an institution and a role
--         -> assign_member_code reissues via member_role_letter           -> ZZPRB-T…
--         This is the create-user path exactly: /api/admin/create-user
--         upserts role + tenant_id on public.users with the service-role
--         client. accept-invitation and auth/callback reach the same columns
--         differently: their service-role client calls the RPC
--         accept_invitation(), SECURITY DEFINER, so that UPDATE runs with its
--         owner's (postgres) privileges — not exercised here.
--         (2026-10-16: was a super_admin SESSION; users_column_update_lockdown
--         limits sessions to full_name/locale, and no app path assigns an
--         institution through a session.)
--   F-08  exam_topic_role (the live replacement) still executable by
--         authenticated                                                    -> t
--
-- Before the migration F-01 reads t / t / t / t, F-02 reads 9 and F-04/F-05
-- read "allowed"; F-06..F-08 read the same before and after.
--
-- SAFE TO RUN ANYTIME: run as postgres; one block ending in RAISE EXCEPTION,
-- so everything (probe tenant + user included) is rolled back. The results are
-- in the error message.
-- =============================================================================

DO $chk$
DECLARE
  r text := ''; n int; v text;
  probe_user uuid := 'f0000000-0000-0000-0000-00000000f001';
  probe_tenant uuid := 'f0000000-0000-0000-0000-00000000f00a';
BEGIN
  r := 'F-01 member_role_letter PUBLIC/anon/auth/svc='
    || EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               WHERE p.oid='public.member_role_letter(text)'::regprocedure AND a.grantee=0) || '/'
    || has_function_privilege('anon','public.member_role_letter(text)','EXECUTE') || '/'
    || has_function_privilege('authenticated','public.member_role_letter(text)','EXECUTE') || '/'
    || has_function_privilege('service_role','public.member_role_letter(text)','EXECUTE');

  SELECT count(*) INTO n
  FROM unnest(ARRAY['public.get_admin_exams()','public.get_admin_lessons()','public.exam_live_role(text)',
                    'public.get_tenant_ai_usage()','public.get_student_exams()']::regprocedure[]) f(oid)
  CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) ro(role)
  WHERE has_function_privilege(ro.role, f.oid, 'EXECUTE');
  r := r || ' | F-02 retired fns executable by API roles=' || n;

  SELECT count(*) INTO n
  FROM unnest(ARRAY['public.member_role_letter(text)','public.get_admin_exams()','public.get_admin_lessons()',
                    'public.exam_live_role(text)','public.get_tenant_ai_usage()','public.get_student_exams()']::regprocedure[]) f(oid)
  WHERE has_function_privilege('postgres', f.oid, 'EXECUTE');
  r := r || ' | F-03 owner can execute=' || n;

  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.member_role_letter('teacher'); r := r || ' | F-04 auth member_role_letter=allowed';
  EXCEPTION WHEN insufficient_privilege THEN r := r || ' | F-04 auth member_role_letter=blocked (42501)'; END;
  BEGIN PERFORM * FROM public.get_admin_exams(); r := r || ' | F-05 auth get_admin_exams=allowed';
  EXCEPTION WHEN insufficient_privilege THEN r := r || ' | F-05 auth get_admin_exams=blocked (42501)'; END;
  RESET ROLE;

  -- signup path: auth.users insert -> handle_new_user -> public.users -> assign_member_code
  INSERT INTO auth.users (id, email) VALUES (probe_user, 'fn-cleanup-probe@test.local');
  SELECT member_code INTO v FROM public.users WHERE id = probe_user;
  r := r || ' | F-06 signup code=' || coalesce(v, 'NULL');

  -- service_role gives the account an institution and a role, as create-user does
  -- explicit code: a NULL code would call nextval('tenant_code_seq'), and
  -- sequences are not rolled back (each run would burn a real T0nn code)
  INSERT INTO public.tenants (id, name, slug, code, is_active) VALUES (probe_tenant, '__fn_cleanup__', '__fn-cleanup__', 'ZZPRB', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  SET LOCAL ROLE service_role;
  BEGIN
    UPDATE public.users SET tenant_id = probe_tenant, role = 'teacher' WHERE id = probe_user;
    RESET ROLE;
    SELECT u.member_code || ' (tenant code ' || t.code || ')' INTO v
      FROM public.users u JOIN public.tenants t ON t.id = u.tenant_id WHERE u.id = probe_user;
    r := r || ' | F-07 reissued via service_role=' || coalesce(v, 'NULL');
  EXCEPTION WHEN others THEN
    RESET ROLE;
    r := r || ' | F-07 FAILED ' || sqlstate || ' ' || sqlerrm;
  END;

  r := r || ' | F-08 exam_topic_role auth=' || has_function_privilege('authenticated','public.exam_topic_role(text)','EXECUTE');

  RAISE EXCEPTION 'CHECK_ROLLED_BACK: %', r;
END $chk$;
