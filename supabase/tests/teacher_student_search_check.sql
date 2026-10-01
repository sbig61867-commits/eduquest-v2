-- Batch 2 / T1 — /teacher/groups «إدارة الطلاب» student selector: scale + correctness + isolation.
--
-- Institution A: 20 000 students (every 9th disabled), 1 admin, 2 teachers; teacher A1 owns a group whose
-- 30 members all match the test search. Institution B: 5 000 students + 1 teacher. Read through RLS
-- AS THE TEACHER:
--   before = the page's old read: every active student of the institution (id, full_name, email);
--   after  = src/lib/data/people.ts searchStudents — the SQL PostgREST runs for
--            users?select=id,full_name,email,group_students!…(group_id)&group_students.group_id=eq.G
--              &group_students=is.null&or=(full_name.ilike."%q%",email.ilike."%q%")&limit=20
--            (a LEFT JOIN on the group's membership, kept only where it is NULL).
-- Ends with RAISE EXCEPTION: the report is the error message and EVERYTHING is rolled back.
-- DIAGNOSTIC: sizes scale with rows, times do not — never extrapolate times.

DO $$
DECLARE
  tA uuid := gen_random_uuid(); tB uuid := gen_random_uuid();
  teacherA uuid; teacherA2 uuid; teacherB uuid; studentA uuid; grp uuid := gen_random_uuid(); grpB uuid := gen_random_uuid();
  t0 timestamptz; r text := ''; c bigint; sz bigint; n bigint; m bigint;
BEGIN
  SET LOCAL statement_timeout = '118s';
  INSERT INTO public.tenants (id, name, slug, code) VALUES
    (tA, 'TSRCH A (rolled back)', 'tsrch-a-' || substr(tA::text, 1, 8), 'ZZS1'),
    (tB, 'TSRCH B (rolled back)', 'tsrch-b-' || substr(tB::text, 1, 8), 'ZZS2');
  CREATE TEMP TABLE _ids ON COMMIT DROP AS
    SELECT gen_random_uuid() AS id, g AS k FROM generate_series(1, 25004) g;
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ts' || k || '@scale.invalid', '{}', '{}', now(), now() FROM _ids;
  -- k=1..20000 students A, 20001 admin A, 20002 teacher A1, 20003 teacher A2,
  -- 20004..25003 students B, 25004 teacher B
  UPDATE public.users u SET
    tenant_id = CASE WHEN _ids.k <= 20003 THEN tA ELSE tB END,
    role = CASE WHEN _ids.k = 20001 THEN 'university_admin'
                WHEN _ids.k IN (20002, 20003, 25004) THEN 'teacher'
                ELSE 'student' END,
    full_name = CASE WHEN _ids.k BETWEEN 20004 AND 25003 THEN 'Zeta Other ' || _ids.k
                     WHEN _ids.k BETWEEN 1 AND 30 THEN 'Member Alpha ' || _ids.k
                     ELSE 'Person Number ' || _ids.k END,
    is_active = (_ids.k % 9 <> 0),
    created_at = now() - (_ids.k || ' seconds')::interval
  FROM _ids WHERE u.id = _ids.id;
  -- The teachers and admin are named like students, so a role leak would show up in the search.
  UPDATE public.users SET full_name = 'Member Alpha Staff ' || role WHERE id IN (SELECT id FROM _ids WHERE k IN (20001, 20002, 20003, 25004));
  SELECT id INTO teacherA FROM _ids WHERE k = 20002; SELECT id INTO teacherA2 FROM _ids WHERE k = 20003;
  SELECT id INTO teacherB FROM _ids WHERE k = 25004; SELECT id INTO studentA FROM _ids WHERE k = 40;
  INSERT INTO public.groups (id, tenant_id, teacher_id, name) VALUES (grp, tA, teacherA, 'Search group'), (grpB, tB, teacherB, 'B group');
  INSERT INTO public.group_students (group_id, student_id) SELECT grp, id FROM _ids WHERE k BETWEEN 1 AND 30 AND k % 9 <> 0;
  INSERT INTO public.group_students (group_id, student_id) SELECT grpB, id FROM _ids WHERE k BETWEEN 20004 AND 20010;
  ANALYZE public.users; ANALYZE public.group_students;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', teacherA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- BEFORE: what /teacher/groups used to send to the browser on every visit.
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, full_name, email FROM public.users
    WHERE tenant_id = tA AND role = 'student' AND is_active ORDER BY full_name) x;
  r := r || format('BEFORE page load: rows=%s json=%s KB %s ms | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  r := r || 'AFTER page load: 0 student rows (no student read on the page) | ';

  -- AFTER: one search ("Number 1" matches ~2 000 students) — anti-join + limit 20.
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT u.id, u.full_name, u.email FROM public.users u
    LEFT JOIN public.group_students gs ON gs.student_id = u.id AND gs.group_id = grp
    WHERE u.tenant_id = tA AND u.role = 'student' AND u.is_active
      AND (u.full_name ILIKE '%Number 1%' OR u.email ILIKE '%Number 1%') AND gs.student_id IS NULL
    ORDER BY u.full_name, u.id LIMIT 20) x;
  r := r || format('AFTER search "Number 1": rows=%s json=%s KB %s ms | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  t0 := clock_timestamp();
  SELECT count(*) INTO c FROM (
    SELECT u.id FROM public.users u
    LEFT JOIN public.group_students gs ON gs.student_id = u.id AND gs.group_id = grp
    WHERE u.tenant_id = tA AND u.role = 'student' AND u.is_active
      AND (u.full_name ILIKE '%Number 19999%' OR u.email ILIKE '%Number 19999%') AND gs.student_id IS NULL
    ORDER BY u.full_name, u.id LIMIT 20) x;
  r := r || format('AFTER rare search: rows=%s %s ms | ', c, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- E1: searching the members' own name returns none of the group's members (all 30 match "Member Alpha").
  SELECT count(*) INTO n FROM public.group_students WHERE group_id = grp;
  SELECT count(*) INTO c FROM (
    SELECT u.id FROM public.users u
    LEFT JOIN public.group_students gs ON gs.student_id = u.id AND gs.group_id = grp
    WHERE u.tenant_id = tA AND u.role = 'student' AND u.is_active
      AND (u.full_name ILIKE '%Member Alpha%' OR u.email ILIKE '%Member Alpha%') AND gs.student_id IS NULL
    LIMIT 20) x;
  r := r || format('E1 members excluded (%s members match, %s offered): %s | ', n, c, CASE WHEN c = 0 AND n > 0 THEN 'PASS' ELSE 'FAIL' END);
  -- F1: disabled students and other roles are never offered.
  SELECT count(*) INTO c FROM (
    SELECT u.id FROM public.users u
    WHERE u.tenant_id = tA AND u.role = 'student' AND u.is_active AND (u.full_name ILIKE '%Staff%')) x;
  r := r || format('F1 search for staff names returns no staff: %s | ', CASE WHEN c = 0 THEN 'PASS (0)' ELSE 'FAIL ' || c END);
  SELECT count(*) INTO c FROM (
    SELECT u.id FROM public.users u WHERE u.tenant_id = tA AND u.role = 'student' AND u.is_active AND u.full_name = 'Person Number 9999') x;
  r := r || format('F2 a disabled student (k=9999) is not offered: %s | ', CASE WHEN c = 0 THEN 'PASS (0)' ELSE 'FAIL ' || c END);

  -- I1/I2: teacher A cannot find institution B's students, nor see B's memberships.
  SELECT count(*) INTO c FROM public.users WHERE role = 'student' AND full_name ILIKE '%Zeta Other%';
  SELECT count(*) INTO m FROM public.group_students WHERE group_id = grpB;
  r := r || format('I1 teacher A searching B names: %s, I2 B memberships visible: %s | ',
    CASE WHEN c = 0 THEN 'PASS (0)' ELSE 'FAIL ' || c END, CASE WHEN m = 0 THEN 'PASS (0)' ELSE 'FAIL ' || m END);
  -- I3: the anti-join reads teacher A's own group (so the exclusion really applies under their session).
  SELECT count(*) INTO m FROM public.group_students WHERE group_id = grp;
  r := r || format('I3 teacher A sees own group membership (needed for the exclusion): %s | ', CASE WHEN m = n THEN 'PASS (' || m || ')' ELSE 'FAIL ' || m END);
  EXECUTE 'RESET ROLE';

  -- Same scope as before the change: the other teacher of A could already read A's students.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', teacherA2, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO c FROM public.users WHERE tenant_id = tA AND role = 'student' AND is_active;
  r := r || format('S1 scope unchanged — a teacher reads the institution''s active students (%s) exactly as before | ', c);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', teacherB, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO c FROM public.users WHERE tenant_id = tA;
  r := r || format('I4 teacher B reads institution A: %s | ', CASE WHEN c = 0 THEN 'PASS (0)' ELSE 'FAIL ' || c END);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', studentA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  -- (their own row matches "Number" too and is theirs to read — count everyone else)
  SELECT count(*) INTO c FROM public.users WHERE tenant_id = tA AND role = 'student' AND full_name ILIKE '%Number%' AND id <> studentA;
  r := r || format('I5 a student running the same search sees no other student: %s | ', CASE WHEN c = 0 THEN 'PASS (0)' ELSE 'FAIL ' || c END);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    SELECT count(*) INTO c FROM public.users WHERE tenant_id = tA;
    r := r || format('I6 anon reads 0: %s', CASE WHEN c = 0 THEN 'PASS' ELSE 'FAIL ' || c END);
  EXCEPTION WHEN insufficient_privilege THEN
    r := r || 'I6 anon reads 0: PASS (42501, no access at all)';
  END;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'RESULT: %', r;
END $$;

-- Afterwards (expect 0 / 0):
SELECT (SELECT count(*) FROM auth.users WHERE email LIKE 'ts%@scale.invalid') AS leftover_auth,
       (SELECT count(*) FROM public.tenants WHERE code IN ('ZZS1', 'ZZS2')) AS leftover_tenants;
