-- Archived groups — student surfaces: regression check for supabase/archived_groups_student_surfaces_migration.sql.
--
-- Run where the migration is applied, or as a DRY RUN: in one transaction, the migration's statements first,
-- then this block. The RAISE EXCEPTION at the end aborts the transaction, so every synthetic row goes with it
-- (and, in a dry run, the migration too). Run it alone, BEFORE the migration, to see S1–S3 FAIL: the check
-- tells the two forms apart.
--
-- Synthetic institution ZZE1: teacher T owns group A (active) and group X (archived). Student S is a member of
-- both. One published lesson, one published group timetable (one slot) and one scored exam per group;
-- announcements aimed at A only, X only, A and X together, and everyone. Every read runs AS THE ROLE.

DO $chk$
DECLARE
  tZ uuid := gen_random_uuid(); teacherT uuid := gen_random_uuid(); studentS uuid := gen_random_uuid();
  gA uuid := gen_random_uuid(); gX uuid := gen_random_uuid();
  lA uuid := gen_random_uuid(); lX uuid := gen_random_uuid();
  sA uuid := gen_random_uuid(); sX uuid := gen_random_uuid();
  eX uuid := gen_random_uuid();
  aA uuid := gen_random_uuid(); aX uuid := gen_random_uuid(); aAX uuid := gen_random_uuid(); aAll uuid := gen_random_uuid();
  r text := ''; pass int := 0; fail int := 0; ok boolean;
  sched uuid[]; ann uuid[]; les jsonb; grades jsonb; n int; score_before numeric; members_before int;
