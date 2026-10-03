-- P-08 — regression / measurement check for supabase/notifications_feed_migration.sql (get_my_notifications()).
--
-- Run where the function exists (after applying), or as a DRY RUN: in one transaction, the migration's
-- statements first, then this block — the RAISE EXCEPTION at the end aborts the transaction, so the function
-- and every synthetic row go with it.
--
-- Synthetic (the P-08 inventory dataset): institution A — teacher T with 4 groups × 40 students, 50 exams per
-- group (200, 20 questions each), 30 lessons per group, every student submitted every exam of their group (8 000
-- submissions); student S is in groups 1 and 2; a university admin, a centre manager; 2 AI alerts. Institution B —
-- teacher U with 1 group of 5, 5 exams, 25 submissions, lessons, 1 alert. A super_admin; 50 contact messages.
-- Every read runs AS THE ROLE, through RLS. "Old" = the per-table reads /api/notifications ran before P-08.
-- DIAGNOSTIC: times are the database's only, averaged over 5 runs; never extrapolate them.

DO $chk$
DECLARE
  tA uuid := gen_random_uuid(); tB uuid := gen_random_uuid();
  teacherT uuid := gen_random_uuid(); teacherU uuid := gen_random_uuid(); adminA uuid := gen_random_uuid();
  managerA uuid := gen_random_uuid(); owner uuid := gen_random_uuid(); studentS uuid; studentB uuid;
  r text := ''; ok boolean; f jsonb; old jsonb; t0 timestamptz; i int; tot numeric; sz bigint; gids uuid[]; eids uuid[];
