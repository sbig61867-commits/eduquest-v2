-- Batch 2 — admin students list: scale + isolation check (PERFORMANCE_CONTRACT.md P1).
--
-- Builds a synthetic institution A (20 000 students + 1 admin + 1 teacher) and
-- institution B (5 students + 1 admin) inside the transaction, runs the exact
-- reads /admin/students makes — before (whole list + separate name flags) and
-- after (one page with an exact count, as src/lib/data/people.ts listStudents
-- does) — through RLS as the real role, and ends with RAISE EXCEPTION: the
-- report is the error message and EVERYTHING is rolled back.
--
-- DIAGNOSTIC: sizes scale with rows, times do not — never extrapolate times.
-- The ILIKE below is what PostgREST runs for `full_name.ilike."%term%"`.

DO $$
DECLARE
  tA uuid := gen_random_uuid(); tB uuid := gen_random_uuid();
  adminA uuid; teacherA uuid; studentA uuid; adminB uuid;
  t0 timestamptz; r text := ''; c bigint; sz bigint; n bigint; ok boolean;
BEGIN
  SET LOCAL statement_timeout = '118s';
  INSERT INTO public.tenants (id, name, slug, code) VALUES
    (tA, 'LIST A (rolled back)', 'list-a-' || substr(tA::text, 1, 8), 'ZZL1'),
    (tB, 'LIST B (rolled back)', 'list-b-' || substr(tB::text, 1, 8), 'ZZL2');
  CREATE TEMP TABLE _ids ON COMMIT DROP AS
    SELECT gen_random_uuid() AS id, g AS k FROM generate_series(1, 20008) g;
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'st' || k || '@scale.invalid', '{}', '{}', now(), now() FROM _ids;
  -- n=1 admin A, n=2 teacher A, n=3..20002 students A, n=20003 admin B, n=20004..20008 students B
  UPDATE public.users u SET
    tenant_id = CASE WHEN _ids.k <= 20002 THEN tA ELSE tB END,
    role = CASE WHEN _ids.k IN (1, 20003) THEN 'university_admin' WHEN _ids.k = 2 THEN 'teacher' ELSE 'student' END,
    full_name = CASE WHEN _ids.k >= 20004 THEN 'Other Institution ' || _ids.k ELSE 'Student Number ' || _ids.k || ' Family' END,
    is_active = true,
    created_at = now() - (_ids.k || ' seconds')::interval
  FROM _ids WHERE u.id = _ids.id;
  SELECT id INTO adminA FROM _ids WHERE k = 1; SELECT id INTO teacherA FROM _ids WHERE k = 2;
  SELECT id INTO studentA FROM _ids WHERE k = 3; SELECT id INTO adminB FROM _ids WHERE k = 20003;
  ANALYZE public.users;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', adminA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- BEFORE: the whole list + a second whole read for name flags.
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, email, full_name, avatar_url, role, is_active, created_at, tenant_id, can_create_courses, is_university_student
    FROM public.users WHERE role = 'student' AND tenant_id = tA ORDER BY created_at DESC) x;
  r := r || format('BEFORE list rows=%s json=%s KB %s ms | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, name_complete FROM public.users WHERE tenant_id = tA AND role = 'student') x;
  r := r || format('BEFORE name flags rows=%s json=%s KB %s ms | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- AFTER: one page (50) with name_complete, plus the exact count PostgREST adds.
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, email, full_name, avatar_url, role, is_active, created_at, tenant_id, can_create_courses, is_university_student, name_complete
    FROM public.users WHERE tenant_id = tA AND role = 'student' ORDER BY created_at DESC, id LIMIT 50 OFFSET 0) x;
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tA AND role = 'student';
  r := r || format('AFTER page 1 rows=%s json=%s KB total=%s %s ms | ', c, sz / 1024, n, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  t0 := clock_timestamp();
  SELECT count(*) INTO c FROM (
    SELECT id FROM public.users WHERE tenant_id = tA AND role = 'student' ORDER BY created_at DESC, id LIMIT 50 OFFSET 19950) x;
  r := r || format('AFTER last page rows=%s %s ms | ', c, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  t0 := clock_timestamp();
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tA AND role = 'student'
    AND (full_name ILIKE '%Number 1999%' OR email ILIKE '%Number 1999%');
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, email, full_name FROM public.users WHERE tenant_id = tA AND role = 'student'
      AND (full_name ILIKE '%Number 1999%' OR email ILIKE '%Number 1999%')
    ORDER BY created_at DESC, id LIMIT 50) x;
  r := r || format('AFTER search "Number 1999" matches=%s page rows=%s json=%s KB %s ms | ', n, c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  t0 := clock_timestamp();
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tA AND role = 'student'
    AND (full_name ILIKE '%scale.invalid%' OR email ILIKE '%scale.invalid%');
  r := r || format('AFTER search matching everyone (count) = %s %s ms | ', n, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- ISOLATION (as admin A through RLS).
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tB;
  r := r || format('I1 admin A reads tenant B rows: %s | ', CASE WHEN n = 0 THEN 'PASS (0)' ELSE 'FAIL ' || n END);
  SELECT count(*) INTO n FROM public.users WHERE role = 'student' AND (full_name ILIKE '%Other Institution%');
  r := r || format('I2 admin A search for B names: %s | ', CASE WHEN n = 0 THEN 'PASS (0)' ELSE 'FAIL ' || n END);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', adminB, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tB AND role = 'student';
  SELECT count(*) INTO c FROM public.users WHERE tenant_id = tA;
  r := r || format('I3 admin B sees its 5 students and none of A: %s | ', CASE WHEN n = 5 AND c = 0 THEN 'PASS' ELSE 'FAIL ' || n || '/' || c END);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', studentA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tA AND role = 'student';
  r := r || format('I4 a student cannot list the student body: %s | ', CASE WHEN n <= 1 THEN 'PASS (' || n || ')' ELSE 'FAIL ' || n END);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    SELECT count(*) INTO n FROM public.users WHERE tenant_id = tA;
    r := r || format('I5 anon reads 0: %s', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ' || n END);
  EXCEPTION WHEN insufficient_privilege THEN
    r := r || 'I5 anon reads 0: PASS (42501, no access at all)';
  END;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'RESULT: %', r;
END $$;

-- Afterwards (expect 0 / 0):
SELECT (SELECT count(*) FROM auth.users WHERE email LIKE '%@scale.invalid') AS leftover_auth,
       (SELECT count(*) FROM public.tenants WHERE code IN ('ZZL1', 'ZZL2')) AS leftover_tenants;
