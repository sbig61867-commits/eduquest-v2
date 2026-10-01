-- Batch 2 — C1/C2 baseline: /center/groups and /center/courses member pickers (RosterModal) and teacher
-- selectors. Inventory only — no code depends on this file. Fully rolled back.
--
-- Institution A: 20 000 students (every 9th disabled), 500 teachers (every 9th disabled), 1 admin,
--   centre manager A (manage_groups + manage_courses) and centre manager A2 (no capability);
--   1 000 groups — group 1 has 300 members, groups 2..1000 have 19 each;
--   200 courses — course 1 has 3 000 enrolments, courses 2..200 have 50 each.
--   Names: students 1..300 "Group Member k" (also enrolled in course 1), 301..3000 "Course Member k"
--   (enrolled in course 1), the rest "Person Number k".
-- Institution B: 5 000 students, 100 teachers, centre manager B, one group and one course with 5 members.
--
-- Sections:
--   C1/C2 PAGE  — the reads each page makes today, through RLS as centre manager A;
--   ROSTER      — the member lists RosterModal fetches (GET /api/group-students, /api/course-enrollments
--                 run with the service-role client, so here without RLS);
--   PROBE       — the proposed on-demand search (anti-join on the target's membership, limit 20)
--                 through RLS as the centre manager; exclusion per target; isolation; and the fact that
--                 RLS does not know capabilities (the route must check them).
-- Ends with RAISE EXCEPTION: the report is the error message and EVERYTHING is rolled back.
-- DIAGNOSTIC: sizes scale with rows, times do not — never extrapolate times.

DO $$
DECLARE
  tA uuid := gen_random_uuid(); tB uuid := gen_random_uuid();
  mgrA uuid; mgrA2 uuid; mgrB uuid; studentA uuid; g1 uuid; c1 uuid; gB uuid; cB uuid;
  t0 timestamptz; r text := ''; c bigint; sz bigint; total bigint := 0; ms numeric; n bigint;
BEGIN
  SET LOCAL statement_timeout = '118s';
  INSERT INTO public.tenants (id, name, slug, code) VALUES
    (tA, 'ROSTER A (rolled back)', 'roster-a-' || substr(tA::text, 1, 8), 'ZZR1'),
    (tB, 'ROSTER B (rolled back)', 'roster-b-' || substr(tB::text, 1, 8), 'ZZR2');
  CREATE TEMP TABLE _ids ON COMMIT DROP AS
    SELECT gen_random_uuid() AS id, g AS k FROM generate_series(1, 25605) g;
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cr' || k || '@scale.invalid', '{}', '{}', now(), now() FROM _ids;
  -- k=1..20000 students A, 20001..20500 teachers A, 20501 admin A, 20502 manager A, 20503 manager A2,
  -- 20504..25503 students B, 25504..25603 teachers B, 25604 manager B, 25605 spare
  UPDATE public.users u SET
    tenant_id = CASE WHEN _ids.k <= 20503 THEN tA ELSE tB END,
    role = CASE WHEN _ids.k <= 20000 OR _ids.k BETWEEN 20504 AND 25503 OR _ids.k = 25605 THEN 'student'
                WHEN _ids.k <= 20500 OR _ids.k BETWEEN 25504 AND 25603 THEN 'teacher'
                WHEN _ids.k = 20501 THEN 'university_admin'
                ELSE 'center_manager' END,
    full_name = CASE WHEN _ids.k <= 300 THEN 'Group Member ' || _ids.k
                     WHEN _ids.k <= 3000 THEN 'Course Member ' || _ids.k
                     WHEN _ids.k BETWEEN 20504 AND 25503 THEN 'Zeta Other ' || _ids.k
                     ELSE 'Person Number ' || _ids.k END,
    is_active = (_ids.k % 9 <> 0),
    created_at = now() - (_ids.k || ' seconds')::interval
  FROM _ids WHERE u.id = _ids.id;
  SELECT id INTO mgrA FROM _ids WHERE k = 20502; SELECT id INTO mgrA2 FROM _ids WHERE k = 20503;
  SELECT id INTO mgrB FROM _ids WHERE k = 25604; SELECT id INTO studentA FROM _ids WHERE k = 4000;
  UPDATE public.users SET permissions = '{"manage_groups": true, "manage_courses": true}'::jsonb WHERE id IN (mgrA, mgrB);

  CREATE TEMP TABLE _groups ON COMMIT DROP AS SELECT gen_random_uuid() AS id, g FROM generate_series(1, 1000) g;
  INSERT INTO public.groups (id, tenant_id, teacher_id, name, description)
    SELECT gg.id, tA, (SELECT id FROM _ids WHERE k = 20001 + (gg.g % 500)), 'Group ' || gg.g, 'Section of the term — group ' || gg.g FROM _groups gg;
  SELECT id INTO g1 FROM _groups WHERE g = 1;
  INSERT INTO public.group_students (group_id, student_id) SELECT g1, id FROM _ids WHERE k BETWEEN 1 AND 300;
  INSERT INTO public.group_students (group_id, student_id)
    SELECT gg.id, i.id FROM _groups gg JOIN _ids i ON i.k BETWEEN 301 + (gg.g - 2) * 19 AND 301 + (gg.g - 2) * 19 + 18 WHERE gg.g >= 2;

  CREATE TEMP TABLE _courses ON COMMIT DROP AS SELECT gen_random_uuid() AS id, cn FROM generate_series(1, 200) cn;
  INSERT INTO public.courses (id, tenant_id, teacher_id, title, description)
    SELECT cc.id, tA, (SELECT id FROM _ids WHERE k = 20001 + (cc.cn % 500)), 'Course ' || cc.cn, 'Continuing-education course ' || cc.cn FROM _courses cc;
  SELECT id INTO c1 FROM _courses WHERE cn = 1;
  INSERT INTO public.course_enrollments (course_id, student_id, tenant_id) SELECT c1, id, tA FROM _ids WHERE k BETWEEN 1 AND 3000;
  INSERT INTO public.course_enrollments (course_id, student_id, tenant_id)
    SELECT cc.id, i.id, tA FROM _courses cc JOIN _ids i ON i.k BETWEEN 3001 + (cc.cn - 2) * 50 AND 3001 + (cc.cn - 2) * 50 + 49 WHERE cc.cn >= 2;

  gB := gen_random_uuid(); cB := gen_random_uuid();
  INSERT INTO public.groups (id, tenant_id, teacher_id, name) VALUES (gB, tB, (SELECT id FROM _ids WHERE k = 25504), 'B group');
  INSERT INTO public.courses (id, tenant_id, teacher_id, title) VALUES (cB, tB, (SELECT id FROM _ids WHERE k = 25504), 'B course');
  INSERT INTO public.group_students (group_id, student_id) SELECT gB, id FROM _ids WHERE k BETWEEN 20504 AND 20508;
  INSERT INTO public.course_enrollments (course_id, student_id, tenant_id) SELECT cB, id, tB FROM _ids WHERE k BETWEEN 20504 AND 20508;
  ANALYZE public.users; ANALYZE public.groups; ANALYZE public.courses; ANALYZE public.group_students; ANALYZE public.course_enrollments;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', mgrA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- ── C1 PAGE /center/groups (today): groups(*, group_students(count)) + active teachers + active students + courses.
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x.j)::text, '')) INTO c, sz FROM (
    SELECT to_jsonb(g) || jsonb_build_object('group_students', jsonb_build_array(jsonb_build_object('count',
      (SELECT count(*) FROM public.group_students gs WHERE gs.group_id = g.id)))) AS j
    FROM public.groups g WHERE g.tenant_id = tA ORDER BY g.created_at DESC) x;
  r := r || format('C1 groups rows=%s json=%s KB | ', c, sz / 1024); total := sz;
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, full_name FROM public.users WHERE tenant_id = tA AND role = 'teacher' AND is_active ORDER BY full_name) x;
  r := r || format('C1 teachers rows=%s json=%s KB | ', c, sz / 1024); total := total + sz;
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, full_name FROM public.users WHERE tenant_id = tA AND role = 'student' AND is_active ORDER BY full_name) x;
  r := r || format('C1 students rows=%s json=%s KB | ', c, sz / 1024); total := total + sz;
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, title FROM public.courses WHERE tenant_id = tA ORDER BY title) x;
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  r := r || format('C1 courses rows=%s json=%s KB | C1 PAGE TOTAL json=%s KB %s ms | ', c, sz / 1024, (total + sz) / 1024, ms);

  -- ── C2 PAGE /center/courses (today): courses(id,title,description,is_published,teacher_id, counts) + teachers + students.
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT co.id, co.title, co.description, co.is_published, co.teacher_id,
      json_build_array(json_build_object('count', (SELECT count(*) FROM public.course_units u WHERE u.course_id = co.id))) AS course_units,
      json_build_array(json_build_object('count', (SELECT count(*) FROM public.course_enrollments e WHERE e.course_id = co.id))) AS course_enrollments
    FROM public.courses co WHERE co.tenant_id = tA AND co.deleted_at IS NULL ORDER BY co.created_at DESC) x;
  r := r || format('C2 courses rows=%s json=%s KB | ', c, sz / 1024); total := sz;
  SELECT octet_length(coalesce(json_agg(x)::text, '')) INTO sz FROM (
    SELECT id, full_name FROM public.users WHERE tenant_id = tA AND role = 'teacher' AND is_active ORDER BY full_name) x;
  total := total + sz;
  SELECT octet_length(coalesce(json_agg(x)::text, '')) INTO sz FROM (
    SELECT id, full_name FROM public.users WHERE tenant_id = tA AND role = 'student' AND is_active ORDER BY full_name) x;
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  r := r || format('C2 PAGE TOTAL json=%s KB %s ms (students alone %s KB) | ', (total + sz) / 1024, ms, sz / 1024);

  -- ── PROBE: proposed search through RLS as manager A (anti-join on the target, limit 20).
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT u.id, u.full_name, u.email FROM public.users u
    LEFT JOIN public.group_students gs ON gs.student_id = u.id AND gs.group_id = g1
    WHERE u.tenant_id = tA AND u.role = 'student' AND u.is_active
      AND (u.full_name ILIKE '%Number 1%' OR u.email ILIKE '%Number 1%') AND gs.student_id IS NULL
    ORDER BY u.full_name, u.id LIMIT 20) x;
  r := r || format('PROBE group search "Number 1": rows=%s json=%s KB %s ms | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT u.id, u.full_name, u.email FROM public.users u
    LEFT JOIN public.course_enrollments e ON e.student_id = u.id AND e.course_id = c1
    WHERE u.tenant_id = tA AND u.role = 'student' AND u.is_active
      AND (u.full_name ILIKE '%Number 1%' OR u.email ILIKE '%Number 1%') AND e.student_id IS NULL
    ORDER BY u.full_name, u.id LIMIT 20) x;
  r := r || format('PROBE course search "Number 1": rows=%s json=%s KB %s ms | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- E1/E2/E3: exclusion is per target.
  SELECT count(*) INTO c FROM (SELECT u.id FROM public.users u
    LEFT JOIN public.group_students gs ON gs.student_id = u.id AND gs.group_id = g1
    WHERE u.tenant_id = tA AND u.role = 'student' AND u.is_active AND u.full_name ILIKE '%Group Member%' AND gs.student_id IS NULL LIMIT 20) x;
  r := r || format('E1 group members never offered for their group: %s | ', CASE WHEN c = 0 THEN 'PASS (0)' ELSE 'FAIL ' || c END);
  SELECT count(*) INTO c FROM (SELECT u.id FROM public.users u
    LEFT JOIN public.course_enrollments e ON e.student_id = u.id AND e.course_id = c1
    WHERE u.tenant_id = tA AND u.role = 'student' AND u.is_active AND u.full_name ILIKE '%Member%' AND e.student_id IS NULL LIMIT 20) x;
  r := r || format('E2 course members (3 000) never offered for their course: %s | ', CASE WHEN c = 0 THEN 'PASS (0)' ELSE 'FAIL ' || c END);
  SELECT count(*) INTO c FROM (SELECT u.id FROM public.users u
    LEFT JOIN public.group_students gs ON gs.student_id = u.id AND gs.group_id = g1
    WHERE u.tenant_id = tA AND u.role = 'student' AND u.is_active AND u.full_name ILIKE '%Course Member%' AND gs.student_id IS NULL LIMIT 20) x;
  r := r || format('E3 course members ARE offered for a group they are not in: %s | ', CASE WHEN c = 20 THEN 'PASS (20)' ELSE 'FAIL ' || c END);

  -- I1/I2: manager A sees nothing of B (students, memberships, enrolments).
  SELECT count(*) INTO c FROM public.users WHERE role = 'student' AND full_name ILIKE '%Zeta Other%';
  SELECT count(*) INTO n FROM public.group_students WHERE group_id = gB;
  r := r || format('I1 manager A finds B students: %s, B memberships: %s', CASE WHEN c = 0 THEN 'PASS (0)' ELSE 'FAIL ' || c END, CASE WHEN n = 0 THEN 'PASS (0)' ELSE 'FAIL ' || n END);
  SELECT count(*) INTO n FROM public.course_enrollments WHERE course_id = cB;
  r := r || format(', B enrolments: %s | ', CASE WHEN n = 0 THEN 'PASS (0)' ELSE 'FAIL ' || n END);
  -- I3: manager A sees its own memberships (needed for the exclusion under its session).
  SELECT count(*) INTO c FROM public.group_students WHERE group_id = g1;
  SELECT count(*) INTO n FROM public.course_enrollments WHERE course_id = c1;
  r := r || format('I3 manager A reads own group/course membership: %s | ', CASE WHEN c = 300 AND n = 3000 THEN 'PASS (300/3000)' ELSE 'FAIL ' || c || '/' || n END);
  EXECUTE 'RESET ROLE';

  -- N1 (fact): RLS does not know capabilities — manager A2 holds none and still reads A's students.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mgrA2, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO c FROM public.users WHERE tenant_id = tA AND role = 'student';
  r := r || format('N1 (fact) a centre manager WITHOUT manage_groups/manage_courses reads %s students through RLS → the route must check the capability | ', c);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', mgrB, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO c FROM public.users WHERE tenant_id = tA;
  SELECT count(*) INTO n FROM public.course_enrollments WHERE course_id = c1;
  r := r || format('I4 manager B reads A users / A enrolments: %s | ', CASE WHEN c = 0 AND n = 0 THEN 'PASS (0/0)' ELSE 'FAIL ' || c || '/' || n END);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', studentA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO c FROM public.users WHERE tenant_id = tA AND role = 'student' AND id <> studentA;
  r := r || format('I5 a student sees no other student: %s | ', CASE WHEN c = 0 THEN 'PASS (0)' ELSE 'FAIL ' || c END);
  EXECUTE 'RESET ROLE';

  -- ── ROSTER: what RosterModal fetches when opened (service-role client in the route ⇒ no RLS here).
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT gs.student_id, json_build_object('id', u.id, 'full_name', u.full_name, 'email', u.email) AS users
    FROM public.group_students gs JOIN public.users u ON u.id = gs.student_id WHERE gs.group_id = g1) x;
  r := r || format('ROSTER group of 300: rows=%s json=%s KB %s ms | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT e.student_id, e.enrolled_at, json_build_object('id', u.id, 'full_name', u.full_name, 'email', u.email) AS users
    FROM public.course_enrollments e JOIN public.users u ON u.id = e.student_id WHERE e.course_id = c1 ORDER BY e.enrolled_at DESC) x;
  r := r || format('ROSTER course of 3 000: rows=%s json=%s KB %s ms', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  RAISE EXCEPTION 'RESULT: %', r;
END $$;

-- Afterwards (expect 0 / 0):
SELECT (SELECT count(*) FROM auth.users WHERE email LIKE 'cr%@scale.invalid') AS leftover_auth,
       (SELECT count(*) FROM public.tenants WHERE code IN ('ZZR1', 'ZZR2')) AS leftover_tenants;
