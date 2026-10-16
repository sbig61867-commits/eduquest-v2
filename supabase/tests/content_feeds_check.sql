-- HISTORICAL (2026-10-16). Kept for the record linked from CLAUDE.md and
-- PERFORMANCE_BASELINE.md; do not use as a regression check. Its BEFORE section
-- calls get_admin_lessons() / get_admin_exams() as authenticated, which
-- function_execute_cleanup_migration.sql made owner-only — it now stops with
-- 42501. The live feeds are covered by scale_baseline_check.sql block B.
--
-- Batch 3 — P-02 + P-04 regression / measurement check for supabase/content_feeds_migration.sql.
--
-- Run where the functions exist (after applying), or as a DRY RUN: the migration's statements executed
-- inside this same DO block (see the dry-run note in PERFORMANCE_BASELINE.md), so the RAISE EXCEPTION at the
-- end rolls back the functions too.
--
-- Synthetic, fully rolled back: institution A — admin, centre manager, teacher T (100 exams × 40 questions),
-- teacher U, a student; 2 000 lessons (1 400 published), 2 000 exams: 1 500 timed exams (incl. 100 with
-- 500 homework (450 type 'homework' + 50 type 'exam' with duration 0 — homework by the page's duration rule;
-- exams.type is NOT NULL); 4 000 submissions.
-- Institution B — an admin, 10 lessons, 10 exams. Reads run AS THE REAL ROLE through RLS.
-- DIAGNOSTIC: sizes scale with rows, times do not — never extrapolate times.

DO $chk$
DECLARE
  tA uuid := gen_random_uuid(); tB uuid := gen_random_uuid();
  adminA uuid; adminB uuid; managerA uuid; teacherT uuid; teacherU uuid; studentA uuid; gA uuid; gB uuid;
  t0 timestamptz; r text := ''; c bigint; sz bigint; n bigint; ok boolean; qs jsonb;
  rec record;
BEGIN
  SET LOCAL statement_timeout = '118s';
  INSERT INTO public.tenants (id, name, slug, code) VALUES
    (tA, 'CF A (rolled back)', 'cf-a-' || substr(tA::text, 1, 8), 'ZZC1'), (tB, 'CF B (rolled back)', 'cf-b-' || substr(tB::text, 1, 8), 'ZZC2');
  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT gen_random_uuid() AS id, g AS k FROM generate_series(1, 7) g;
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cf' || k || '@scale.invalid', '{}', '{}', now(), now() FROM _ids;
  UPDATE public.users u SET
    tenant_id = CASE WHEN k = 7 THEN tB ELSE tA END,
    role = CASE k WHEN 1 THEN 'university_admin' WHEN 2 THEN 'center_manager' WHEN 3 THEN 'teacher' WHEN 4 THEN 'teacher'
                  WHEN 5 THEN 'student' WHEN 6 THEN 'student' ELSE 'university_admin' END,
    full_name = 'Person ' || k, is_active = true
  FROM _ids WHERE u.id = _ids.id;
  SELECT id INTO adminA FROM _ids WHERE k = 1; SELECT id INTO managerA FROM _ids WHERE k = 2;
  SELECT id INTO teacherT FROM _ids WHERE k = 3; SELECT id INTO teacherU FROM _ids WHERE k = 4;
  SELECT id INTO studentA FROM _ids WHERE k = 5; SELECT id INTO adminB FROM _ids WHERE k = 7;
  INSERT INTO public.groups (id, tenant_id, teacher_id, name) VALUES (gen_random_uuid(), tA, teacherU, 'GA') RETURNING id INTO gA;
  INSERT INTO public.groups (id, tenant_id, teacher_id, name) VALUES (gen_random_uuid(), tB, adminB, 'GB') RETURNING id INTO gB;

  SELECT jsonb_agg(jsonb_build_object('id', i::text, 'type', 'mcq', 'text', 'Question number ' || i || ' — ' || repeat('lorem ipsum ', 12),
         'options', jsonb_build_array('Option A text', 'Option B text', 'Option C text', 'Option D text'),
         'correct_answer', 'Option A text', 'points', 2)) INTO qs FROM generate_series(1, 40) i;

  INSERT INTO public.lessons (tenant_id, group_id, teacher_id, title, content, is_published, created_at)
    SELECT tA, gA, teacherU, 'Lesson ' || i, repeat('body ', 200), i % 10 < 7, now() - (i || ' seconds')::interval FROM generate_series(1, 2000) i;
  INSERT INTO public.lessons (tenant_id, group_id, teacher_id, title, content, is_published)
    SELECT tB, gB, adminB, 'B lesson ' || i, 'b', true FROM generate_series(1, 10) i;
  -- 1..100 teacher T (timed), 101..1400 teacher U timed, 1401..1850 homework,
  -- 1851..1900 type 'exam' + duration 0 (= homework by the page's rule), 1901..2000 timed again.
  INSERT INTO public.exams (tenant_id, group_id, teacher_id, title, questions, type, duration_minutes, is_published, proctoring_enabled, created_at)
    SELECT tA, gA, CASE WHEN i <= 100 THEN teacherT ELSE teacherU END, 'Exam ' || i, qs,
           CASE WHEN i BETWEEN 1401 AND 1850 THEN 'homework' ELSE 'exam' END,
           CASE WHEN i BETWEEN 1851 AND 1900 THEN 0 WHEN i BETWEEN 1401 AND 1850 THEN 43200 ELSE 60 END,
           i % 2 = 0, i % 3 = 0, now() - (i || ' seconds')::interval
    FROM generate_series(1, 2000) i;
  INSERT INTO public.exams (tenant_id, group_id, teacher_id, title, questions, type, duration_minutes)
    SELECT tB, gB, adminB, 'B exam ' || i, qs, 'exam', 60 FROM generate_series(1, 10) i;
  INSERT INTO public.exam_submissions (exam_id, student_id, tenant_id, score, max_score, status, submitted_at)
    SELECT e.id, s.id, tA, 1, 80, 'submitted', now() FROM public.exams e
    CROSS JOIN (SELECT id FROM _ids WHERE k IN (5, 6)) s WHERE e.tenant_id = tA;
  ANALYZE public.lessons; ANALYZE public.exams; ANALYZE public.exam_submissions;

  -- ── P-02 as admin A ──────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adminA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  t0 := clock_timestamp();
  SELECT octet_length(coalesce(json_agg(x)::text, '')) INTO sz FROM public.get_admin_lessons() x;
  SELECT octet_length(coalesce(json_agg(x)::text, '')) + sz INTO sz FROM public.get_admin_exams() x;
  r := r || format('BEFORE dashboard: get_admin_lessons + get_admin_exams = %s KB, %s ms | ', sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  t0 := clock_timestamp();
  SELECT octet_length(coalesce(json_agg(x)::text, '')) INTO sz FROM public.get_admin_content_counts() x;
  SELECT octet_length(coalesce(json_agg(x)::text, '')) + sz INTO sz FROM public.get_admin_lessons_page(5, 0) x;
  r := r || format('AFTER dashboard: counts + 5 lessons = %s B, %s ms | ', sz, round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM public.get_admin_exams() x;
  r := r || format('BEFORE /admin/exams: %s rows %s KB %s ms | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT * FROM public.get_admin_exams_page(false, 50, 0) UNION ALL SELECT * FROM public.get_admin_exams_page(true, 50, 0)) x;
  r := r || format('AFTER /admin/exams: %s rows %s KB %s ms | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- Correctness: the counts and pages equal what the old feeds + the page's JS rules produce.
  SELECT (c.lessons, c.published_lessons, c.exams, c.homework, c.submissions) = (
           (SELECT count(*) FROM public.get_admin_lessons()),
           (SELECT count(*) FROM public.get_admin_lessons() l WHERE l.is_published),
           (SELECT count(*) FROM public.get_admin_exams() e WHERE NOT (e.type IS NOT DISTINCT FROM 'homework' OR COALESCE(e.duration_minutes, 0) <= 0 OR e.duration_minutes >= 43200)),
           (SELECT count(*) FROM public.get_admin_exams() e WHERE (e.type IS NOT DISTINCT FROM 'homework' OR COALESCE(e.duration_minutes, 0) <= 0 OR e.duration_minutes >= 43200)),
           (SELECT sum(submission_count) FROM public.get_admin_exams()))
    INTO ok FROM public.get_admin_content_counts() c;
  r := r || format('C1 counts = old feeds + isHomework (2000/1400/1500/500/4000): %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  SELECT count(*) = 0 INTO ok FROM (
    SELECT id FROM (SELECT id, row_number() OVER () rn FROM public.get_admin_lessons()) a WHERE rn <= 50
    EXCEPT SELECT id FROM public.get_admin_lessons_page(50, 0)) d;
  r := r || format('C2 lessons page 1 = the first 50 of the old feed: %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  SELECT count(DISTINCT id) = 1500 INTO ok FROM (SELECT id FROM generate_series(0, 29) p, LATERAL public.get_admin_exams_page(false, 50, p * 50)) x;
  r := r || format('C3 30 exam pages cover the 1 500 exams exactly once: %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  SELECT count(*) = 50 INTO ok FROM public.get_admin_exams_page(true, 100, 450);
  r := r || format('C4 homework incl. type exam + duration 0 (500 = 450 + 50): %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  SELECT (SELECT count(*) FROM public.get_admin_lessons_page(1000, 0)) = 100 AND (SELECT count(*) FROM public.get_admin_lessons_page(0, -5)) = 1 INTO ok;
  r := r || format('C5 limit clamped to 1..100, offset ≥ 0: %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  SELECT NOT EXISTS (SELECT 1 FROM public.get_admin_lessons_page(100, 0) WHERE title LIKE 'B lesson%')
     AND NOT EXISTS (SELECT 1 FROM public.get_admin_exams_page(false, 100, 0) WHERE title LIKE 'B exam%') INTO ok;
  r := r || format('I1 admin A sees nothing of B: %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', adminB, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT (c.lessons, c.exams) = (10::bigint, 10::bigint) INTO ok FROM public.get_admin_content_counts() c;
  r := r || format('I2 admin B counts only B (10 / 10): %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  EXECUTE 'RESET ROLE';

  -- Every non-admin role: no rows at all (the existing feeds' guard).
  FOR rec IN SELECT * FROM (VALUES ('center_manager', managerA), ('teacher', teacherT), ('student', studentA)) v(role_name, uid) LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', rec.uid, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT (SELECT count(*) FROM public.get_admin_content_counts()) + (SELECT count(*) FROM public.get_admin_lessons_page(100, 0))
         + (SELECT count(*) FROM public.get_admin_exams_page(false, 100, 0)) + (SELECT count(*) FROM public.get_admin_exams_page(true, 100, 0)) INTO n;
    r := r || format('A %s: %s rows (expect 0): %s | ', rec.role_name, n, CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END);
    EXECUTE 'RESET ROLE';
  END LOOP;

  -- ── P-04 as teacher T ────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', teacherT, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT e.*, json_build_object('name', g.name) AS groups FROM public.exams e LEFT JOIN public.groups g ON g.id = e.group_id
    WHERE e.teacher_id = teacherT AND e.deleted_at IS NULL ORDER BY e.created_at DESC) x;
  r := r || format('BEFORE /teacher/exams: %s rows %s KB %s ms | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT e.id, e.title, e.duration_minutes, e.is_published, e.proctoring_enabled, e.created_at, e.type, e.ends_at, e.assigned_student_id,
           public.question_count(e) AS question_count, json_build_object('name', g.name) AS groups
    FROM public.exams e LEFT JOIN public.groups g ON g.id = e.group_id
    WHERE e.teacher_id = teacherT AND e.deleted_at IS NULL ORDER BY e.created_at DESC) x;
  r := r || format('AFTER /teacher/exams: %s rows %s KB %s ms | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  SELECT bool_and(public.question_count(e) = jsonb_array_length(e.questions)) AND count(*) = 100 INTO ok FROM public.exams e WHERE e.teacher_id = teacherT;
  r := r || format('Q1 question_count = number of questions (100 exams): %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', studentA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.exams e WHERE public.question_count(e) > 0;
  r := r || format('Q2 question_count adds no read path (a student still reads 0 exam rows): %s | ', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ' || n END);
  EXECUTE 'RESET ROLE';

  -- ── Grants and definitions ───────────────────────────────────────────────
  SELECT bool_and(NOT has_function_privilege('anon', f, 'EXECUTE') AND has_function_privilege('authenticated', f, 'EXECUTE')) INTO ok
    FROM unnest(ARRAY['public.get_admin_content_counts()', 'public.get_admin_lessons_page(integer,integer)',
                      'public.get_admin_exams_page(boolean,integer,integer)', 'public.question_count(public.exams)']::regprocedure[]) f;
  r := r || format('G1 anon no EXECUTE, authenticated EXECUTE (4 functions): %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  SELECT bool_and(p.proconfig @> ARRAY['search_path=public, pg_temp']) INTO ok FROM pg_proc p
    WHERE p.oid IN ('public.get_admin_content_counts()'::regprocedure, 'public.get_admin_lessons_page(integer,integer)'::regprocedure,
                    'public.get_admin_exams_page(boolean,integer,integer)'::regprocedure, 'public.question_count(public.exams)'::regprocedure);
  r := r || format('G2 search_path pinned (4 functions): %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  SELECT (SELECT bool_and(prosecdef) FROM pg_proc WHERE oid IN ('public.get_admin_content_counts()'::regprocedure,
            'public.get_admin_lessons_page(integer,integer)'::regprocedure, 'public.get_admin_exams_page(boolean,integer,integer)'::regprocedure))
     AND NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.question_count(public.exams)'::regprocedure) INTO ok;
  r := r || format('G3 admin feeds DEFINER, question_count INVOKER: %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  SELECT NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE a.grantee = 0 AND p.oid IN (
           'public.get_admin_content_counts()'::regprocedure, 'public.get_admin_lessons_page(integer,integer)'::regprocedure,
           'public.get_admin_exams_page(boolean,integer,integer)'::regprocedure, 'public.question_count(public.exams)'::regprocedure)) INTO ok;
  r := r || format('G4 no EXECUTE granted to PUBLIC: %s', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);

  RAISE EXCEPTION 'RESULT: %', r;
END $chk$;

-- Afterwards (expect 0 / 0):
SELECT (SELECT count(*) FROM auth.users WHERE email LIKE 'cf%@scale.invalid') AS leftover_auth,
       (SELECT count(*) FROM public.tenants WHERE code IN ('ZZC1', 'ZZC2')) AS leftover_tenants;
