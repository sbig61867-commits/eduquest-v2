-- Batch 2 / C-M — RosterModal member list: whole roster vs one page (src/lib/data/rosters.ts readRosterPage).
--
-- A course with 3 000 enrolments and a group with 300 members, plus a small group (19). The membership
-- routes read with the service-role client after their own authorization, so this measures as the owner
-- (no RLS) — exactly that read. Ends with RAISE EXCEPTION: EVERYTHING is rolled back.
-- DIAGNOSTIC: sizes scale with rows, times do not — never extrapolate times.

DO $$
DECLARE
  tA uuid := gen_random_uuid(); g1 uuid := gen_random_uuid(); g2 uuid := gen_random_uuid(); c1 uuid := gen_random_uuid();
  t0 timestamptz; r text := ''; c bigint; sz bigint; n bigint;
BEGIN
  SET LOCAL statement_timeout = '118s';
  INSERT INTO public.tenants (id, name, slug, code) VALUES (tA, 'CM A (rolled back)', 'cm-a-' || substr(tA::text, 1, 8), 'ZZM1');
  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT gen_random_uuid() AS id, g AS k FROM generate_series(1, 3001) g;
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cm' || k || '@scale.invalid', '{}', '{}', now(), now() FROM _ids;
  UPDATE public.users u SET tenant_id = tA, role = CASE WHEN _ids.k = 3001 THEN 'teacher' ELSE 'student' END,
    full_name = 'Course Member ' || _ids.k || ' Family Name', is_active = true FROM _ids WHERE u.id = _ids.id;
  INSERT INTO public.groups (id, tenant_id, teacher_id, name) VALUES
    (g1, tA, (SELECT id FROM _ids WHERE k = 3001), 'G300'), (g2, tA, (SELECT id FROM _ids WHERE k = 3001), 'G19');
  INSERT INTO public.courses (id, tenant_id, teacher_id, title) VALUES (c1, tA, (SELECT id FROM _ids WHERE k = 3001), 'C3000');
  INSERT INTO public.course_enrollments (course_id, student_id, tenant_id, enrolled_at)
    SELECT c1, id, tA, now() - (k || ' seconds')::interval FROM _ids WHERE k <= 3000;
  INSERT INTO public.group_students (group_id, student_id, joined_at) SELECT g1, id, now() - (k || ' seconds')::interval FROM _ids WHERE k <= 300;
  INSERT INTO public.group_students (group_id, student_id) SELECT g2, id FROM _ids WHERE k BETWEEN 301 AND 319;
  ANALYZE public.course_enrollments; ANALYZE public.group_students; ANALYZE public.users;

  -- BEFORE: the whole list RosterModal received.
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT e.student_id, e.enrolled_at, json_build_object('id', u.id, 'full_name', u.full_name, 'email', u.email) AS users
    FROM public.course_enrollments e JOIN public.users u ON u.id = e.student_id WHERE e.course_id = c1 ORDER BY e.enrolled_at DESC) x;
  r := r || format('BEFORE course 3000: rows=%s json=%s KB %s ms | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT gs.student_id, json_build_object('id', u.id, 'full_name', u.full_name, 'email', u.email) AS users
    FROM public.group_students gs JOIN public.users u ON u.id = gs.student_id WHERE gs.group_id = g1) x;
  r := r || format('BEFORE group 300: rows=%s json=%s KB %s ms | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- AFTER: one page (50) ordered newest first + the exact count (PostgREST count=exact).
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT e.student_id, json_build_object('id', u.id, 'full_name', u.full_name, 'email', u.email) AS users
    FROM public.course_enrollments e JOIN public.users u ON u.id = e.student_id WHERE e.course_id = c1
    ORDER BY e.enrolled_at DESC, e.student_id LIMIT 50 OFFSET 0) x;
  SELECT count(*) INTO n FROM public.course_enrollments WHERE course_id = c1;
  r := r || format('AFTER course page 1: rows=%s json=%s KB total=%s %s ms | ', c, sz / 1024, n, round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  t0 := clock_timestamp();
  SELECT count(*) INTO c FROM (SELECT e.student_id FROM public.course_enrollments e WHERE e.course_id = c1
    ORDER BY e.enrolled_at DESC, e.student_id LIMIT 50 OFFSET 2950) x;
  r := r || format('AFTER course last page: rows=%s %s ms | ', c, round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT gs.student_id, json_build_object('id', u.id, 'full_name', u.full_name, 'email', u.email) AS users
    FROM public.group_students gs JOIN public.users u ON u.id = gs.student_id WHERE gs.group_id = g1
    ORDER BY gs.joined_at DESC, gs.student_id LIMIT 50) x;
  SELECT count(*) INTO n FROM public.group_students WHERE group_id = g1;
  r := r || format('AFTER group page 1: rows=%s json=%s KB total=%s %s ms | ', c, sz / 1024, n, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- Pages never overlap and cover everyone exactly once (stable order).
  SELECT count(DISTINCT student_id) INTO c FROM (
    SELECT e.student_id, row_number() OVER (ORDER BY e.enrolled_at DESC, e.student_id) AS rn
    FROM public.course_enrollments e WHERE e.course_id = c1) p;
  r := r || format('P1 60 pages cover the 3000 enrolments exactly once: %s | ', CASE WHEN c = 3000 THEN 'PASS' ELSE 'FAIL ' || c END);
  SELECT count(*) INTO c FROM public.group_students WHERE group_id = g2;
  r := r || format('P2 a small group (%s) fits on one page: %s', c, CASE WHEN c <= 50 THEN 'PASS' ELSE 'FAIL' END);

  RAISE EXCEPTION 'RESULT: %', r;
END $$;

-- Afterwards (expect 0 / 0):
SELECT (SELECT count(*) FROM auth.users WHERE email LIKE 'cm%@scale.invalid') AS leftover_auth,
       (SELECT count(*) FROM public.tenants WHERE code = 'ZZM1') AS leftover_tenants;
