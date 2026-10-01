-- Batch 2 / C-T — teacher selector of /center/groups and /center/courses: before/after + isolation.
--
-- Institution A: 20 000 students, 500 teachers (every 9th disabled), 1 000 groups (19–300 members), 200
-- courses, centre manager A (manage_groups + manage_courses) and A2 (no capability). 50 students are named
-- "Teacher Lookalike k" so a role leak would show. Institution B: 100 teachers named "Bee Teacher k".
-- Read through RLS AS THE CENTRE MANAGER:
--   before = what the pages read for teachers: every active teacher (id, full_name);
--   after  = a head-only count of active teachers + each row's teacher embedded through the FK
--            (teacher:users!…_teacher_id_fkey(full_name, role, is_active)) + one search when asked
--            (src/lib/data/people.ts searchTeachers: active teachers, name ILIKE, limit 20).
-- Ends with RAISE EXCEPTION: the report is the error message and EVERYTHING is rolled back.
-- DIAGNOSTIC: sizes scale with rows, times do not — never extrapolate times.

DO $$
DECLARE
  tA uuid := gen_random_uuid(); tB uuid := gen_random_uuid();
  mgrA uuid; mgrA2 uuid; studentA uuid;
  t0 timestamptz; r text := ''; c bigint; sz bigint; sz2 bigint; tot bigint; n bigint; ms numeric;
