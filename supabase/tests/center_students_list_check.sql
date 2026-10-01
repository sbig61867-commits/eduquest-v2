-- Batch 2 — centre students list: scale + isolation check (PERFORMANCE_CONTRACT.md P1).
--
-- Builds a synthetic institution A (20 000 students — every 3rd a centre-only
-- trainee, every 7th disabled, every 5th with an incomplete name — plus 1
-- admin, 1 centre manager, 1 teacher) and institution B (5 students + 1 centre
-- manager) inside the transaction, runs the exact reads /center/students makes
-- through RLS AS THE CENTRE MANAGER — before (whole list + a second whole read
-- for name flags) and after (one page with name_complete + exact count + active
-- count, as src/lib/data/people.ts listCenterStudents does) — and ends with
-- RAISE EXCEPTION: the report is the error message and EVERYTHING is rolled back.
--
-- DIAGNOSTIC: sizes scale with rows, times do not — never extrapolate times.

DO $$
DECLARE
  tA uuid := gen_random_uuid(); tB uuid := gen_random_uuid();
  managerA uuid; teacherA uuid; studentA uuid; managerB uuid;
  t0 timestamptz; r text := ''; c bigint; sz bigint; n bigint; a bigint;
BEGIN
  SET LOCAL statement_timeout = '118s';
  INSERT INTO public.tenants (id, name, slug, code) VALUES
    (tA, 'CLIST A (rolled back)', 'clist-a-' || substr(tA::text, 1, 8), 'ZZC1'),
    (tB, 'CLIST B (rolled back)', 'clist-b-' || substr(tB::text, 1, 8), 'ZZC2');
  CREATE TEMP TABLE _ids ON COMMIT DROP AS
    SELECT gen_random_uuid() AS id, g AS k FROM generate_series(1, 20010) g;
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cl' || k || '@scale.invalid', '{}', '{}', now(), now() FROM _ids;
  -- k=1 admin A, k=2 centre manager A, k=3 teacher A, k=4..20003 students A,
  -- k=20004 centre manager B, k=20005..20009 students B, k=20010 admin B
  UPDATE public.users u SET
    tenant_id = CASE WHEN _ids.k <= 20003 THEN tA ELSE tB END,
    role = CASE WHEN _ids.k IN (1, 20010) THEN 'university_admin'
                WHEN _ids.k IN (2, 20004) THEN 'center_manager'
                WHEN _ids.k = 3 THEN 'teacher'
                ELSE 'student' END,
    full_name = CASE WHEN _ids.k BETWEEN 20005 AND 20009 THEN 'Other Institution ' || _ids.k
                     ELSE 'Trainee Number ' || _ids.k || ' Family' END,
    is_active = (_ids.k % 7 <> 0),
    is_university_student = (_ids.k % 3 <> 0),
    name_complete = (_ids.k % 5 <> 0),
    created_at = now() - (_ids.k || ' seconds')::interval
  FROM _ids WHERE u.id = _ids.id;
  SELECT id INTO managerA FROM _ids WHERE k = 2; SELECT id INTO teacherA FROM _ids WHERE k = 3;
  SELECT id INTO studentA FROM _ids WHERE k = 4; SELECT id INTO managerB FROM _ids WHERE k = 20004;
  ANALYZE public.users;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', managerA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- BEFORE: page.tsx read every student + loadNameCompleteFlags read every student again.
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, full_name, email, is_active, created_at, is_university_student
    FROM public.users WHERE tenant_id = tA AND role = 'student' ORDER BY created_at DESC) x;
  r := r || format('BEFORE list rows=%s json=%s KB %s ms | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, name_complete FROM public.users WHERE tenant_id = tA AND role = 'student') x;
  r := r || format('BEFORE name flags rows=%s json=%s KB %s ms | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- AFTER: one page with name_complete + the exact count + the active count.
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, full_name, email, is_active, created_at, is_university_student, name_complete
    FROM public.users WHERE tenant_id = tA AND role = 'student' ORDER BY created_at DESC, id LIMIT 50 OFFSET 0) x;
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tA AND role = 'student';
  SELECT count(*) INTO a FROM public.users WHERE tenant_id = tA AND role = 'student' AND is_active;
  r := r || format('AFTER page 1 rows=%s json=%s KB total=%s active=%s %s ms | ', c, sz / 1024, n, a, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  t0 := clock_timestamp();
  SELECT count(*) INTO c FROM (
    SELECT id FROM public.users WHERE tenant_id = tA AND role = 'student' ORDER BY created_at DESC, id LIMIT 50 OFFSET 19950) x;
  r := r || format('AFTER last page rows=%s %s ms | ', c, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  t0 := clock_timestamp();
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tA AND role = 'student'
    AND (full_name ILIKE '%Number 1999%' OR email ILIKE '%Number 1999%');
  SELECT count(*) INTO a FROM public.users WHERE tenant_id = tA AND role = 'student' AND is_active
    AND (full_name ILIKE '%Number 1999%' OR email ILIKE '%Number 1999%');
  r := r || format('AFTER search "Number 1999" matches=%s active=%s %s ms | ', n, a, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- Expected totals from the generator, to prove the counts are exact.
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tA AND role = 'student' AND is_active;
  SELECT count(*) INTO c FROM generate_series(4, 20003) k WHERE k % 7 <> 0;
  r := r || format('F1 active count exact: %s | ', CASE WHEN n = c THEN 'PASS (' || n || ')' ELSE 'FAIL ' || n || '<>' || c END);
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tA AND role = 'student' AND name_complete = false;
  SELECT count(*) INTO c FROM generate_series(4, 20003) k WHERE k % 5 = 0;
  r := r || format('F2 incomplete-name flags readable by the manager on the rows: %s | ', CASE WHEN n = c THEN 'PASS (' || n || ')' ELSE 'FAIL ' || n || '<>' || c END);
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tA AND role = 'student'
    AND (full_name ILIKE '%Trainee Number 3 %' OR email ILIKE '%cl3@%');
  r := r || format('F3 search never returns the teacher: %s | ', CASE WHEN n = 0 THEN 'PASS (0)' ELSE 'FAIL ' || n END);

  -- ISOLATION (as centre manager A through RLS).
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tB;
  r := r || format('I1 manager A reads tenant B rows: %s | ', CASE WHEN n = 0 THEN 'PASS (0)' ELSE 'FAIL ' || n END);
  SELECT count(*) INTO n FROM public.users WHERE role = 'student' AND full_name ILIKE '%Other Institution%';
  r := r || format('I2 manager A search for B names: %s | ', CASE WHEN n = 0 THEN 'PASS (0)' ELSE 'FAIL ' || n END);
  SELECT count(*) INTO n FROM public.student_names;
  r := r || format('I3 manager A cannot read the four-part names: %s | ', CASE WHEN n = 0 THEN 'PASS (0)' ELSE 'FAIL ' || n END);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', managerB, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tB AND role = 'student';
  SELECT count(*) INTO c FROM public.users WHERE tenant_id = tA;
  r := r || format('I4 manager B sees its 5 students and none of A: %s | ', CASE WHEN n = 5 AND c = 0 THEN 'PASS' ELSE 'FAIL ' || n || '/' || c END);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', studentA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tA AND role = 'student';
  r := r || format('I5 a student cannot list the student body: %s | ', CASE WHEN n <= 1 THEN 'PASS (' || n || ')' ELSE 'FAIL ' || n END);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    SELECT count(*) INTO n FROM public.users WHERE tenant_id = tA;
    r := r || format('I6 anon reads 0: %s', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ' || n END);
  EXCEPTION WHEN insufficient_privilege THEN
    r := r || 'I6 anon reads 0: PASS (42501, no access at all)';
  END;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'RESULT: %', r;
END $$;

-- Afterwards (expect 0 / 0):
SELECT (SELECT count(*) FROM auth.users WHERE email LIKE 'cl%@scale.invalid') AS leftover_auth,
       (SELECT count(*) FROM public.tenants WHERE code IN ('ZZC1', 'ZZC2')) AS leftover_tenants;
