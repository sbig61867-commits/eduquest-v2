-- Batch 3 / P-01 — /teacher/proctoring: every proctored submission (with the exam's questions and the
-- events) vs one page of 20 + database counts (src/lib/data/proctoring.ts).
--
-- Synthetic, fully rolled back: one institution, one teacher (A) with 20 proctored exams × 40 questions,
-- 200 students, 4 000 submissions (20 per exam per student … 200 × 20), each with 30 info events, every
-- 4th also with violations, every 7th with a paste signal. A second teacher (B) in the same institution
-- with 1 proctored exam and 10 submissions (isolation). Reads run AS TEACHER A through RLS.
-- Ends with RAISE EXCEPTION: EVERYTHING is rolled back.
-- DIAGNOSTIC: sizes scale with rows, times do not — never extrapolate times.

DO $$
DECLARE
  tA uuid := gen_random_uuid(); teacherA uuid; teacherB uuid; gA uuid; gB uuid; examB uuid;
  t0 timestamptz; r text := ''; c bigint; sz bigint; n bigint; n2 bigint; fl_js bigint; fl_db bigint;
  qs jsonb; info jsonb; viol jsonb; sig jsonb;
BEGIN
  SET LOCAL statement_timeout = '118s';
  INSERT INTO public.tenants (id, name, slug, code) VALUES (tA, 'PROC A (rolled back)', 'proc-a-' || substr(tA::text, 1, 8), 'ZZP7');
  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT gen_random_uuid() AS id, g AS k FROM generate_series(1, 202) g;
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'proc' || k || '@scale.invalid', '{}', '{}', now(), now() FROM _ids;
  UPDATE public.users u SET tenant_id = tA, role = CASE WHEN k <= 200 THEN 'student' ELSE 'teacher' END,
    full_name = 'Person Number ' || k || ' Family Name', is_active = true FROM _ids WHERE u.id = _ids.id;
  SELECT id INTO teacherA FROM _ids WHERE k = 201; SELECT id INTO teacherB FROM _ids WHERE k = 202;
  INSERT INTO public.groups (id, tenant_id, teacher_id, name) VALUES (gen_random_uuid(), tA, teacherA, 'GA') RETURNING id INTO gA;
  INSERT INTO public.groups (id, tenant_id, teacher_id, name) VALUES (gen_random_uuid(), tA, teacherB, 'GB') RETURNING id INTO gB;

  SELECT jsonb_agg(jsonb_build_object('id', i::text, 'type', 'mcq', 'text', 'Question number ' || i || ' — ' || repeat('lorem ipsum ', 12),
         'options', jsonb_build_array('Option A text', 'Option B text', 'Option C text', 'Option D text'),
         'correct_answer', 'Option A text', 'points', 2)) INTO qs FROM generate_series(1, 40) i;
  SELECT jsonb_agg(jsonb_build_object('type', 'monitoring_gap', 'details', 'face: stalled ' || i, 'timestamp', now())) INTO info FROM generate_series(1, 30) i;
  viol := jsonb_build_array(jsonb_build_object('type', 'tab_switch', 'details', 'left the page', 'timestamp', now()),
                            jsonb_build_object('type', 'looking_away', 'details', 'gaze', 'timestamp', now()));
  sig := jsonb_build_array(jsonb_build_object('type', 'paste_detected', 'details', '120 chars', 'timestamp', now()));

  CREATE TEMP TABLE _ex ON COMMIT DROP AS SELECT gen_random_uuid() AS id, g AS k FROM generate_series(1, 20) g;
  INSERT INTO public.exams (id, tenant_id, group_id, teacher_id, title, questions, proctoring_enabled, is_published, duration_minutes)
    SELECT id, tA, gA, teacherA, 'Proctored exam ' || k, qs, true, true, 60 FROM _ex;
  INSERT INTO public.exams (id, tenant_id, group_id, teacher_id, title, questions, proctoring_enabled, is_published, duration_minutes)
    VALUES (gen_random_uuid(), tA, gB, teacherB, 'B exam', qs, true, true, 60) RETURNING id INTO examB;
  INSERT INTO public.exam_submissions (exam_id, student_id, tenant_id, score, max_score, status, submitted_at, proctoring_events)
    SELECT e.id, s.id, tA, 40, 80, 'submitted', now() - ((e.k * 200 + s.k) || ' seconds')::interval,
           info || CASE WHEN (e.k * 200 + s.k) % 4 = 0 THEN viol ELSE '[]'::jsonb END
                || CASE WHEN (e.k * 200 + s.k) % 7 = 0 THEN sig ELSE '[]'::jsonb END
    FROM _ex e CROSS JOIN _ids s WHERE s.k <= 200;
  INSERT INTO public.exam_submissions (exam_id, student_id, tenant_id, score, max_score, status, submitted_at, proctoring_events)
    SELECT examB, id, tA, 10, 80, 'submitted', now(), viol FROM _ids WHERE k <= 10;
  ANALYZE public.exam_submissions; ANALYZE public.exams;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', teacherA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- BEFORE: exactly the page's read (no limit; questions embedded on every row).
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT s.id, s.score, s.submitted_at, s.proctoring_events,
           json_build_object('title', e.title, 'teacher_id', e.teacher_id, 'proctoring_enabled', e.proctoring_enabled, 'questions', e.questions) AS exams,
           json_build_object('full_name', u.full_name, 'email', u.email) AS users
    FROM public.exam_submissions s JOIN public.exams e ON e.id = s.exam_id LEFT JOIN public.users u ON u.id = s.student_id
    WHERE e.teacher_id = teacherA AND e.proctoring_enabled ORDER BY s.submitted_at DESC) x;
  r := r || format('BEFORE rows=%s json=%s KB %s ms | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- AFTER: one page of 20 without questions (max_score from the row) + two head counts.
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT s.id, s.score, s.max_score, s.submitted_at, s.proctoring_events,
           json_build_object('title', e.title) AS exams, json_build_object('full_name', u.full_name, 'email', u.email) AS users
    FROM public.exam_submissions s JOIN public.exams e ON e.id = s.exam_id LEFT JOIN public.users u ON u.id = s.student_id
    WHERE e.teacher_id = teacherA AND e.proctoring_enabled ORDER BY s.submitted_at DESC, s.id LIMIT 20) x;
  SELECT count(*) INTO n FROM public.exam_submissions s JOIN public.exams e ON e.id = s.exam_id
    WHERE e.teacher_id = teacherA AND e.proctoring_enabled;
  SELECT count(*) INTO fl_db FROM public.exam_submissions s JOIN public.exams e ON e.id = s.exam_id
    WHERE e.teacher_id = teacherA AND e.proctoring_enabled AND (
      s.proctoring_events @> '[{"type":"tab_switch"}]' OR s.proctoring_events @> '[{"type":"fullscreen_exit"}]' OR
      s.proctoring_events @> '[{"type":"face_not_detected"}]' OR s.proctoring_events @> '[{"type":"multiple_faces"}]' OR
      s.proctoring_events @> '[{"type":"looking_away"}]' OR s.proctoring_events @> '[{"type":"audio_detected"}]' OR
      s.proctoring_events @> '[{"type":"speech_detected"}]' OR s.proctoring_events @> '[{"type":"suspicious_activity"}]' OR
      s.proctoring_events @> '[{"type":"camera_stopped"}]' OR s.proctoring_events @> '[{"type":"face_mismatch"}]' OR
      s.proctoring_events @> '[{"type":"spoof_detected"}]');
  r := r || format('AFTER page rows=%s json=%s KB + counts total=%s flagged=%s, %s ms | ', c, sz / 1024, n, fl_db, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- Parity: the containment count equals the page's own rule (any event whose type is a violation).
  SELECT count(*) INTO fl_js FROM public.exam_submissions s JOIN public.exams e ON e.id = s.exam_id
    WHERE e.teacher_id = teacherA AND e.proctoring_enabled AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(s.proctoring_events) ev WHERE ev->>'type' IN ('tab_switch','fullscreen_exit','face_not_detected',
        'multiple_faces','looking_away','audio_detected','speech_detected','suspicious_activity','camera_stopped','face_mismatch','spoof_detected'));
  r := r || format('P1 flagged by containment = flagged by the page''s rule (%s = %s): %s | ', fl_db, fl_js, CASE WHEN fl_db = fl_js THEN 'PASS' ELSE 'FAIL' END);
  r := r || format('P2 max_score equals the old sum of question points (80): %s | ',
    CASE WHEN NOT EXISTS (SELECT 1 FROM public.exam_submissions s JOIN public.exams e ON e.id = s.exam_id WHERE e.teacher_id = teacherA AND s.max_score <> 80) THEN 'PASS' ELSE 'FAIL' END);
  SELECT count(*) INTO n2 FROM public.exam_submissions s JOIN public.exams e ON e.id = s.exam_id WHERE e.id = examB;
  r := r || format('P3 teacher A sees none of teacher B''s submissions (%s): %s', n2, CASE WHEN n2 = 0 THEN 'PASS' ELSE 'FAIL' END);
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'RESULT: %', r;
END $$;

-- Afterwards (expect 0 / 0):
SELECT (SELECT count(*) FROM auth.users WHERE email LIKE 'proc%@scale.invalid') AS leftover_auth,
       (SELECT count(*) FROM public.tenants WHERE code = 'ZZP7') AS leftover_tenants;
