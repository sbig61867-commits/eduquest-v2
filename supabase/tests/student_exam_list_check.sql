-- Regression check — Batch 1: get_student_exam_list() (student_exam_list_migration.sql)
-- and, when applied, the lockdown of get_student_exams() (student_exam_list_lockdown_migration.sql).
--
-- Seeds two throw-away institutions inside the transaction, runs every check as
-- the real role through RLS, and ends with RAISE EXCEPTION: the report is the
-- error message and EVERYTHING is rolled back. Run it after PART A (and again
-- after PART B). For a dry run before applying, prepend the migration file(s)
-- to this script in the same execution: the whole batch is one transaction.
--
-- Expected: every line "PASS"; the last line reports whether PART B is applied.

DO $$
DECLARE
  tA uuid := gen_random_uuid(); tB uuid := gen_random_uuid();
  teacherA uuid; s1 uuid; s2 uuid; s3 uuid; teacherB uuid; sB uuid;
  gA uuid := gen_random_uuid(); gArch uuid := gen_random_uuid(); gB uuid := gen_random_uuid(); gOther uuid := gen_random_uuid();
  cA uuid := gen_random_uuid();
  e1 uuid := gen_random_uuid(); e2 uuid := gen_random_uuid(); e3 uuid := gen_random_uuid(); e4 uuid := gen_random_uuid();
  e5 uuid := gen_random_uuid(); e6 uuid := gen_random_uuid(); e7 uuid := gen_random_uuid(); eB uuid := gen_random_uuid();
  eG uuid := gen_random_uuid(); eDel uuid := gen_random_uuid(); eSub uuid := gen_random_uuid();
  got text;
  r text := ''; ids uuid[]; n int; ok boolean; j jsonb;
  mcq jsonb := '{"id":"q1","type":"mcq","text":"2+2","options":["3","4"],"correct_answer":"4","points":2}';
  tf  jsonb := '{"id":"q2","type":"true_false","text":"Sky","correct_answer":"True","points":1}';
  ess jsonb := '{"id":"q3","type":"essay","text":"Explain","correct_answer":"","points":3}';
  sa  jsonb := '{"id":"q4","type":"short_answer","text":"Name","correct_answer":"","points":5}';
