-- Batch 3 / P-05 — /student/lessons: every lesson of the student's groups WITH its full body (each one
-- rendered through LessonTabs on the page) vs one page of 50 titles + one body read when a lesson is opened
-- (src/lib/data/student-lessons.ts).
--
-- Synthetic, fully rolled back: one institution, a teacher, a student in 3 active groups + 1 disabled group,
-- 300 published lessons of 5–20 KB across the 3 groups (+ 20 unpublished, + 10 in the disabled group), and a
-- group the student is NOT in with 10 lessons (isolation). Read AS THE STUDENT through RLS.
-- Ends with RAISE EXCEPTION: EVERYTHING is rolled back.
-- DIAGNOSTIC: sizes scale with rows, times do not — never extrapolate times.

DO $$
DECLARE
  tA uuid := gen_random_uuid(); teacherA uuid; studentA uuid; g1 uuid; g2 uuid; g3 uuid; gOff uuid; gOther uuid;
  t0 timestamptz; r text := ''; c bigint; sz bigint; n bigint; one_id uuid;
BEGIN
  SET LOCAL statement_timeout = '118s';
  INSERT INTO public.tenants (id, name, slug, code) VALUES (tA, 'SLES A (rolled back)', 'sles-a-' || substr(tA::text, 1, 8), 'ZZS5');
  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT gen_random_uuid() AS id, g AS k FROM generate_series(1, 2) g;
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sles' || k || '@scale.invalid', '{}', '{}', now(), now() FROM _ids;
  UPDATE public.users u SET tenant_id = tA, role = CASE WHEN k = 1 THEN 'teacher' ELSE 'student' END, full_name = 'Person ' || k, is_active = true
    FROM _ids WHERE u.id = _ids.id;
  SELECT id INTO teacherA FROM _ids WHERE k = 1; SELECT id INTO studentA FROM _ids WHERE k = 2;
  INSERT INTO public.groups (id, tenant_id, teacher_id, name) VALUES (gen_random_uuid(), tA, teacherA, 'Physics') RETURNING id INTO g1;
  INSERT INTO public.groups (id, tenant_id, teacher_id, name) VALUES (gen_random_uuid(), tA, teacherA, 'Chemistry') RETURNING id INTO g2;
  INSERT INTO public.groups (id, tenant_id, teacher_id, name) VALUES (gen_random_uuid(), tA, teacherA, 'Biology') RETURNING id INTO g3;
  INSERT INTO public.groups (id, tenant_id, teacher_id, name, is_active) VALUES (gen_random_uuid(), tA, teacherA, 'Old', false) RETURNING id INTO gOff;
  INSERT INTO public.groups (id, tenant_id, teacher_id, name) VALUES (gen_random_uuid(), tA, teacherA, 'Not mine') RETURNING id INTO gOther;
  INSERT INTO public.group_students (group_id, student_id) VALUES (g1, studentA), (g2, studentA), (g3, studentA), (gOff, studentA);
  INSERT INTO public.lessons (tenant_id, group_id, teacher_id, title, content, is_published, created_at)
    SELECT tA, (ARRAY[g1, g2, g3])[1 + i % 3], teacherA, 'Lesson ' || i,
           '# Lesson ' || i || E'\n\n' || repeat('**Term** — a long explanatory paragraph about the topic of the lesson. ', (5000 + (i % 16) * 1000) / 70),
           true, now() - (i || ' minutes')::interval
    FROM generate_series(1, 300) i;
  INSERT INTO public.lessons (tenant_id, group_id, teacher_id, title, content, is_published)
    SELECT tA, g1, teacherA, 'Draft ' || i, repeat('d', 6000), false FROM generate_series(1, 20) i;
  INSERT INTO public.lessons (tenant_id, group_id, teacher_id, title, content, is_published)
    SELECT tA, gOff, teacherA, 'Archived group ' || i, repeat('o', 6000), true FROM generate_series(1, 10) i;
  INSERT INTO public.lessons (tenant_id, group_id, teacher_id, title, content, is_published)
    SELECT tA, gOther, teacherA, 'Other group ' || i, repeat('x', 6000), true FROM generate_series(1, 10) i;
  ANALYZE public.lessons;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', studentA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- BEFORE: exactly the page's read (published lessons of the student's active groups, every column).
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT l.*, json_build_object('name', g.name, 'is_active', g.is_active) AS groups
    FROM public.lessons l JOIN public.groups g ON g.id = l.group_id
    WHERE l.is_published AND g.is_active AND l.group_id IN (g1, g2, g3, gOff) ORDER BY l.created_at DESC) x;
  r := r || format('BEFORE rows=%s json=%s KB (every body rendered on the page) %s ms | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- AFTER: one page of 50 titles (no body) + the exact count; one body when a lesson is opened.
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT l.id, l.title, l.created_at, l.group_id, json_build_object('name', g.name, 'is_active', g.is_active) AS groups
    FROM public.lessons l JOIN public.groups g ON g.id = l.group_id
    WHERE l.is_published AND g.is_active AND l.group_id IN (g1, g2, g3, gOff) ORDER BY l.created_at DESC, l.id LIMIT 50) x;
  SELECT count(*) INTO n FROM public.lessons l JOIN public.groups g ON g.id = l.group_id
    WHERE l.is_published AND g.is_active AND l.group_id IN (g1, g2, g3, gOff);
  r := r || format('AFTER page rows=%s json=%s KB, total=%s, %s ms | ', c, sz / 1024, n, round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  SELECT l.id INTO one_id FROM public.lessons l WHERE l.group_id = g1 AND l.is_published ORDER BY l.created_at DESC LIMIT 1;
  SELECT octet_length(content) INTO sz FROM public.lessons l JOIN public.groups g ON g.id = l.group_id WHERE l.id = one_id AND g.is_active;
  r := r || format('Open one lesson: %s KB | ', sz / 1024);

  -- What the student can and cannot read (RLS + the page's active-group filter).
  SELECT count(*) INTO n FROM public.lessons WHERE group_id = gOther;
  r := r || format('P1 lessons of a group the student is not in: %s visible: %s | ', n, CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END);
  SELECT count(*) INTO n FROM public.lessons WHERE NOT is_published;
  r := r || format('P2 unpublished lessons visible: %s: %s | ', n, CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END);
  SELECT count(*) INTO n FROM public.lessons l JOIN public.groups g ON g.id = l.group_id WHERE l.group_id = gOff AND g.is_active;
  r := r || format('P3 a disabled group''s lessons are excluded by the active-group filter (list and open): %s', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END);
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'RESULT: %', r;
END $$;

-- Afterwards (expect 0 / 0):
SELECT (SELECT count(*) FROM auth.users WHERE email LIKE 'sles%@scale.invalid') AS leftover_auth,
       (SELECT count(*) FROM public.tenants WHERE code = 'ZZS5') AS leftover_tenants;