BEGIN
  SET LOCAL statement_timeout = '60s';
  EXECUTE 'SET LOCAL session_replication_role = replica';

  INSERT INTO public.tenants (id, name, slug, code) VALUES (tZ, 'ZZE archived groups (rolled back)', 'zze-' || substr(tZ::text, 1, 8), 'ZZE1');
  INSERT INTO public.users (id, email, full_name, role, tenant_id, is_active, member_code) VALUES
    (teacherT, 'zze-t@x.invalid', 'Teacher T', 'teacher', tZ, true, 'ZZE1-T1'),
    (studentS, 'zze-s@x.invalid', 'Student S', 'student', tZ, true, 'ZZE1-S1');
  INSERT INTO public.groups (id, tenant_id, teacher_id, name, is_active) VALUES
    (gA, tZ, teacherT, 'Group A (active)', true), (gX, tZ, teacherT, 'Group X (archived)', false);
  INSERT INTO public.group_students (group_id, student_id) VALUES (gA, studentS), (gX, studentS);
  INSERT INTO public.lessons (id, tenant_id, group_id, teacher_id, title, is_published) VALUES
    (lA, tZ, gA, teacherT, 'Lesson A', true), (lX, tZ, gX, teacherT, 'Lesson X', true);
  INSERT INTO public.schedules (id, tenant_id, kind, group_id, title, is_published, created_by) VALUES
    (sA, tZ, 'group', gA, 'Timetable A', true, teacherT), (sX, tZ, 'group', gX, 'Timetable X', true, teacherT);
  INSERT INTO public.schedule_slots (schedule_id, tenant_id, day_of_week, start_time, end_time, title, teacher_id) VALUES
    (sA, tZ, 1, '09:00', '10:00', 'Slot A', teacherT), (sX, tZ, 2, '09:00', '10:00', 'Slot X', teacherT);
  INSERT INTO public.exams (id, tenant_id, teacher_id, title, type, group_id, is_published, duration_minutes, questions) VALUES
    (eX, tZ, teacherT, 'Exam X', 'exam', gX, true, 30,
     jsonb_build_array(jsonb_build_object('id', 'q1', 'type', 'mcq', 'text', 'Q', 'options', jsonb_build_array('a', 'b'), 'correct_answer', 'a', 'points', 5)));
  INSERT INTO public.exam_submissions (exam_id, student_id, tenant_id, status, score, max_score, grading_status, is_graded, submitted_at)
    VALUES (eX, studentS, tZ, 'submitted', 4, 5, 'published', true, now() - interval '1 hour');
  INSERT INTO public.announcements (id, tenant_id, created_by, title, audience, is_published) VALUES
    (aA, tZ, teacherT, 'For A', 'groups', true), (aX, tZ, teacherT, 'For X', 'groups', true),
    (aAX, tZ, teacherT, 'For A and X', 'groups', true), (aAll, tZ, teacherT, 'For all', 'all', true);
  INSERT INTO public.announcement_groups (announcement_id, group_id) VALUES (aA, gA), (aX, gX), (aAX, gA), (aAX, gX);
  EXECUTE 'SET LOCAL session_replication_role = origin';

  SELECT count(*) INTO members_before FROM public.group_students WHERE student_id = studentS;
  SELECT score INTO score_before FROM public.exam_submissions WHERE exam_id = eX AND student_id = studentS;

  -- ── as student S, group X archived ───────────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', studentS, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT array_agg(group_id ORDER BY group_id) INTO sched FROM public.get_student_schedule();
  SELECT array_agg(id ORDER BY id) INTO ann FROM public.get_student_announcements();
  les    := public.get_my_notifications() -> 'lessons';
  grades := public.get_my_notifications() -> 'grades';
  EXECUTE 'RESET ROLE';

  ok := sched = ARRAY[gA];
  r := r || format('S1 schedule: archived group X''s timetable hidden, A''s shown: %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL ' || coalesce(sched::text, 'none') END);
  IF ok THEN pass := pass + 1; ELSE fail := fail + 1; END IF;

  ok := ann = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[aA, aAX, aAll]) x);
  r := r || format('S2 announcements: X-only hidden; A, A+X and all shown: %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  IF ok THEN pass := pass + 1; ELSE fail := fail + 1; END IF;

  ok := jsonb_array_length(les) = 1 AND les -> 0 ->> 'id' = lA::text;
  r := r || format('S3 bell lessons: only the active group''s lesson: %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL ' || les::text END);
  IF ok THEN pass := pass + 1; ELSE fail := fail + 1; END IF;

  ok := jsonb_array_length(grades) = 1 AND grades -> 0 ->> 'exam_id' = eX::text;
  r := r || format('S4 bell grades: the archived group''s grade (a record) is still there: %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  IF ok THEN pass := pass + 1; ELSE fail := fail + 1; END IF;

  -- ── as teacher T: unchanged (sees both groups' lessons and timetables) ───────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', teacherT, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.lessons WHERE id IN (lA, lX);
  EXECUTE 'RESET ROLE';
  ok := n = 2;
  r := r || format('S5 teacher still reads both groups'' lessons: %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL ' || n END);
  IF ok THEN pass := pass + 1; ELSE fail := fail + 1; END IF;

  -- ── membership and records untouched ─────────────────────────────────────────────────────────────────
  ok := (SELECT count(*) FROM public.group_students WHERE student_id = studentS) = members_before
        AND (SELECT score FROM public.exam_submissions WHERE exam_id = eX AND student_id = studentS) = score_before;
  r := r || format('S6 membership (2) and the grade unchanged: %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  IF ok THEN pass := pass + 1; ELSE fail := fail + 1; END IF;

  -- ── restore group X: everything comes back ───────────────────────────────────────────────────────────
  UPDATE public.groups SET is_active = true WHERE id = gX;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', studentS, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.get_student_schedule();
  ok := n = 2;
  SELECT count(*) INTO n FROM public.get_student_announcements();
  ok := ok AND n = 4;
  ok := ok AND jsonb_array_length(public.get_my_notifications() -> 'lessons') = 2;
  EXECUTE 'RESET ROLE';
  r := r || format('S7 restore (is_active = true): 2 slots, 4 announcements, 2 lessons: %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  IF ok THEN pass := pass + 1; ELSE fail := fail + 1; END IF;

  -- ── the three functions: kind, volatility, search_path, grants ───────────────────────────────────────
  ok := (SELECT bool_and(CASE p.proname WHEN 'get_my_notifications' THEN NOT p.prosecdef AND p.provolatile = 's'
                                         ELSE p.prosecdef AND p.provolatile = 'v' END
                         AND p.proconfig = ARRAY['search_path=public, pg_temp']
                         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                         AND has_function_privilege('authenticated', p.oid, 'EXECUTE'))
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
           AND p.proname IN ('get_student_schedule', 'get_student_announcements', 'get_my_notifications'));
  r := r || format('S8 DEFINER/INVOKER, volatility, search_path, anon no EXECUTE, authenticated EXECUTE: %s', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  IF ok THEN pass := pass + 1; ELSE fail := fail + 1; END IF;

  RAISE EXCEPTION 'ARCHIVED-GROUPS CHECK (rolled back): % PASS, % FAIL | %', pass, fail, r;
END
$chk$;
