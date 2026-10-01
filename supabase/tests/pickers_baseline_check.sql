-- Batch 2 — selectors (pickers): baseline of every preloaded people/group list (PERFORMANCE_CONTRACT.md P1).
--
-- Synthetic platform, fully rolled back:
--   institution A: 20 000 students (every 9th disabled), 500 teachers, 1 000 groups, 200 courses,
--                  1 admin, 1 centre manager;
--   institution B:  5 000 students, 100 teachers.
-- Each selector's read is run exactly as its page runs it, through RLS AS THE ROLE THAT OPENS IT,
-- and only sizes (rows, JSON KB) and times are reported. Ends with RAISE EXCEPTION.
--
-- DIAGNOSTIC: sizes scale with rows, times do not — never extrapolate times. JSON size is the
-- PostgREST payload; the RSC payload the browser receives is of the same order (same fields).

DO $$
DECLARE
  tA uuid := gen_random_uuid(); tB uuid := gen_random_uuid();
  teacherA uuid; managerA uuid; ownerX uuid;
  t0 timestamptz; r text := ''; c bigint; sz bigint; c2 bigint; sz2 bigint; c3 bigint; sz3 bigint; c4 bigint; sz4 bigint;
BEGIN
  SET LOCAL statement_timeout = '118s';
  INSERT INTO public.tenants (id, name, slug, code) VALUES
    (tA, 'PICK A (rolled back)', 'pick-a-' || substr(tA::text, 1, 8), 'ZZP1'),
    (tB, 'PICK B (rolled back)', 'pick-b-' || substr(tB::text, 1, 8), 'ZZP2');
  CREATE TEMP TABLE _ids ON COMMIT DROP AS
    SELECT gen_random_uuid() AS id, g AS k FROM generate_series(1, 25603) g;
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pk' || k || '@scale.invalid', '{}', '{}', now(), now() FROM _ids;
  -- k=1..20000 students A, 20001..20500 teachers A, 20501 admin A, 20502 centre manager A,
  -- 20503..25502 students B, 25503..25602 teachers B, 25603 owner (super_admin, no tenant)
  UPDATE public.users u SET
    tenant_id = CASE WHEN _ids.k <= 20502 THEN tA WHEN _ids.k <= 25602 THEN tB END,
    role = CASE WHEN _ids.k <= 20000 OR _ids.k BETWEEN 20503 AND 25502 THEN 'student'
                WHEN _ids.k <= 20500 OR _ids.k BETWEEN 25503 AND 25602 THEN 'teacher'
                WHEN _ids.k = 20501 THEN 'university_admin'
                WHEN _ids.k = 20502 THEN 'center_manager'
                ELSE 'super_admin' END,
    full_name = 'Person Number ' || _ids.k || ' Family Name',
    is_active = (_ids.k % 9 <> 0),
    created_at = now() - (_ids.k || ' seconds')::interval
  FROM _ids WHERE u.id = _ids.id;
  SELECT id INTO teacherA FROM _ids WHERE k = 20001; SELECT id INTO managerA FROM _ids WHERE k = 20502;
  SELECT id INTO ownerX FROM _ids WHERE k = 25603;
  INSERT INTO public.groups (tenant_id, teacher_id, name)
    SELECT tA, (SELECT id FROM _ids WHERE k = 20001 + (g % 500)), 'Group ' || g FROM generate_series(1, 1000) g;
  INSERT INTO public.courses (tenant_id, teacher_id, title)
    SELECT tA, (SELECT id FROM _ids WHERE k = 20001 + (g % 500)), 'Course ' || g FROM generate_series(1, 200) g;
  UPDATE public.users SET permissions = jsonb_build_object('manage_groups', true, 'manage_courses', true,
    'manage_schedules', true, 'manage_students', true) WHERE id = managerA;
  ANALYZE public.users; ANALYZE public.groups; ANALYZE public.courses;

  -- ── T1 /teacher/groups «إدارة الطلاب»: every active student of the institution (as the teacher).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', teacherA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, full_name, email FROM public.users
    WHERE tenant_id = tA AND role = 'student' AND is_active ORDER BY full_name) x;
  r := r || format('T1 teacher/groups students rows=%s json=%s KB %s ms | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  EXECUTE 'RESET ROLE';

  -- ── C1 /center/groups and C2 /center/courses (as the centre manager).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', managerA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, full_name FROM public.users WHERE tenant_id = tA AND role = 'student' AND is_active ORDER BY full_name) x;
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c2, sz2 FROM (
    SELECT id, full_name FROM public.users WHERE tenant_id = tA AND role = 'teacher' AND is_active ORDER BY full_name) x;
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c3, sz3 FROM (
    SELECT id, title FROM public.courses WHERE tenant_id = tA ORDER BY title) x;
  r := r || format('C1/C2 centre groups|courses: students rows=%s json=%s KB + teachers rows=%s json=%s KB + courses %s KB %s ms | ',
    c, sz / 1024, c2, sz2 / 1024, sz3 / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- ── S1 schedules (manage_schedules): every group + every active teacher as «targets».
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, name FROM public.groups WHERE tenant_id = tA ORDER BY name) x;
  r := r || format('S1 schedules targets: groups rows=%s json=%s KB + teachers rows=%s json=%s KB %s ms | ',
    c, sz / 1024, c2, sz2 / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  -- ── G1 group-only selectors (invitations / attendance / announcements): same groups read.
  r := r || format('G1 group selectors: rows=%s json=%s KB | ', c, sz / 1024);
  EXECUTE 'RESET ROLE';

  -- ── R1 /super-admin/reports: EVERY teacher, group and student of EVERY institution (as the owner).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ownerX, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, full_name, email, tenant_id FROM public.users WHERE role = 'student' ORDER BY full_name) x;
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c2, sz2 FROM (
    SELECT id, full_name, email, tenant_id FROM public.users WHERE role = 'teacher' ORDER BY full_name) x;
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c3, sz3 FROM (
    SELECT id, name, tenant_id FROM public.groups ORDER BY name) x;
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c4, sz4 FROM (
    SELECT id, name FROM public.tenants ORDER BY name) x;
  r := r || format('R1 super-admin reports (all institutions): students rows=%s json=%s KB + teachers rows=%s json=%s KB + groups rows=%s json=%s KB + tenants %s %s ms',
    c, sz / 1024, c2, sz2 / 1024, c3, sz3 / 1024, c4, round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'RESULT: %', r;
END $$;

-- Afterwards (expect 0 / 0):
SELECT (SELECT count(*) FROM auth.users WHERE email LIKE 'pk%@scale.invalid') AS leftover_auth,
       (SELECT count(*) FROM public.tenants WHERE code IN ('ZZP1', 'ZZP2')) AS leftover_tenants;
