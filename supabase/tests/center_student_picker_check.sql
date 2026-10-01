-- Batch 2 / C-S — RosterModal student selector of /center/groups and /center/courses: before/after + isolation.
--
-- Institution A: 20 000 students (every 9th disabled; 1..300 "Group Member k" = group G1, 1..3000
-- "Course Member k" = course C1), 1 teacher, centre manager A (manage_groups + manage_courses).
-- Institution B: 5 000 students "Zeta Other k", a group and a course with members. Read through RLS
-- AS THE CENTRE MANAGER:
--   before = what each page sent: every active student (id, name) as the `students` prop;
--   after  = nothing on the page; on demand src/lib/data/people.ts searchStudents(…, {group|course},
--            {nameOnly}) — name ILIKE, the target's members anti-joined out, limit 20, id + name.
-- Ends with RAISE EXCEPTION: the report is the error message and EVERYTHING is rolled back.
-- DIAGNOSTIC: sizes scale with rows, times do not — never extrapolate times.

DO $$
DECLARE
  tA uuid := gen_random_uuid(); tB uuid := gen_random_uuid();
  mgr uuid; studentA uuid; g1 uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); gB uuid := gen_random_uuid(); cB uuid := gen_random_uuid();
  t0 timestamptz; r text := ''; c bigint; sz bigint;
