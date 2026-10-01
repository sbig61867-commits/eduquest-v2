-- Batch 2 — admin teachers list: scale + isolation check (PERFORMANCE_CONTRACT.md P1).
--
-- Builds a synthetic institution A (2 000 teachers + 2 000 students + 1 admin)
-- and institution B (5 teachers + 1 admin) inside the transaction, runs the
-- exact reads /admin/teachers makes — before (the whole teacher list) and after
-- (one page with an exact count, as src/lib/data/people.ts listTeachers does) —
-- through RLS as the real role, and ends with RAISE EXCEPTION: the report is
-- the error message and EVERYTHING is rolled back.
--
-- 2 000 teachers is a large real institution (the students check uses 20 000
-- students; teachers are ~1:10–1:30 of that). The students are there so the
-- role filter has rows to skip.
--
-- DIAGNOSTIC: sizes scale with rows, times do not — never extrapolate times.

DO $$
DECLARE
  tA uuid := gen_random_uuid(); tB uuid := gen_random_uuid();
  adminA uuid; teacherA uuid; studentA uuid; adminB uuid;
  t0 timestamptz; r text := ''; c bigint; sz bigint; n bigint;
BEGIN
  SET LOCAL statement_timeout = '118s';
  INSERT INTO public.tenants (id, name, slug, code) VALUES
    (tA, 'TLIST A (rolled back)', 'tlist-a-' || substr(tA::text, 1, 8), 'ZZT1'),
    (tB, 'TLIST B (rolled back)', 'tlist-b-' || substr(tB::text, 1, 8), 'ZZT2');
  CREATE TEMP TABLE _ids ON COMMIT DROP AS
    SELECT gen_random_uuid() AS id, g AS k FROM generate_series(1, 4007) g;
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tl' || k || '@scale.invalid', '{}', '{}', now(), now() FROM _ids;
  -- k=1 admin A, k=2..2001 teachers A, k=2002..4001 students A, k=4002 admin B, k=4003..4007 teachers B
  UPDATE public.users u SET
    tenant_id = CASE WHEN _ids.k <= 4001 THEN tA ELSE tB END,
    role = CASE WHEN _ids.k IN (1, 4002) THEN 'university_admin'
                WHEN _ids.k BETWEEN 2 AND 2001 OR _ids.k >= 4003 THEN 'teacher'
                ELSE 'student' END,
    full_name = CASE WHEN _ids.k >= 4003 THEN 'Other Institution ' || _ids.k
                     WHEN _ids.k BETWEEN 2 AND 2001 THEN 'Teacher Number ' || _ids.k || ' Family'
                     ELSE 'Student Number ' || _ids.k END,
    is_active = true,
    created_at = now() - (_ids.k || ' seconds')::interval
  FROM _ids WHERE u.id = _ids.id;
  SELECT id INTO adminA FROM _ids WHERE k = 1; SELECT id INTO teacherA FROM _ids WHERE k = 2;
  SELECT id INTO studentA FROM _ids WHERE k = 2002; SELECT id INTO adminB FROM _ids WHERE k = 4002;
  ANALYZE public.users;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', adminA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- BEFORE: page.tsx read every teacher of the institution; search filtered in the browser.
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, email, full_name, avatar_url, role, is_active, created_at, tenant_id, can_create_courses
    FROM public.users WHERE role = 'teacher' AND tenant_id = tA ORDER BY created_at DESC) x;
  r := r || format('BEFORE list rows=%s json=%s KB %s ms | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- AFTER: one page (50), plus the exact count PostgREST adds.
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, email, full_name, is_active, created_at, can_create_courses
    FROM public.users WHERE tenant_id = tA AND role = 'teacher' ORDER BY created_at DESC, id LIMIT 50 OFFSET 0) x;
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tA AND role = 'teacher';
  r := r || format('AFTER page 1 rows=%s json=%s KB total=%s %s ms | ', c, sz / 1024, n, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  t0 := clock_timestamp();
  SELECT count(*) INTO c FROM (
    SELECT id FROM public.users WHERE tenant_id = tA AND role = 'teacher' ORDER BY created_at DESC, id LIMIT 50 OFFSET 1950) x;
  r := r || format('AFTER last page rows=%s %s ms | ', c, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  t0 := clock_timestamp();
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tA AND role = 'teacher'
    AND (full_name ILIKE '%Number 199%' OR email ILIKE '%Number 199%');
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, email, full_name FROM public.users WHERE tenant_id = tA AND role = 'teacher'
      AND (full_name ILIKE '%Number 199%' OR email ILIKE '%Number 199%')
    ORDER BY created_at DESC, id LIMIT 50) x;
  r := r || format('AFTER search "Number 199" matches=%s page rows=%s json=%s KB %s ms | ', n, c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- A student name must never come back from the teachers search.
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tA AND role = 'teacher'
    AND (full_name ILIKE '%Student Number%' OR email ILIKE '%Student Number%');
  r := r || format('F1 teachers search never returns students: %s | ', CASE WHEN n = 0 THEN 'PASS (0)' ELSE 'FAIL ' || n END);

  -- ISOLATION (as admin A through RLS).
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tB;
  r := r || format('I1 admin A reads tenant B rows: %s | ', CASE WHEN n = 0 THEN 'PASS (0)' ELSE 'FAIL ' || n END);
  SELECT count(*) INTO n FROM public.users WHERE role = 'teacher' AND full_name ILIKE '%Other Institution%';
  r := r || format('I2 admin A search for B teachers: %s | ', CASE WHEN n = 0 THEN 'PASS (0)' ELSE 'FAIL ' || n END);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', adminB, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tB AND role = 'teacher';
  SELECT count(*) INTO c FROM public.users WHERE tenant_id = tA;
  r := r || format('I3 admin B sees its 5 teachers and none of A: %s | ', CASE WHEN n = 5 AND c = 0 THEN 'PASS' ELSE 'FAIL ' || n || '/' || c END);
  EXECUTE 'RESET ROLE';

  -- A student in no group sees no teacher (fix_student_pii_overexposure_migration.sql).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', studentA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tA AND role = 'teacher';
  r := r || format('I4 a student cannot list the teachers: %s | ', CASE WHEN n = 0 THEN 'PASS (0)' ELSE 'FAIL ' || n END);
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
SELECT (SELECT count(*) FROM auth.users WHERE email LIKE 'tl%@scale.invalid') AS leftover_auth,
       (SELECT count(*) FROM public.tenants WHERE code IN ('ZZT1', 'ZZT2')) AS leftover_tenants;