BEGIN
  SET LOCAL statement_timeout = '118s';
  EXECUTE 'SET LOCAL session_replication_role = replica';
  CREATE TEMP TABLE _g ON COMMIT DROP AS SELECT n, gen_random_uuid() id, CASE WHEN n = 5 THEN 'B' ELSE 'A' END inst FROM generate_series(1, 5) n;
  CREATE TEMP TABLE _st ON COMMIT DROP AS
    SELECT g.n gn, g.id gid, g.inst, s, gen_random_uuid() id FROM _g g, generate_series(1, 40) s WHERE g.inst = 'A' OR s <= 5;
  CREATE TEMP TABLE _ex ON COMMIT DROP AS
    SELECT gen_random_uuid() id, g.id gid, g.n gn, g.inst, k FROM _g g, generate_series(1, 50) k WHERE g.inst = 'A' OR k <= 5;

  INSERT INTO public.tenants (id, name, slug, code) VALUES
    (tA, 'P08 A (rolled back)', 'p08-a-' || substr(tA::text, 1, 8), 'ZZN1'), (tB, 'P08 B (rolled back)', 'p08-b-' || substr(tB::text, 1, 8), 'ZZN2');
  INSERT INTO public.users (id, email, full_name, role, tenant_id, is_active, member_code) VALUES
    (teacherT, 'p08t@x.invalid', 'Teacher T', 'teacher', tA, true, 'ZZN-T'),
    (teacherU, 'p08u@x.invalid', 'Teacher U', 'teacher', tB, true, 'ZZN-U'),
    (adminA, 'p08a@x.invalid', 'Admin A', 'university_admin', tA, true, 'ZZN-A'),
    (managerA, 'p08m@x.invalid', 'Centre A', 'center_manager', tA, true, 'ZZN-M'),
    (owner, 'p08o@x.invalid', 'Owner', 'super_admin', NULL, true, 'ZZN-O');
  INSERT INTO public.users (id, email, full_name, role, tenant_id, is_active, member_code, created_at)
    SELECT st.id, 'p08s' || st.gn || '.' || st.s || '@x.invalid', 'Student ' || st.gn || '-' || st.s, 'student',
           CASE st.inst WHEN 'A' THEN tA ELSE tB END, true, 'ZZN-S' || st.gn || '-' || st.s, now() - (st.gn * 100 + st.s || ' minutes')::interval
    FROM _st st;
  SELECT id INTO studentS FROM _st WHERE gn = 1 AND s = 1;
  SELECT id INTO studentB FROM _st WHERE gn = 5 AND s = 1;
  INSERT INTO public.groups (id, tenant_id, teacher_id, name, is_active)
    SELECT g.id, CASE g.inst WHEN 'A' THEN tA ELSE tB END, CASE g.inst WHEN 'A' THEN teacherT ELSE teacherU END, 'Group ' || g.n, true FROM _g g;
  INSERT INTO public.group_students (group_id, student_id) SELECT gid, id FROM _st;
  INSERT INTO public.group_students (group_id, student_id) SELECT (SELECT id FROM _g WHERE n = 2), studentS;
  INSERT INTO public.lessons (id, tenant_id, group_id, teacher_id, title, is_published, deleted_at, created_at)
    SELECT gen_random_uuid(), CASE g.inst WHEN 'A' THEN tA ELSE tB END, g.id, CASE g.inst WHEN 'A' THEN teacherT ELSE teacherU END,
           'Lesson ' || g.n || '-' || k, k % 7 <> 0, CASE WHEN k % 11 = 0 THEN now() END, now() - (k || ' days')::interval - (g.n || ' minutes')::interval
    FROM _g g, generate_series(1, 30) k;
  INSERT INTO public.exams (id, tenant_id, teacher_id, title, type, group_id, is_published, duration_minutes, questions, created_at)
    SELECT ex.id, CASE ex.inst WHEN 'A' THEN tA ELSE tB END, CASE ex.inst WHEN 'A' THEN teacherT ELSE teacherU END,
           'Exam ' || ex.gn || '-' || ex.k, CASE WHEN ex.k % 4 = 0 THEN 'homework' ELSE 'exam' END, ex.gid, true, 60,
           (SELECT jsonb_agg(jsonb_build_object('id', 'q' || q, 'type', CASE WHEN ex.k % 5 = 0 AND q = 1 THEN 'essay' ELSE 'mcq' END,
                   'text', repeat('Question text ', 6), 'options', jsonb_build_array('a', 'b', 'c', 'd'), 'correct_answer', 'a', 'points', 5))
            FROM generate_series(1, 20) q),
           now() - ((200 - ex.k * 3) || ' days')::interval - (ex.gn || ' minutes')::interval
    FROM _ex ex;
  INSERT INTO public.exam_submissions (exam_id, student_id, tenant_id, status, score, max_score, grading_status, is_graded, submitted_at)
    SELECT ex.id, st.id, CASE ex.inst WHEN 'A' THEN tA ELSE tB END, 'submitted',
           CASE WHEN (st.s + ex.k) % 9 = 0 THEN NULL ELSE 40 + ((st.s * 7 + ex.k) % 60) END, 100,
           (ARRAY['published', 'pending', 'reviewing'])[1 + (st.s + ex.k) % 3], true,
           now() - ((198 - ex.k * 3) || ' days')::interval + (st.s || ' minutes')::interval + (ex.gn || ' seconds')::interval
    FROM _ex ex JOIN _st st ON st.gid = ex.gid;
  INSERT INTO public.contact_messages (name, email, message, created_at)
    SELECT 'Visitor ' || m, 'v' || m || '@x.invalid', repeat('Message text. ', 20), now() - (m || ' hours')::interval FROM generate_series(1, 50) m;
  INSERT INTO public.ai_usage_alerts (tenant_id, month, metric, level, used, limit_value, created_at) VALUES
    (tA, date_trunc('month', now())::date, 'requests', 'warning', 80, 100, now() - interval '3 hours'),
    (tA, date_trunc('month', now())::date, 'tokens', 'exceeded', 120, 100, now() - interval '2 hours'),
    (tB, date_trunc('month', now())::date, 'requests', 'warning', 80, 100, now() - interval '1 hour');
  EXECUTE 'SET LOCAL session_replication_role = origin';
  ANALYZE public.exam_submissions; ANALYZE public.exams; ANALYZE public.lessons; ANALYZE public.group_students; ANALYZE public.users;

  -- ── Student S (institution A, groups 1 + 2) ──────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', studentS, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  f := public.get_my_notifications();
  SELECT array_agg(group_id) INTO gids FROM public.group_students WHERE student_id = studentS;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'created_at', x.created_at, 'group_name', x.name)), '[]') INTO old FROM (
    SELECT l.id, l.title, l.created_at, g.name FROM public.lessons l LEFT JOIN public.groups g ON g.id = l.group_id
    WHERE l.group_id = ANY(gids) AND l.is_published AND l.deleted_at IS NULL ORDER BY l.created_at DESC LIMIT 8) x;
  ok := f->'lessons' = old;
  r := r || format('E1 student lessons = old read (%s): %s | ', jsonb_array_length(f->'lessons'), CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'created_at', x.created_at)), '[]') INTO old FROM (
    SELECT id, title, created_at FROM public.get_student_exam_list() LIMIT 8) x;
  ok := f->'exams' = old;
  r := r || format('E2 student exams = first 8 of get_student_exam_list (%s): %s | ', jsonb_array_length(f->'exams'), CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'exam_id', x.exam_id, 'score', x.score, 'max_score', x.max_score,
           'submitted_at', x.submitted_at, 'grading_status', x.grading_status, 'exam_listed', x.lid IS NOT NULL, 'exam_title', x.title,
           'exam_type', x.type, 'exam_has_manual_questions', x.has_manual_questions)), '[]') INTO old FROM (
    SELECT s.id, s.exam_id, s.score, s.max_score, s.submitted_at, s.grading_status, l.id lid, l.title, l.type, l.has_manual_questions
    FROM (SELECT * FROM public.exam_submissions WHERE student_id = studentS AND score IS NOT NULL ORDER BY submitted_at DESC LIMIT 20) s
    LEFT JOIN public.get_student_exam_list() l ON l.id = s.exam_id ORDER BY s.submitted_at DESC) x;
  ok := f->'grades' = old;
  r := r || format('E3 student grades = old reads + the list''s type / manual flag (%s, %s manual): %s | ', jsonb_array_length(f->'grades'),
       (SELECT count(*) FROM jsonb_array_elements(f->'grades') e WHERE (e->>'exam_has_manual_questions')::boolean), CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  ok := f ?& ARRAY['lessons', 'exams', 'grades'] AND NOT f ?| ARRAY['submissions', 'users', 'messages', 'tenants', 'ai_alerts'];
  r := r || format('E4 student gets only the student sections: %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  tot := 0; FOR i IN 1..5 LOOP t0 := clock_timestamp(); f := public.get_my_notifications(); tot := tot + extract(epoch FROM clock_timestamp() - t0) * 1000; END LOOP;
  r := r || format('M student: 1 query, %s B, %s ms | ', octet_length(f::text), round(tot / 5, 2));
  EXECUTE 'RESET ROLE';

  -- ── Teacher T (institution A) ────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', teacherT, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  f := public.get_my_notifications();
  SELECT array_agg(id) INTO eids FROM public.exams WHERE teacher_id = teacherT AND deleted_at IS NULL;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'exam_id', x.exam_id, 'submitted_at', x.submitted_at, 'student_name', x.full_name,
           'exam_title', x.title, 'exam_type', x.type)), '[]') INTO old FROM (
    SELECT s.id, s.exam_id, s.submitted_at, u.full_name, e.title, e.type
    FROM (SELECT * FROM public.exam_submissions WHERE exam_id = ANY(eids) ORDER BY submitted_at DESC LIMIT 15) s
    LEFT JOIN public.users u ON u.id = s.student_id JOIN public.exams e ON e.id = s.exam_id ORDER BY s.submitted_at DESC) x;
  ok := f->'submissions' = old;
  r := r || format('E5 teacher submissions = old reads, no id list (%s of %s exams): %s | ', jsonb_array_length(f->'submissions'), array_length(eids, 1), CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  ok := NOT EXISTS (SELECT 1 FROM jsonb_array_elements(f->'submissions') e JOIN public.exams x ON x.id = (e->>'exam_id')::uuid WHERE x.teacher_id <> teacherT);
  r := r || format('I1 teacher sees only own exams'' submissions: %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  tot := 0; FOR i IN 1..5 LOOP t0 := clock_timestamp(); f := public.get_my_notifications(); tot := tot + extract(epoch FROM clock_timestamp() - t0) * 1000; END LOOP;
  r := r || format('M teacher: 1 query, %s B, %s ms | ', octet_length(f::text), round(tot / 5, 2));
  EXECUTE 'RESET ROLE';

  -- ── University admin A ───────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adminA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  f := public.get_my_notifications();
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'full_name', x.full_name, 'role', x.role, 'created_at', x.created_at)), '[]') INTO old FROM (
    SELECT id, full_name, role, created_at FROM public.users WHERE tenant_id = tA AND role IN ('teacher', 'student') ORDER BY created_at DESC LIMIT 15) x;
  ok := f->'users' = old;
  r := r || format('E6 admin users = old read (%s): %s | ', jsonb_array_length(f->'users'), CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  ok := (SELECT bool_and((e->>'id')::uuid IN (SELECT id FROM public.ai_usage_alerts WHERE tenant_id = tA)) FROM jsonb_array_elements(f->'ai_alerts') e)
        AND jsonb_array_length(f->'ai_alerts') = 2
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(f->'users') e JOIN public.users u ON u.id = (e->>'id')::uuid WHERE u.tenant_id <> tA);
  r := r || format('I2 admin A: own institution''s users and alerts only (2 alerts): %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  tot := 0; FOR i IN 1..5 LOOP t0 := clock_timestamp(); f := public.get_my_notifications(); tot := tot + extract(epoch FROM clock_timestamp() - t0) * 1000; END LOOP;
  r := r || format('M admin: 1 query, %s B, %s ms | ', octet_length(f::text), round(tot / 5, 2));
  EXECUTE 'RESET ROLE';

  -- ── super_admin ──────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  f := public.get_my_notifications();
  SELECT COALESCE(jsonb_agg(x.id), '[]') INTO old FROM (SELECT id FROM public.contact_messages ORDER BY created_at DESC LIMIT 10) x;
  ok := (SELECT jsonb_agg(e->'id') FROM jsonb_array_elements(f->'messages') e) = old;
  SELECT COALESCE(jsonb_agg(x.id), '[]') INTO old FROM (SELECT id FROM public.tenants ORDER BY created_at DESC LIMIT 8) x;
  ok := ok AND (SELECT jsonb_agg(e->'id') FROM jsonb_array_elements(f->'tenants') e) = old;
  SELECT COALESCE(jsonb_agg(x.id), '[]') INTO old FROM (SELECT id FROM public.ai_usage_alerts ORDER BY created_at DESC LIMIT 6) x;
  ok := ok AND (SELECT jsonb_agg(e->'id') FROM jsonb_array_elements(f->'ai_alerts') e) = old;
  r := r || format('E7 owner messages / institutions / alerts = old reads (%s / %s / %s): %s | ', jsonb_array_length(f->'messages'),
       jsonb_array_length(f->'tenants'), jsonb_array_length(f->'ai_alerts'), CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  tot := 0; FOR i IN 1..5 LOOP t0 := clock_timestamp(); f := public.get_my_notifications(); tot := tot + extract(epoch FROM clock_timestamp() - t0) * 1000; END LOOP;
  r := r || format('M owner: 1 query, %s B, %s ms | ', octet_length(f::text), round(tot / 5, 2));
  EXECUTE 'RESET ROLE';

  -- ── Centre manager A, student B ──────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', managerA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  f := public.get_my_notifications();
  r := r || format('E8 centre manager: {} (%s): %s | ', f, CASE WHEN f = '{}'::jsonb THEN 'PASS' ELSE 'FAIL' END);
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', studentB, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  f := public.get_my_notifications();
  ok := NOT EXISTS (SELECT 1 FROM jsonb_array_elements(f->'lessons') e JOIN public.lessons l ON l.id = (e->>'id')::uuid WHERE l.tenant_id <> tB)
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(f->'grades') e WHERE (e->>'id')::uuid NOT IN (SELECT id FROM public.exam_submissions WHERE student_id = studentB))
        AND jsonb_array_length(f->'lessons') > 0 AND jsonb_array_length(f->'grades') > 0;
  r := r || format('I3 student B: own institution''s lessons and own grades only: %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  EXECUTE 'RESET ROLE';

  -- ── Signed out, grants, settings ─────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  f := public.get_my_notifications();
  r := r || format('I4 no session: {}: %s | ', CASE WHEN f = '{}'::jsonb THEN 'PASS' ELSE 'FAIL' END);
  EXECUTE 'RESET ROLE';
  ok := NOT has_function_privilege('anon', 'public.get_my_notifications()', 'EXECUTE')
        AND has_function_privilege('authenticated', 'public.get_my_notifications()', 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = 'public.get_my_notifications()'::regprocedure AND a.grantee = 0);
  r := r || format('G1 EXECUTE: authenticated only (not anon, not PUBLIC): %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  SELECT NOT prosecdef AND provolatile = 's' AND proconfig @> ARRAY['search_path=public, pg_temp'] INTO ok FROM pg_proc WHERE oid = 'public.get_my_notifications()'::regprocedure;
  r := r || format('G2 SECURITY INVOKER, STABLE, search_path pinned: %s', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);

  RAISE EXCEPTION 'RESULT: %', r;
END $chk$;

-- Afterwards (expect 0 / 0 / 0):
SELECT (SELECT count(*) FROM public.tenants WHERE code IN ('ZZN1', 'ZZN2')) AS leftover_tenants,
       (SELECT count(*) FROM public.users WHERE member_code LIKE 'ZZN-%') AS leftover_users,
       (SELECT count(*) FROM pg_proc WHERE proname = 'get_my_notifications') AS function_if_dry_run;
