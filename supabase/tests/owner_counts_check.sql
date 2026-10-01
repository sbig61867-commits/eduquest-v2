-- Owner Counts — regression check for get_tenant_role_counts() (supabase/owner_counts_migration.sql).
--
-- Run ONLY where the function exists: after the migration is applied, or as a dry run that runs the
-- migration first INSIDE this same transaction (paste owner_counts_migration.sql above the DO block).
-- Synthetic data; ends with RAISE EXCEPTION, so EVERYTHING (incl. a dry-run function) is rolled back.
--
-- Checks: owner gets exactly the per-institution tally of university_admin / teacher / student (any
-- status); every other role and a signed-out caller get 42501; anon cannot EXECUTE (and a direct call as anon
-- is refused); SECURITY INVOKER (prosecdef = false — runs with the caller's rights, RLS applies) with
-- search_path pinned; the result has counts only (4 columns, no user ids).

DO $$
DECLARE
  tA uuid := gen_random_uuid(); tB uuid := gen_random_uuid();
  ownerX uuid; adminA uuid; managerA uuid; teacherA uuid; studentA uuid;
  r text := ''; ok boolean; n bigint; role_name text; uid uuid;
BEGIN
  INSERT INTO public.tenants (id, name, slug, code) VALUES
    (tA, 'OCK A', 'ock-a-' || substr(tA::text, 1, 8), 'ZZK1'), (tB, 'OCK B', 'ock-b-' || substr(tB::text, 1, 8), 'ZZK2');
  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT gen_random_uuid() AS id, g AS k FROM generate_series(1, 61) g;
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ock' || k || '@scale.invalid', '{}', '{}', now(), now() FROM _ids;
  -- A: 2 admins (1 disabled), 1 centre manager, 5 teachers (1 disabled), 30 students (10 disabled)
  -- B: 1 admin, 2 teachers, 20 students; k=61 owner
  UPDATE public.users u SET
    tenant_id = CASE WHEN k <= 38 THEN tA WHEN k <= 60 THEN tB END,
    role = CASE WHEN k <= 2 THEN 'university_admin' WHEN k = 3 THEN 'center_manager' WHEN k <= 8 THEN 'teacher'
                WHEN k <= 38 THEN 'student' WHEN k = 39 THEN 'university_admin' WHEN k <= 41 THEN 'teacher'
                WHEN k <= 60 THEN 'student' ELSE 'super_admin' END,
    is_active = NOT (k = 2 OR k = 8 OR k BETWEEN 29 AND 38)
  FROM _ids WHERE u.id = _ids.id;
  SELECT id INTO ownerX FROM _ids WHERE k = 61; SELECT id INTO adminA FROM _ids WHERE k = 1;
  SELECT id INTO managerA FROM _ids WHERE k = 3; SELECT id INTO teacherA FROM _ids WHERE k = 4;
  SELECT id INTO studentA FROM _ids WHERE k = 9;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', ownerX, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT (admins, teachers, students) = (2::bigint, 5::bigint, 30::bigint) INTO ok FROM public.get_tenant_role_counts() WHERE tenant_id = tA;
  r := r || format('C1 owner: A = 2 admins / 5 teachers / 30 students (disabled included, manager excluded): %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  SELECT (admins, teachers, students) = (1::bigint, 2::bigint, 19::bigint) INTO ok FROM public.get_tenant_role_counts() WHERE tenant_id = tB;
  r := r || format('C2 owner: B = 1 / 2 / 19: %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  SELECT bool_and(f.admins = t.admins AND f.teachers = t.teachers AND f.students = t.students) INTO ok
  FROM public.get_tenant_role_counts() f JOIN (
    SELECT u.tenant_id, count(*) FILTER (WHERE role = 'university_admin') admins, count(*) FILTER (WHERE role = 'teacher') teachers,
           count(*) FILTER (WHERE role = 'student') students
    FROM public.users u WHERE u.tenant_id IS NOT NULL AND u.role <> 'super_admin' GROUP BY u.tenant_id) t USING (tenant_id);
  r := r || format('C3 owner: every institution equals the page''s old tally: %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  EXECUTE 'RESET ROLE';

  FOR role_name, uid IN VALUES ('university_admin', adminA), ('center_manager', managerA), ('teacher', teacherA), ('student', studentA), ('signed-out', NULL::uuid) LOOP
    PERFORM set_config('request.jwt.claims', CASE WHEN uid IS NULL THEN '{}' ELSE json_build_object('sub', uid, 'role', 'authenticated')::text END, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      PERFORM * FROM public.get_tenant_role_counts();
      r := r || format('A %s: FAIL (allowed) | ', role_name);
    EXCEPTION WHEN insufficient_privilege THEN
      r := r || format('A %s: 42501 PASS | ', role_name);
    END;
    EXECUTE 'RESET ROLE';
  END LOOP;

  SELECT NOT has_function_privilege('anon', 'public.get_tenant_role_counts()', 'EXECUTE')
     AND has_function_privilege('authenticated', 'public.get_tenant_role_counts()', 'EXECUTE') INTO ok;
  r := r || format('G1 anon cannot EXECUTE, authenticated can: %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  SELECT NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp'] INTO ok
    FROM pg_proc p WHERE p.oid = 'public.get_tenant_role_counts()'::regprocedure;
  r := r || format('G2 SECURITY INVOKER with search_path = public, pg_temp: %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    PERFORM * FROM public.get_tenant_role_counts();
    r := r || 'G4 anon direct call: FAIL (allowed) | ';
  EXCEPTION WHEN insufficient_privilege THEN
    r := r || 'G4 anon direct call refused (42501): PASS | ';
  END;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM information_schema.parameters
    WHERE specific_name = (SELECT p.proname || '_' || p.oid FROM pg_proc p WHERE p.oid = 'public.get_tenant_role_counts()'::regprocedure) AND parameter_mode = 'OUT';
  r := r || format('G3 result = 4 columns (tenant_id + 3 counts), no user data: %s', CASE WHEN n = 4 THEN 'PASS' ELSE 'FAIL ' || n END);

  RAISE EXCEPTION 'RESULT: %', r;
END $$;

-- Afterwards (expect 0 / 0):
SELECT (SELECT count(*) FROM auth.users WHERE email LIKE 'ock%@scale.invalid') AS leftover_auth,
       (SELECT count(*) FROM public.tenants WHERE code IN ('ZZK1', 'ZZK2')) AS leftover_tenants;