BEGIN
  SET LOCAL statement_timeout = '118s';
  INSERT INTO public.tenants (id, name, slug, code) VALUES
    (tA, 'TPICK A (rolled back)', 'tpick-a-' || substr(tA::text, 1, 8), 'ZZT5'),
    (tB, 'TPICK B (rolled back)', 'tpick-b-' || substr(tB::text, 1, 8), 'ZZT6');
  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT gen_random_uuid() AS id, g AS k FROM generate_series(1, 20603) g;
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tp' || k || '@scale.invalid', '{}', '{}', now(), now() FROM _ids;
  -- k=1..20000 students A, 20001..20500 teachers A, 20501 manager A, 20502 manager A2, 20503..20602 teachers B, 20603 spare student A
  UPDATE public.users u SET
    tenant_id = CASE WHEN _ids.k BETWEEN 20503 AND 20602 THEN tB ELSE tA END,
    role = CASE WHEN _ids.k <= 20000 OR _ids.k = 20603 THEN 'student'
                WHEN _ids.k <= 20500 OR _ids.k BETWEEN 20503 AND 20602 THEN 'teacher'
                ELSE 'center_manager' END,
    full_name = CASE WHEN _ids.k <= 50 THEN 'Teacher Lookalike ' || _ids.k
                     WHEN _ids.k <= 20000 THEN 'Person Number ' || _ids.k
                     WHEN _ids.k <= 20500 THEN 'Teacher Number ' || _ids.k || ' Family'
                     WHEN _ids.k BETWEEN 20503 AND 20602 THEN 'Bee Teacher ' || _ids.k
                     ELSE 'Manager ' || _ids.k END,
    is_active = (_ids.k % 9 <> 0),
    created_at = now() - (_ids.k || ' seconds')::interval
  FROM _ids WHERE u.id = _ids.id;
  SELECT id INTO mgrA FROM _ids WHERE k = 20501; SELECT id INTO mgrA2 FROM _ids WHERE k = 20502;
  SELECT id INTO studentA FROM _ids WHERE k = 20603;
  UPDATE public.users SET is_active = true WHERE id IN (mgrA, mgrA2, studentA);
  UPDATE public.users SET permissions = '{"manage_groups": true, "manage_courses": true}'::jsonb WHERE id = mgrA;

  CREATE TEMP TABLE _groups ON COMMIT DROP AS SELECT gen_random_uuid() AS id, g FROM generate_series(1, 1000) g;
  INSERT INTO public.groups (id, tenant_id, teacher_id, name, description)
    SELECT gg.id, tA, (SELECT id FROM _ids WHERE k = 20001 + (gg.g % 500)), 'Group ' || gg.g, 'Section ' || gg.g FROM _groups gg;
  INSERT INTO public.group_students (group_id, student_id) SELECT (SELECT id FROM _groups WHERE g = 1), id FROM _ids WHERE k BETWEEN 1 AND 300;
  INSERT INTO public.group_students (group_id, student_id)
    SELECT gg.id, i.id FROM _groups gg JOIN _ids i ON i.k BETWEEN 301 + (gg.g - 2) * 19 AND 301 + (gg.g - 2) * 19 + 18 WHERE gg.g >= 2;
  CREATE TEMP TABLE _courses ON COMMIT DROP AS SELECT gen_random_uuid() AS id, cn FROM generate_series(1, 200) cn;
  INSERT INTO public.courses (id, tenant_id, teacher_id, title, description)
    SELECT cc.id, tA, (SELECT id FROM _ids WHERE k = 20001 + (cc.cn % 500)), 'Course ' || cc.cn, 'Course ' || cc.cn FROM _courses cc;
  ANALYZE public.users; ANALYZE public.groups; ANALYZE public.courses; ANALYZE public.group_students;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', mgrA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- BEFORE (teacher part of both pages): every active teacher.
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, full_name FROM public.users WHERE tenant_id = tA AND role = 'teacher' AND is_active ORDER BY full_name) x;
  r := r || format('BEFORE teacher list rows=%s json=%s KB %s ms | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- AFTER (teacher part): head-only count — no rows leave the database.
  t0 := clock_timestamp();
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tA AND role = 'teacher' AND is_active;
  r := r || format('AFTER active-teacher count=%s (0 rows sent) %s ms | ', n, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- C1 PAGE before vs after (groups(*)+count[+teacher embed], teachers|count, students, courses).
  t0 := clock_timestamp();
  SELECT octet_length(coalesce(json_agg(x.j)::text, '')) INTO sz FROM (
    SELECT to_jsonb(g) || jsonb_build_object('group_students', jsonb_build_array(jsonb_build_object('count',
      (SELECT count(*) FROM public.group_students gs WHERE gs.group_id = g.id)))) AS j
    FROM public.groups g WHERE g.tenant_id = tA ORDER BY g.created_at DESC) x;
  tot := sz;
  SELECT octet_length(coalesce(json_agg(x)::text, '')) INTO sz FROM (
    SELECT id, full_name FROM public.users WHERE tenant_id = tA AND role = 'teacher' AND is_active ORDER BY full_name) x;
  tot := tot + sz;
  SELECT octet_length(coalesce(json_agg(x)::text, '')) INTO sz FROM (
    SELECT id, full_name FROM public.users WHERE tenant_id = tA AND role = 'student' AND is_active ORDER BY full_name) x;
  tot := tot + sz;
  SELECT octet_length(coalesce(json_agg(x)::text, '')) INTO sz FROM (SELECT id, title FROM public.courses WHERE tenant_id = tA ORDER BY title) x;
  tot := tot + sz;
  r := r || format('C1 BEFORE json=%s KB %s ms | ', tot / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  t0 := clock_timestamp();
  SELECT octet_length(coalesce(json_agg(x.j)::text, '')) INTO sz FROM (
    SELECT to_jsonb(g) || jsonb_build_object(
      'group_students', jsonb_build_array(jsonb_build_object('count', (SELECT count(*) FROM public.group_students gs WHERE gs.group_id = g.id))),
      'teacher', (SELECT jsonb_build_object('full_name', u.full_name, 'role', u.role, 'is_active', u.is_active) FROM public.users u WHERE u.id = g.teacher_id)) AS j
    FROM public.groups g WHERE g.tenant_id = tA ORDER BY g.created_at DESC) x;
  tot := sz;
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tA AND role = 'teacher' AND is_active;
  SELECT octet_length(coalesce(json_agg(x)::text, '')) INTO sz FROM (
    SELECT id, full_name FROM public.users WHERE tenant_id = tA AND role = 'student' AND is_active ORDER BY full_name) x;
  tot := tot + sz;
  SELECT octet_length(coalesce(json_agg(x)::text, '')) INTO sz FROM (SELECT id, title FROM public.courses WHERE tenant_id = tA ORDER BY title) x;
  tot := tot + sz;
  r := r || format('C1 AFTER json=%s KB %s ms | ', tot / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- C2 PAGE before vs after (courses with counts[+teacher embed], teachers|count, students).
  t0 := clock_timestamp();
  SELECT octet_length(coalesce(json_agg(x)::text, '')) INTO sz FROM (
    SELECT co.id, co.title, co.description, co.is_published, co.teacher_id,
      json_build_array(json_build_object('count', (SELECT count(*) FROM public.course_units u WHERE u.course_id = co.id))) AS course_units,
      json_build_array(json_build_object('count', (SELECT count(*) FROM public.course_enrollments e WHERE e.course_id = co.id))) AS course_enrollments
    FROM public.courses co WHERE co.tenant_id = tA AND co.deleted_at IS NULL ORDER BY co.created_at DESC) x;
  tot := sz;
  SELECT octet_length(coalesce(json_agg(x)::text, '')) INTO sz FROM (
    SELECT id, full_name FROM public.users WHERE tenant_id = tA AND role = 'teacher' AND is_active ORDER BY full_name) x;
  tot := tot + sz;
  SELECT octet_length(coalesce(json_agg(x)::text, '')) INTO sz2 FROM (
    SELECT id, full_name FROM public.users WHERE tenant_id = tA AND role = 'student' AND is_active ORDER BY full_name) x;
  r := r || format('C2 BEFORE json=%s KB (teacher part %s KB) %s ms | ', (tot + sz2) / 1024, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  t0 := clock_timestamp();
  SELECT octet_length(coalesce(json_agg(x)::text, '')) INTO tot FROM (
    SELECT co.id, co.title, co.description, co.is_published, co.teacher_id,
      json_build_array(json_build_object('count', (SELECT count(*) FROM public.course_units u WHERE u.course_id = co.id))) AS course_units,
      json_build_array(json_build_object('count', (SELECT count(*) FROM public.course_enrollments e WHERE e.course_id = co.id))) AS course_enrollments,
      (SELECT json_build_object('full_name', u.full_name, 'role', u.role, 'is_active', u.is_active) FROM public.users u WHERE u.id = co.teacher_id) AS teacher
    FROM public.courses co WHERE co.tenant_id = tA AND co.deleted_at IS NULL ORDER BY co.created_at DESC) x;
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tA AND role = 'teacher' AND is_active;
  SELECT octet_length(coalesce(json_agg(x)::text, '')) INTO sz2 FROM (
    SELECT id, full_name FROM public.users WHERE tenant_id = tA AND role = 'student' AND is_active ORDER BY full_name) x;
  r := r || format('C2 AFTER json=%s KB %s ms | ', (tot + sz2) / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- SEARCH (on demand): one request.
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, full_name FROM public.users WHERE tenant_id = tA AND role = 'teacher' AND is_active
      AND full_name ILIKE '%Number 201%' ORDER BY full_name, id LIMIT 20) x;
  r := r || format('SEARCH "Number 201": rows=%s json=%s KB %s ms | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- Correctness through RLS.
  SELECT count(*) INTO c FROM (SELECT id FROM public.users WHERE tenant_id = tA AND role = 'teacher' AND is_active
    AND full_name ILIKE '%Teacher%' ORDER BY full_name LIMIT 20) x;
  r := r || format('L1 limit holds (%s of ~445 matches returned) | ', c);
  SELECT count(*) INTO c FROM public.users WHERE tenant_id = tA AND role = 'teacher' AND is_active AND full_name ILIKE '%Lookalike%';
  r := r || format('F1 students named like teachers never offered: %s | ', CASE WHEN c = 0 THEN 'PASS (0)' ELSE 'FAIL ' || c END);
  SELECT count(*) INTO c FROM public.users WHERE tenant_id = tA AND role = 'teacher' AND is_active AND full_name = 'Teacher Number 20007 Family';
  r := r || format('F2 a disabled teacher (k=20007) is never offered: %s | ', CASE WHEN c = 0 THEN 'PASS (0)' ELSE 'FAIL ' || c END);
  SELECT count(*) INTO c FROM public.groups g JOIN public.users u ON u.id = g.teacher_id
    WHERE g.tenant_id = tA AND NOT u.is_active;
  r := r || format('F3 groups whose teacher is disabled (the row will show «—»): %s visible with is_active=false | ', c);
  SELECT count(*) INTO c FROM public.users WHERE role = 'teacher' AND full_name ILIKE '%Bee Teacher%';
  r := r || format('I1 manager A finds B teachers: %s | ', CASE WHEN c = 0 THEN 'PASS (0)' ELSE 'FAIL ' || c END);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', mgrA2, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO c FROM public.users WHERE tenant_id = tA AND role = 'teacher';
  r := r || format('N1 (fact) a centre manager WITHOUT manage_groups/manage_courses reads %s teachers through RLS → the route checks the capability | ', c);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', studentA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO c FROM public.users WHERE tenant_id = tA AND role = 'teacher';
  r := r || format('I2 a student in no group lists no teacher: %s | ', CASE WHEN c = 0 THEN 'PASS (0)' ELSE 'FAIL ' || c END);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    SELECT count(*) INTO c FROM public.users WHERE tenant_id = tA;
    r := r || format('I3 anon reads 0: %s', CASE WHEN c = 0 THEN 'PASS' ELSE 'FAIL ' || c END);
  EXCEPTION WHEN insufficient_privilege THEN
    r := r || 'I3 anon reads 0: PASS (42501, no access at all)';
  END;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'RESULT: %', r;
END $$;

-- Afterwards (expect 0 / 0):
SELECT (SELECT count(*) FROM auth.users WHERE email LIKE 'tp%@scale.invalid') AS leftover_auth,
       (SELECT count(*) FROM public.tenants WHERE code IN ('ZZT5', 'ZZT6')) AS leftover_tenants;
