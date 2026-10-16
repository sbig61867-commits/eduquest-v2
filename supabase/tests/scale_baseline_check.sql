-- Scale baseline — Performance Contract (PERFORMANCE_CONTRACT.md, PERFORMANCE_BASELINE.md).
--
-- Builds a throw-away institution inside a transaction, runs the exact reads the
-- panels run (through RLS, as the real role), measures result size and time,
-- and ends with RAISE EXCEPTION: the result is the error message and EVERYTHING
-- is rolled back (auth.users, public.users, tenant, groups, exams, lessons,
-- submissions). Nothing is left behind; verify with the count at the bottom.
--
-- Run each block on its own (Supabase SQL Editor or MCP execute_sql). Each
-- stays under the 2-minute statement timeout on the Free plan.
--
-- DIAGNOSTIC, NOT A BENCHMARK: sizes grow linearly with row count, times do
-- not (cache, plan, concurrency). Do not extrapolate times.
--
-- Captured 2026-09-30 (Batch 0, before any fix):
--   A) 20 000 students
--      [admin/students] rows=20000 json=6423 KB time=160 ms
--      [nameCompleteFlags] rows=20000 json=1386 KB time=57 ms
--      [dashboard count] 13 ms
--      [teacher/groups tenantStudents] rows=20000 json=2380 KB time=92 ms
--      (50 000 was attempted and timed out in setup: the member-code trigger
--       checks uniqueness per row — a setup limit, not an app finding.)
--   B) 2 000 exams (50 published to the student's group, 40 questions each),
--      2 000 lessons, 40 000 submissions
--      [get_student_exams] rows=50 json=1718 KB (without questions 30 KB) time=58 ms
--      [get_admin_exams] rows=2000 json=537 KB time=129 ms
--      [get_admin_lessons] rows=2000 json=375 KB time=99 ms
--
-- 2026-10-16: block B now measures the feeds the app calls today. The old
-- unbounded get_student_exams / get_admin_exams / get_admin_lessons above are
-- owner-only since function_execute_cleanup_migration.sql, so calling them as
-- authenticated raised 42501 (the block had already failed since 2026-09-30,
-- when get_student_exams was revoked from students). Expect one page (<= 50
-- rows) from each _page feed, and a list payload independent of question count.

-- ── A) Large lists: 20 000 students ─────────────────────────────────────────
DO $$
DECLARE
  v_t uuid := gen_random_uuid(); v_admin uuid; v_teacher uuid; t0 timestamptz; r text := ''; c bigint; sz bigint;
BEGIN
  SET LOCAL statement_timeout = '118s';
  t0 := clock_timestamp();
  INSERT INTO public.tenants (id, name, slug, code) VALUES (v_t, 'SCALE TEST (rolled back)', 'scale-test-rb-' || substr(v_t::text,1,8), 'ZZT9');
  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT gen_random_uuid() AS id, i FROM generate_series(1, 20002) i;
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'st' || i || '@scale.invalid', '{}'::jsonb, '{}'::jsonb, now(), now() FROM _ids;
  UPDATE public.users u SET tenant_id = v_t, role = CASE WHEN _ids.i = 1 THEN 'university_admin' WHEN _ids.i = 2 THEN 'teacher' ELSE 'student' END,
     full_name = 'Student Number ' || _ids.i || ' Family', is_active = true FROM _ids WHERE u.id = _ids.id;
  SELECT id INTO v_admin FROM _ids WHERE i = 1; SELECT id INTO v_teacher FROM _ids WHERE i = 2;
  r := r || format('setup %s ms | ', round(extract(epoch from clock_timestamp()-t0)*1000));

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, email, full_name, avatar_url, role, is_active, created_at, tenant_id, can_create_courses, is_university_student
    FROM public.users WHERE role = 'student' AND tenant_id = v_t ORDER BY created_at DESC) x;
  r := r || format('[admin/students] rows=%s json=%s KB time=%s ms | ', c, sz/1024, round(extract(epoch from clock_timestamp()-t0)*1000));
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, name_complete FROM public.users WHERE tenant_id = v_t AND role = 'student') x;
  r := r || format('[nameCompleteFlags] rows=%s json=%s KB time=%s ms | ', c, sz/1024, round(extract(epoch from clock_timestamp()-t0)*1000));
  t0 := clock_timestamp();
  SELECT count(*) INTO c FROM public.users WHERE tenant_id = v_t AND role = 'student';
  r := r || format('[dashboard count] %s ms | ', round(extract(epoch from clock_timestamp()-t0)*1000));
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teacher, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, full_name, email FROM public.users WHERE tenant_id = v_t AND role = 'student' AND is_active = true ORDER BY full_name) x;
  r := r || format('[teacher/groups tenantStudents] rows=%s json=%s KB time=%s ms', c, sz/1024, round(extract(epoch from clock_timestamp()-t0)*1000));
  EXECUTE 'RESET ROLE';
  RAISE EXCEPTION 'RESULT: %', r;
