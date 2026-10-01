-- Batch 3 / P-03 — /teacher/lessons: every lesson with its full content vs one page of 50 whose
-- content becomes a 150-character excerpt on the server (src/lib/data/teacher-lessons.ts).
--
-- Synthetic, fully rolled back: one teacher with 300 lessons of 5–20 KB of markdown in 3 groups, a
-- second teacher with 5 lessons (isolation). Read AS THE TEACHER through RLS.
-- Ends with RAISE EXCEPTION: EVERYTHING is rolled back.
-- DIAGNOSTIC: sizes scale with rows, times do not — never extrapolate times.

DO $$
DECLARE
  tA uuid := gen_random_uuid(); teacherA uuid; teacherB uuid; g1 uuid; gB uuid;
  t0 timestamptz; r text := ''; c bigint; sz bigint; n bigint; srv bigint; brw bigint;
BEGIN
  SET LOCAL statement_timeout = '118s';
  INSERT INTO public.tenants (id, name, slug, code) VALUES (tA, 'LES A (rolled back)', 'les-a-' || substr(tA::text, 1, 8), 'ZZL3');
  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT gen_random_uuid() AS id, g AS k FROM generate_series(1, 2) g;
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'les' || k || '@scale.invalid', '{}', '{}', now(), now() FROM _ids;
  UPDATE public.users u SET tenant_id = tA, role = 'teacher', full_name = 'Teacher ' || k, is_active = true FROM _ids WHERE u.id = _ids.id;
  SELECT id INTO teacherA FROM _ids WHERE k = 1; SELECT id INTO teacherB FROM _ids WHERE k = 2;
  INSERT INTO public.groups (id, tenant_id, teacher_id, name) VALUES (gen_random_uuid(), tA, teacherA, 'G1') RETURNING id INTO g1;
  INSERT INTO public.groups (id, tenant_id, teacher_id, name) VALUES (gen_random_uuid(), tA, teacherB, 'GB') RETURNING id INTO gB;
  -- 300 lessons, content 5 KB … 20 KB (deterministic spread).
  INSERT INTO public.lessons (tenant_id, group_id, teacher_id, title, content, is_published, created_at)
    SELECT tA, g1, teacherA, 'Lesson ' || i,
           '# Lesson ' || i || E'\n\n' || repeat('**Term** — a long explanatory paragraph about the topic of the lesson. ', (5000 + (i % 16) * 1000) / 70),
           i % 3 <> 0, now() - (i || ' minutes')::interval
    FROM generate_series(1, 300) i;
  INSERT INTO public.lessons (tenant_id, group_id, teacher_id, title, content, is_published)
    SELECT tA, gB, teacherB, 'B lesson ' || i, repeat('x', 6000), true FROM generate_series(1, 5) i;
  ANALYZE public.lessons;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', teacherA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- BEFORE: exactly the page's read — every lesson, every column (content included), sent to the browser.
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT l.*, json_build_object('name', g.name) AS groups FROM public.lessons l LEFT JOIN public.groups g ON g.id = l.group_id
    WHERE l.teacher_id = teacherA ORDER BY l.created_at DESC) x;
  r := r || format('BEFORE rows=%s json=%s KB (all of it reaches the browser) %s ms | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- AFTER: one page of 50 (named columns + content, read by the server) → the browser gets a 150-char excerpt.
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, srv FROM (
    SELECT l.id, l.title, l.is_published, l.created_at, l.content, json_build_object('name', g.name) AS groups
    FROM public.lessons l LEFT JOIN public.groups g ON g.id = l.group_id
    WHERE l.teacher_id = teacherA ORDER BY l.created_at DESC, l.id LIMIT 50) x;
  SELECT octet_length(coalesce(json_agg(x)::text, '')) INTO brw FROM (
    SELECT l.id, l.title, l.is_published, l.created_at, left(regexp_replace(l.content, '[#*`]', '', 'g'), 150) AS excerpt,
           json_build_object('name', g.name) AS groups
    FROM public.lessons l LEFT JOIN public.groups g ON g.id = l.group_id
    WHERE l.teacher_id = teacherA ORDER BY l.created_at DESC, l.id LIMIT 50) x;
  SELECT count(*) INTO n FROM public.lessons WHERE teacher_id = teacherA;
  r := r || format('AFTER page rows=%s server read=%s KB, browser=%s KB, total=%s, %s ms | ', c, srv / 1024, brw / 1024, n, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- One lesson's content on «Edit» (on demand, own lesson only).
  SELECT octet_length(content) INTO sz FROM public.lessons WHERE teacher_id = teacherA ORDER BY created_at DESC LIMIT 1;
  r := r || format('Edit: one lesson content %s KB | ', sz / 1024);
  SELECT count(*) INTO n FROM public.lessons WHERE teacher_id = teacherB;
  r := r || format('P1 teacher A reads none of teacher B''s lessons (%s): %s', n, CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END);
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'RESULT: %', r;
END $$;

-- Afterwards (expect 0 / 0):
SELECT (SELECT count(*) FROM auth.users WHERE email LIKE 'les%@scale.invalid') AS leftover_auth,
       (SELECT count(*) FROM public.tenants WHERE code = 'ZZL3') AS leftover_tenants;