BEGIN
  SET LOCAL statement_timeout = '118s';
  INSERT INTO public.tenants (id, name, slug, code) VALUES
    (tA, 'CSP A (rolled back)', 'csp-a-' || substr(tA::text, 1, 8), 'ZZS8'),
    (tB, 'CSP B (rolled back)', 'csp-b-' || substr(tB::text, 1, 8), 'ZZS9');
  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT gen_random_uuid() AS id, g AS k FROM generate_series(1, 25003) g;
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'csp' || k || '@scale.invalid', '{}', '{}', now(), now() FROM _ids;
  -- k=1..20000 students A, 20001 teacher A, 20002 manager A, 20003..25002 students B, 25003 teacher B
  UPDATE public.users u SET
    tenant_id = CASE WHEN _ids.k <= 20002 THEN tA ELSE tB END,
    role = CASE WHEN _ids.k IN (20001, 25003) THEN 'teacher' WHEN _ids.k = 20002 THEN 'center_manager' ELSE 'student' END,
    full_name = CASE WHEN _ids.k <= 300 THEN 'Group Member ' || _ids.k WHEN _ids.k <= 3000 THEN 'Course Member ' || _ids.k
                     WHEN _ids.k <= 20000 THEN 'Person Number ' || _ids.k || ' Family Name'
                     WHEN _ids.k BETWEEN 20003 AND 25002 THEN 'Zeta Other ' || _ids.k ELSE 'Staff ' || _ids.k END,
    is_active = (_ids.k % 9 <> 0 OR _ids.k IN (20001, 20002, 25003))
  FROM _ids WHERE u.id = _ids.id;
  SELECT id INTO mgr FROM _ids WHERE k = 20002; SELECT id INTO studentA FROM _ids WHERE k = 4000;
  UPDATE public.users SET permissions = '{"manage_groups": true, "manage_courses": true}'::jsonb WHERE id = mgr;
  INSERT INTO public.groups (id, tenant_id, teacher_id, name) VALUES
    (g1, tA, (SELECT id FROM _ids WHERE k = 20001), 'G1'), (gB, tB, (SELECT id FROM _ids WHERE k = 25003), 'GB');
  INSERT INTO public.courses (id, tenant_id, teacher_id, title) VALUES
    (c1, tA, (SELECT id FROM _ids WHERE k = 20001), 'C1'), (cB, tB, (SELECT id FROM _ids WHERE k = 25003), 'CB');
  INSERT INTO public.group_students (group_id, student_id) SELECT g1, id FROM _ids WHERE k <= 300;
  INSERT INTO public.course_enrollments (course_id, student_id, tenant_id) SELECT c1, id, tA FROM _ids WHERE k <= 3000;
  INSERT INTO public.group_students (group_id, student_id) SELECT gB, id FROM _ids WHERE k BETWEEN 20003 AND 20007;
  INSERT INTO public.course_enrollments (course_id, student_id, tenant_id) SELECT cB, id, tB FROM _ids WHERE k BETWEEN 20003 AND 20007;
  ANALYZE public.users; ANALYZE public.group_students; ANALYZE public.course_enrollments;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- BEFORE (each of /center/groups and /center/courses, on every load).
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(json_build_object('id', id, 'name', full_name) ORDER BY full_name)::text, '')) INTO c, sz
  FROM public.users WHERE tenant_id = tA AND role = 'student' AND is_active;
  r := r || format('BEFORE per page load: rows=%s props=%s KB %s ms | AFTER per page load: 0 rows, 0 KB | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- AFTER (on demand, one request each).
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT u.id, u.full_name FROM public.users u LEFT JOIN public.group_students gs ON gs.student_id = u.id AND gs.group_id = g1
    WHERE u.tenant_id = tA AND u.role = 'student' AND u.is_active AND u.full_name ILIKE '%Number 1%' AND gs.student_id IS NULL
    ORDER BY u.full_name, u.id LIMIT 20) x;
  r := r || format('SEARCH group rows=%s json=%s KB %s ms | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT u.id, u.full_name FROM public.users u LEFT JOIN public.course_enrollments e ON e.student_id = u.id AND e.course_id = c1
    WHERE u.tenant_id = tA AND u.role = 'student' AND u.is_active AND u.full_name ILIKE '%Number 1%' AND e.student_id IS NULL
    ORDER BY u.full_name, u.id LIMIT 20) x;
  r := r || format('SEARCH course rows=%s json=%s KB %s ms | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- Target correctness: each target leaves out ITS members only.
  SELECT count(*) INTO c FROM (SELECT u.id FROM public.users u LEFT JOIN public.group_students gs ON gs.student_id = u.id AND gs.group_id = g1
    WHERE u.tenant_id = tA AND u.role = 'student' AND u.is_active AND u.full_name ILIKE '%Group Member%' AND gs.student_id IS NULL LIMIT 20) x;
  r := r || format('T1 group members never offered for the group: %s | ', CASE WHEN c = 0 THEN 'PASS (0)' ELSE 'FAIL ' || c END);
  SELECT count(*) INTO c FROM (SELECT u.id FROM public.users u LEFT JOIN public.course_enrollments e ON e.student_id = u.id AND e.course_id = c1
    WHERE u.tenant_id = tA AND u.role = 'student' AND u.is_active AND u.full_name ILIKE '%Member%' AND e.student_id IS NULL LIMIT 20) x;
  r := r || format('T2 course members (3 000) never offered for the course: %s | ', CASE WHEN c = 0 THEN 'PASS (0)' ELSE 'FAIL ' || c END);
  SELECT count(*) INTO c FROM (SELECT u.id FROM public.users u LEFT JOIN public.group_students gs ON gs.student_id = u.id AND gs.group_id = g1
    WHERE u.tenant_id = tA AND u.role = 'student' AND u.is_active AND u.full_name ILIKE '%Course Member%' AND gs.student_id IS NULL LIMIT 20) x;
  r := r || format('T3 course members ARE offered for a group they are not in: %s | ', CASE WHEN c = 20 THEN 'PASS (20 = limit)' ELSE 'FAIL ' || c END);
  SELECT count(*) INTO c FROM (SELECT u.id FROM public.users u
    WHERE u.tenant_id = tA AND u.role = 'student' AND u.is_active AND u.full_name ILIKE '%Staff%' LIMIT 20) x;
  r := r || format('F1 staff named like the search never offered: %s | ', CASE WHEN c = 0 THEN 'PASS (0)' ELSE 'FAIL ' || c END);
  SELECT count(*) INTO c FROM public.users WHERE tenant_id = tA AND role = 'student' AND is_active AND full_name = 'Person Number 9999 Family Name';
  r := r || format('F2 a disabled student (k=9999) never offered: %s | ', CASE WHEN c = 0 THEN 'PASS (0)' ELSE 'FAIL ' || c END);

  -- Isolation.
  SELECT count(*) INTO c FROM public.users WHERE role = 'student' AND full_name ILIKE '%Zeta Other%';
  r := r || format('I1 manager A finds B students: %s | ', CASE WHEN c = 0 THEN 'PASS (0)' ELSE 'FAIL ' || c END);
  SELECT count(*) INTO c FROM public.group_students WHERE group_id = gB;
  SELECT count(*) INTO sz FROM public.course_enrollments WHERE course_id = cB;
  r := r || format('I2 manager A sees B memberships/enrolments: %s | ', CASE WHEN c = 0 AND sz = 0 THEN 'PASS (0/0)' ELSE 'FAIL ' || c || '/' || sz END);
  SELECT count(*) INTO c FROM public.group_students WHERE group_id = g1;
  SELECT count(*) INTO sz FROM public.course_enrollments WHERE course_id = c1;
  r := r || format('I3 manager A reads the memberships the exclusion needs: %s | ', CASE WHEN c = 300 AND sz = 3000 THEN 'PASS (300/3000)' ELSE 'FAIL ' || c || '/' || sz END);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', studentA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO c FROM public.users WHERE tenant_id = tA AND role = 'student' AND id <> studentA;
  r := r || format('I4 a student lists no other student: %s | ', CASE WHEN c = 0 THEN 'PASS (0)' ELSE 'FAIL ' || c END);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    SELECT count(*) INTO c FROM public.users WHERE tenant_id = tA;
    r := r || format('I5 anon reads 0: %s', CASE WHEN c = 0 THEN 'PASS' ELSE 'FAIL ' || c END);
  EXCEPTION WHEN insufficient_privilege THEN
    r := r || 'I5 anon reads 0: PASS (42501, no access at all)';
  END;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'RESULT: %', r;
END $$;

-- Afterwards (expect 0 / 0):
SELECT (SELECT count(*) FROM auth.users WHERE email LIKE 'csp%@scale.invalid') AS leftover_auth,
       (SELECT count(*) FROM public.tenants WHERE code IN ('ZZS8', 'ZZS9')) AS leftover_tenants;