END $$;

-- ── B) Exams and admin feeds ────────────────────────────────────────────────
DO $$
DECLARE
  v_t uuid := gen_random_uuid(); v_admin uuid; v_teacher uuid; v_student uuid; v_group uuid := gen_random_uuid();
  t0 timestamptz; r text := ''; c bigint; sz bigint; sz2 bigint; qs jsonb;
BEGIN
  SET LOCAL statement_timeout = '118s';
  t0 := clock_timestamp();
  INSERT INTO public.tenants (id, name, slug, code) VALUES (v_t, 'SCALE TEST (rolled back)', 'scale-test-rb-' || substr(v_t::text,1,8), 'ZZT9');
  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT gen_random_uuid() AS id, i FROM generate_series(1, 502) i;
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x' || i || '@scale.invalid', '{}'::jsonb, '{}'::jsonb, now(), now() FROM _ids;
  UPDATE public.users u SET tenant_id = v_t, role = CASE WHEN _ids.i = 1 THEN 'university_admin' WHEN _ids.i = 2 THEN 'teacher' ELSE 'student' END,
     full_name = 'Person ' || _ids.i, is_active = true FROM _ids WHERE u.id = _ids.id;
  SELECT id INTO v_admin FROM _ids WHERE i = 1; SELECT id INTO v_teacher FROM _ids WHERE i = 2; SELECT id INTO v_student FROM _ids WHERE i = 3;
  INSERT INTO public.groups (id, tenant_id, teacher_id, name) VALUES (v_group, v_t, v_teacher, 'Scale group');
  INSERT INTO public.group_students (group_id, student_id) SELECT v_group, id FROM _ids WHERE i >= 3;
  SELECT jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'type', 'mcq', 'points', 1,
      'question', repeat('نص السؤال ', 20),
      'options', jsonb_build_array(repeat('خيار أ ', 8), repeat('خيار ب ', 8), repeat('خيار ج ', 8), repeat('خيار د ', 8)),
      'correct_answer', repeat('خيار أ ', 8))) INTO qs FROM generate_series(1, 40);
  INSERT INTO public.exams (tenant_id, teacher_id, group_id, title, questions, is_published, duration_minutes)
    SELECT v_t, v_teacher, v_group, 'Exam ' || i, qs, i <= 50, 60 FROM generate_series(1, 2000) i;
  INSERT INTO public.lessons (tenant_id, group_id, teacher_id, title) SELECT v_t, v_group, v_teacher, 'Lesson ' || i FROM generate_series(1, 2000) i;
  INSERT INTO public.exam_submissions (exam_id, student_id, tenant_id)
    SELECT e.id, s.id, v_t FROM (SELECT id FROM public.exams WHERE tenant_id = v_t) e CROSS JOIN (SELECT id FROM _ids WHERE i BETWEEN 3 AND 22) s;
  r := r || format('setup %s ms | ', round(extract(epoch from clock_timestamp()-t0)*1000));

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')), octet_length(coalesce(json_agg(to_jsonb(x) - 'questions')::text, ''))
    INTO c, sz, sz2 FROM public.get_student_exam_list() x;
  r := r || format('[get_student_exam_list] rows=%s json=%s KB (without questions %s KB) time=%s ms | ', c, sz/1024, sz2/1024, round(extract(epoch from clock_timestamp()-t0)*1000));
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM public.get_admin_exams_page(false, 50, 0) x;
  r := r || format('[get_admin_exams_page] rows=%s json=%s KB time=%s ms | ', c, sz/1024, round(extract(epoch from clock_timestamp()-t0)*1000));
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM public.get_admin_lessons_page(50, 0) x;
  r := r || format('[get_admin_lessons_page] rows=%s json=%s KB time=%s ms', c, sz/1024, round(extract(epoch from clock_timestamp()-t0)*1000));
  EXECUTE 'RESET ROLE';
  RAISE EXCEPTION 'RESULT: %', r;
END $$;

-- ── Afterwards: nothing left behind (expect 0) ──────────────────────────────
SELECT (SELECT count(*) FROM auth.users WHERE email LIKE '%@scale.invalid') AS leftover_auth,
       (SELECT count(*) FROM public.tenants WHERE code = 'ZZT9') AS leftover_tenants;