BEGIN
  SET LOCAL statement_timeout = '60s';

  -- ── Seed ──────────────────────────────────────────────────────────────────
  INSERT INTO public.tenants (id, name, slug, code) VALUES
    (tA, 'CHECK A (rolled back)', 'chk-a-' || substr(tA::text, 1, 8), 'ZZA1'),
    (tB, 'CHECK B (rolled back)', 'chk-b-' || substr(tB::text, 1, 8), 'ZZB1');
  CREATE TEMP TABLE _u ON COMMIT DROP AS
    SELECT gen_random_uuid() AS id, x.k, x.role, x.tenant FROM (VALUES
      ('teacherA', 'teacher', tA), ('s1', 'student', tA), ('s2', 'student', tA), ('s3', 'student', tA),
      ('teacherB', 'teacher', tB), ('sB', 'student', tB)) AS x(k, role, tenant);
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', k || '-' || substr(id::text, 1, 8) || '@check.invalid', '{}', '{}', now(), now() FROM _u;
  UPDATE public.users u SET tenant_id = _u.tenant, role = _u.role, full_name = _u.k, is_active = true FROM _u WHERE u.id = _u.id;
  SELECT id INTO teacherA FROM _u WHERE k = 'teacherA'; SELECT id INTO s1 FROM _u WHERE k = 's1';
  SELECT id INTO s2 FROM _u WHERE k = 's2';             SELECT id INTO s3 FROM _u WHERE k = 's3';
  SELECT id INTO teacherB FROM _u WHERE k = 'teacherB'; SELECT id INTO sB FROM _u WHERE k = 'sB';

  INSERT INTO public.groups (id, tenant_id, teacher_id, name, is_active) VALUES
    (gA, tA, teacherA, 'Group A', true), (gArch, tA, teacherA, 'Archived A', false), (gB, tB, teacherB, 'Group B', true),
    (gOther, tA, teacherA, 'Other group A', true);
  INSERT INTO public.group_students (group_id, student_id) VALUES (gA, s1), (gA, s2), (gArch, s1), (gB, sB);
  INSERT INTO public.courses (id, tenant_id, teacher_id, title, is_published) VALUES (cA, tA, teacherA, 'Course A', true);
  INSERT INTO public.course_enrollments (course_id, student_id, tenant_id) VALUES (cA, s1, tA);

  INSERT INTO public.exams (id, tenant_id, teacher_id, group_id, course_id, title, questions, is_published, starts_at, assigned_student_id, deleted_at, created_at) VALUES
    (e1, tA, teacherA, gA,   NULL, 'Future exam (not open)', jsonb_build_array(mcq, ess), true,  now() + interval '1 day', NULL, NULL, now() - interval '1 min'),
    (e2, tA, teacherA, gA,   NULL, 'Auto-only exam',         jsonb_build_array(mcq, tf),  true,  NULL, NULL, NULL, now() - interval '2 min'),
    (e3, tA, teacherA, gA,   NULL, 'Unpublished',            jsonb_build_array(mcq),      false, NULL, NULL, NULL, now() - interval '3 min'),
    (e4, tA, teacherA, NULL, cA,   'Course quiz',            jsonb_build_array(sa),       true,  NULL, NULL, NULL, now() - interval '4 min'),
    (e5, tA, teacherA, gA,   NULL, 'Individual task for s2', jsonb_build_array(ess),      true,  NULL, s2,   NULL, now() - interval '5 min'),
    (e6, tA, teacherA, gArch, NULL,'Archived group exam',    jsonb_build_array(mcq),      true,  NULL, NULL, NULL, now() - interval '6 min'),
    (e7, tA, teacherA, gA,   NULL, 'Deleted exam',           jsonb_build_array(mcq),      true,  NULL, NULL, now(), now() - interval '7 min'),
    (eB, tB, teacherB, gB,   NULL, 'Other institution',      jsonb_build_array(mcq),      true,  NULL, NULL, NULL, now() - interval '8 min'),
    (eG, tA, teacherA, gOther, NULL,'Other group, same inst.', jsonb_build_array(mcq),     true,  NULL, NULL, NULL, now() - interval '9 min'),
    (eDel, tA, teacherA, gA, NULL, 'Deleted after start',    jsonb_build_array(mcq),      true,  NULL, NULL, NULL, now() - interval '10 min'),
    (eSub, tA, teacherA, gA, NULL, 'Already submitted',      jsonb_build_array(mcq),      true,  NULL, NULL, NULL, now() - interval '11 min');

  -- ── Checks ────────────────────────────────────────────────────────────────
  -- L1: s1 sees exactly its group + course exams, newest first; not unpublished / other's task / archived / deleted / other tenant.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT array_agg(id) INTO ids FROM public.get_student_exam_list();
  r := r || format('L1 s1 rows (e1,e2,e4,eDel,eSub in order): %s | ', CASE WHEN ids = ARRAY[e1, e2, e4, eDel, eSub] THEN 'PASS' ELSE 'FAIL ' || coalesce(ids::text, 'null') END);

  -- L2: no row carries questions or an answer key.
  SELECT jsonb_agg(to_jsonb(x)) INTO j FROM public.get_student_exam_list() x;
  ok := NOT (j::text LIKE '%"questions"%' OR j::text LIKE '%correct_answer%' OR j::text LIKE '%Explain%');
  r := r || format('L2 no questions/answer key/question text: %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);

  -- L3: the facts replacing the questions.
  SELECT count(*) INTO n FROM public.get_student_exam_list() x WHERE
       (x.id = e1 AND x.question_count = 2 AND x.has_manual_questions AND x.total_points = 5)
    OR (x.id = e2 AND x.question_count = 2 AND NOT x.has_manual_questions AND x.total_points = 3)
    OR (x.id = e4 AND x.question_count = 1 AND x.has_manual_questions AND x.total_points = 5);
  r := r || format('L3 question_count / has_manual_questions / total_points: %s | ', CASE WHEN n = 3 THEN 'PASS' ELSE 'FAIL ' || n END);

  -- L4: same rows and order as the old feed (parity), when the caller may still run it.
  IF has_function_privilege('authenticated', 'public.get_student_exams()', 'EXECUTE') THEN
    SELECT count(*) INTO n FROM (
      SELECT id, row_number() OVER () AS pos FROM public.get_student_exam_list()
      EXCEPT SELECT id, row_number() OVER () FROM public.get_student_exams()) d;
    r := r || format('L4 parity with get_student_exams (rows + order): %s | ', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ' || n END);
    SELECT count(*) INTO n FROM public.get_student_exams() WHERE id = e1 AND questions::text LIKE '%Explain%';
    r := r || format('L4b old feed still hands out the not-yet-open exam''s questions (why PART B exists): %s | ', CASE WHEN n = 1 THEN 'CONFIRMED' ELSE 'not reproduced' END);
  END IF;

  -- L5: s2 sees its own individual task, not s1's course exam.
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s2, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT array_agg(id) INTO ids FROM public.get_student_exam_list();
  r := r || format('L5 s2 rows (e1,e2,e5,eDel,eSub): %s | ', CASE WHEN ids = ARRAY[e1, e2, e5, eDel, eSub] THEN 'PASS' ELSE 'FAIL ' || coalesce(ids::text, 'null') END);

  -- L6: a student of the same institution in no group/course sees nothing.
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s3, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.get_student_exam_list();
  r := r || format('L6 non-member sees 0: %s | ', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ' || n END);

  -- L7: tenant isolation — the other institution's student sees only its own exam.
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sB, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT array_agg(id) INTO ids FROM public.get_student_exam_list();
  r := r || format('L7 tenant B student sees only eB: %s | ', CASE WHEN ids = ARRAY[eB] THEN 'PASS' ELSE 'FAIL ' || coalesce(ids::text, 'null') END);

  -- L8: a teacher (no memberships) gets nothing from the student list.
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', teacherA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.get_student_exam_list();
  r := r || format('L8 teacher sees 0: %s | ', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ' || n END);
  EXECUTE 'RESET ROLE';

  -- L9: grants and configuration.
  r := r || format('L9 anon cannot execute the list: %s | ',
    CASE WHEN NOT has_function_privilege('anon', 'public.get_student_exam_list()', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END);
  r := r || format('L9b authenticated can execute the list: %s | ',
    CASE WHEN has_function_privilege('authenticated', 'public.get_student_exam_list()', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END);
  SELECT (p.proconfig::text LIKE '%search_path=public, pg_temp%') AND p.prosecdef INTO ok
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'public' AND p.proname = 'get_student_exam_list';
  r := r || format('L9c SECURITY DEFINER + pinned search_path: %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);

  -- ── start_exam_attempt (service role — what /api/exam/start calls): the
  --    review's matrix, each refused with the expected reason. Run as the
  --    owner; the function takes the student explicitly (never auth.uid()).
  got := (public.start_exam_attempt(eDel, s1, tA))->>'resumed';
  r := r || format('S0 start ok (resumed=false): %s | ', CASE WHEN got = 'false' THEN 'PASS' ELSE 'FAIL ' || coalesce(got, 'null') END);
  got := (public.start_exam_attempt(eDel, s1, tA))->>'resumed';
  r := r || format('S0b resume ok (resumed=true): %s | ', CASE WHEN got = 'true' THEN 'PASS' ELSE 'FAIL ' || coalesce(got, 'null') END);
  -- Deleted AFTER the attempt started: the resume must be refused.
  UPDATE public.exams SET deleted_at = now() WHERE id = eDel;
  BEGIN PERFORM public.start_exam_attempt(eDel, s1, tA); got := 'STARTED'; EXCEPTION WHEN raise_exception THEN got := SQLERRM; END;
  r := r || format('S1 resume of a deleted exam → EXAM_NOT_FOUND: %s | ', CASE WHEN got = 'EXAM_NOT_FOUND' THEN 'PASS' ELSE 'FAIL ' || got END);
  BEGIN PERFORM public.start_exam_attempt(e7, s1, tA); got := 'STARTED'; EXCEPTION WHEN raise_exception THEN got := SQLERRM; END;
  r := r || format('S2 fresh start of a deleted exam → EXAM_NOT_FOUND: %s | ', CASE WHEN got = 'EXAM_NOT_FOUND' THEN 'PASS' ELSE 'FAIL ' || got END);
  BEGIN PERFORM public.start_exam_attempt(e3, s1, tA); got := 'STARTED'; EXCEPTION WHEN raise_exception THEN got := SQLERRM; END;
  r := r || format('S3 unpublished → EXAM_NOT_FOUND: %s | ', CASE WHEN got = 'EXAM_NOT_FOUND' THEN 'PASS' ELSE 'FAIL ' || got END);
  BEGIN PERFORM public.start_exam_attempt(e1, s1, tA); got := 'STARTED'; EXCEPTION WHEN raise_exception THEN got := SQLERRM; END;
  r := r || format('S4 before starts_at → EXAM_NOT_OPEN: %s | ', CASE WHEN got = 'EXAM_NOT_OPEN' THEN 'PASS' ELSE 'FAIL ' || got END);
  BEGIN PERFORM public.start_exam_attempt(eB, s1, tA); got := 'STARTED'; EXCEPTION WHEN raise_exception THEN got := SQLERRM; END;
  r := r || format('S5 other institution → TENANT_MISMATCH: %s | ', CASE WHEN got = 'TENANT_MISMATCH' THEN 'PASS' ELSE 'FAIL ' || got END);
  BEGIN PERFORM public.start_exam_attempt(eB, s1, tB); got := 'STARTED'; EXCEPTION WHEN raise_exception THEN got := SQLERRM; END;
  r := r || format('S5b other institution, forged tenant → TENANT_MISMATCH: %s | ', CASE WHEN got = 'TENANT_MISMATCH' THEN 'PASS' ELSE 'FAIL ' || got END);
  BEGIN PERFORM public.start_exam_attempt(eG, s1, tA); got := 'STARTED'; EXCEPTION WHEN raise_exception THEN got := SQLERRM; END;
  r := r || format('S6 other group → NOT_ENROLLED: %s | ', CASE WHEN got = 'NOT_ENROLLED' THEN 'PASS' ELSE 'FAIL ' || got END);
  BEGIN PERFORM public.start_exam_attempt(e5, s1, tA); got := 'STARTED'; EXCEPTION WHEN raise_exception THEN got := SQLERRM; END;
  r := r || format('S7 classmate individual task → NOT_ENROLLED: %s | ', CASE WHEN got = 'NOT_ENROLLED' THEN 'PASS' ELSE 'FAIL ' || got END);
  BEGIN PERFORM public.start_exam_attempt(e2, s3, tA); got := 'STARTED'; EXCEPTION WHEN raise_exception THEN got := SQLERRM; END;
  r := r || format('S7b non-member student → NOT_ENROLLED: %s | ', CASE WHEN got = 'NOT_ENROLLED' THEN 'PASS' ELSE 'FAIL ' || got END);
  INSERT INTO public.exam_submissions (exam_id, student_id, tenant_id, answers, proctoring_events, status, started_at)
    VALUES (eSub, s1, tA, '{}', '[]', 'submitted', now());
  BEGIN PERFORM public.start_exam_attempt(eSub, s1, tA); got := 'STARTED'; EXCEPTION WHEN raise_exception THEN got := SQLERRM; END;
  r := r || format('S8 after submit → ALREADY_SUBMITTED: %s | ', CASE WHEN got = 'ALREADY_SUBMITTED' THEN 'PASS' ELSE 'FAIL ' || got END);
  -- The deleted exam also left the student's list.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.get_student_exam_list() WHERE id = eDel;
  EXECUTE 'RESET ROLE';
  r := r || format('S9 deleted exam gone from the list: %s | ', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END);

  -- L10: PART B state.
  r := r || format('L10 PART B (old feed revoked from students): %s',
    CASE WHEN has_function_privilege('authenticated', 'public.get_student_exams()', 'EXECUTE') THEN 'not applied'
         WHEN has_function_privilege('service_role', 'public.get_student_exams()', 'EXECUTE') THEN 'APPLIED (service_role keeps it)'
         ELSE 'FAIL (service_role lost it too)' END);

  RAISE EXCEPTION 'RESULT: %', r;
END $$;

-- Afterwards (expect 0 / 0 — everything above was rolled back):
SELECT (SELECT count(*) FROM auth.users WHERE email LIKE '%@check.invalid') AS leftover_auth,
       (SELECT count(*) FROM public.tenants WHERE code IN ('ZZA1', 'ZZB1')) AS leftover_tenants;
