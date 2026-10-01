-- Batch 2 — Centre Mail (/center/mail): every active student + every group's member ids preloaded
-- vs on-demand recipient search + group_id resolved on the server.
--
-- Synthetic platform, fully rolled back:
--   institution A: 20 000 students (every 9th disabled), 200 teachers, 1 000 active groups (+ 1 disabled),
--                  ~19 000 memberships, 1 centre manager (manage_students);
--   institution B: 2 000 students, 10 groups.
-- Page reads run AS THE CENTRE MANAGER through RLS (the page uses the session). The server-side group
-- resolution runs as the service role (like /api/mail/send's recipient lookup), after the route's checks.
-- Ends with RAISE EXCEPTION: EVERYTHING is rolled back.
-- DIAGNOSTIC: sizes scale with rows, times do not — never extrapolate times.

DO $$
DECLARE
  tA uuid := gen_random_uuid(); tB uuid := gen_random_uuid();
  managerA uuid; gA uuid; gB uuid; gOff uuid;
  t0 timestamptz; r text := ''; c bigint; sz bigint; c2 bigint; sz2 bigint; n bigint; n2 bigint;
BEGIN
  SET LOCAL statement_timeout = '118s';
  INSERT INTO public.tenants (id, name, slug, code) VALUES
    (tA, 'MAIL A (rolled back)', 'mail-a-' || substr(tA::text, 1, 8), 'ZZM7'),
    (tB, 'MAIL B (rolled back)', 'mail-b-' || substr(tB::text, 1, 8), 'ZZM8');
  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT gen_random_uuid() AS id, g AS k FROM generate_series(1, 22201) g;
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cmail' || k || '@scale.invalid', '{}', '{}', now(), now() FROM _ids;
  -- k=1..20000 students A, 20001..20200 teachers A, 20201..22200 students B, 22201 centre manager A
  UPDATE public.users u SET
    tenant_id = CASE WHEN _ids.k <= 20200 OR _ids.k = 22201 THEN tA ELSE tB END,
    role = CASE WHEN _ids.k <= 20000 OR _ids.k BETWEEN 20201 AND 22200 THEN 'student'
                WHEN _ids.k <= 20200 THEN 'teacher' ELSE 'center_manager' END,
    full_name = 'Person Number ' || _ids.k || ' Family Name',
    is_active = (_ids.k % 9 <> 0),
    permissions = CASE WHEN _ids.k = 22201 THEN '{"manage_students": true}'::jsonb ELSE u.permissions END
  FROM _ids WHERE u.id = _ids.id;
  SELECT id INTO managerA FROM _ids WHERE k = 22201;
  INSERT INTO public.groups (tenant_id, teacher_id, name)
    SELECT tA, (SELECT id FROM _ids WHERE k = 20001 + (g % 200)), 'Group ' || g FROM generate_series(1, 1000) g;
  INSERT INTO public.groups (tenant_id, teacher_id, name, is_active)
    VALUES (tA, (SELECT id FROM _ids WHERE k = 20001), 'Disabled group', false) RETURNING id INTO gOff;
  INSERT INTO public.groups (tenant_id, teacher_id, name)
    SELECT tB, (SELECT id FROM _ids WHERE k = 20001), 'B Group ' || g FROM generate_series(1, 10) g;
  -- ~19 students per group in A (student k in group ((k-1) % 1000) + 1, k <= 19000); 80 in the first group.
  INSERT INTO public.group_students (group_id, student_id)
    SELECT g.id, s.id FROM _ids s JOIN public.groups g ON g.tenant_id = tA AND g.name = 'Group ' || (((s.k - 1) % 1000) + 1)
    WHERE s.k <= 19000;
  SELECT id INTO gA FROM public.groups WHERE tenant_id = tA AND name = 'Group 1';
  INSERT INTO public.group_students (group_id, student_id)
    SELECT gA, id FROM _ids WHERE k BETWEEN 19001 AND 19061;
  SELECT id INTO gB FROM public.groups WHERE tenant_id = tB AND name = 'B Group 1';
  INSERT INTO public.group_students (group_id, student_id) SELECT gB, id FROM _ids WHERE k BETWEEN 20201 AND 20230;
  ANALYZE public.users; ANALYZE public.groups; ANALYZE public.group_students;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', managerA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- BEFORE: the page's two reads, exactly as src/app/(center)/center/mail/page.tsx runs them.
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, full_name, email FROM public.users
    WHERE tenant_id = tA AND role = 'student' AND is_active ORDER BY full_name) x;
  r := r || format('BEFORE students rows=%s json=%s KB %s ms | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')), sum(m) INTO c2, sz2, n FROM (
    SELECT g.id, g.name, g.is_active,
           (SELECT json_agg(json_build_object('student_id', gs.student_id)) FROM public.group_students gs WHERE gs.group_id = g.id) AS group_students,
           (SELECT count(*) FROM public.group_students gs WHERE gs.group_id = g.id) AS m
    FROM public.groups g WHERE g.tenant_id = tA AND g.is_active ORDER BY g.name) x;
  r := r || format('BEFORE groups+member ids rows=%s members=%s json=%s KB %s ms | ', c2, n, sz2 / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- AFTER: the page reads groups with a member COUNT only; recipients are searched on demand.
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT g.id, g.name, (SELECT count(*) FROM public.group_students gs WHERE gs.group_id = g.id) AS members
    FROM public.groups g WHERE g.tenant_id = tA AND g.is_active ORDER BY g.name) x;
  r := r || format('AFTER groups+count rows=%s json=%s KB %s ms | ', c, sz / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, full_name, email FROM public.users
    WHERE tenant_id = tA AND role = 'student' AND is_active AND (full_name ILIKE '%Person%' OR email ILIKE '%Person%')
    ORDER BY full_name, id LIMIT 20) x;
  r := r || format('AFTER one search rows=%s json=%s B %s ms | ', c, sz, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- Isolation through RLS: the centre manager sees none of B.
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tB AND role = 'student';
  SELECT count(*) INTO n2 FROM public.groups WHERE tenant_id = tB;
  r := r || format('P1 manager A reads 0 of B (students %s, groups %s): %s | ', n, n2, CASE WHEN n = 0 AND n2 = 0 THEN 'PASS' ELSE 'FAIL' END);
  SELECT count(*) INTO n FROM public.users
    WHERE tenant_id = tA AND role = 'student' AND is_active AND (full_name ILIKE '%Number 20201 %' OR email ILIKE '%cmail20201@%');
  r := r || format('P2 a B student never matches in A: %s | ', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ' || n END);
  EXECUTE 'RESET ROLE';

  -- Server-side group resolution (service role, after the route checked tenant + active group):
  -- the group's ACTIVE STUDENTS of the SAME institution — what the old client kept of member_ids.
  t0 := clock_timestamp();
  SELECT count(*) INTO n FROM public.group_students gs JOIN public.users u ON u.id = gs.student_id
    WHERE gs.group_id = gA AND u.tenant_id = tA AND u.role = 'student' AND u.is_active;
  SELECT count(*) INTO n2 FROM public.group_students WHERE group_id = gA;
  r := r || format('P3 group 1 resolves %s active students of %s members (disabled left out) %s ms | ', n, n2, round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  SELECT count(*) INTO n FROM public.groups WHERE id = gB AND tenant_id = tA;
  r := r || format('P4 a B group is not found in A (refused): %s | ', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END);
  SELECT count(*) INTO n FROM public.groups WHERE id = gOff AND tenant_id = tA AND is_active;
  r := r || format('P5 a disabled group is not usable (not listed before either): %s', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END);

  RAISE EXCEPTION 'RESULT: %', r;
END $$;

-- Afterwards (expect 0 / 0):
SELECT (SELECT count(*) FROM auth.users WHERE email LIKE 'cmail%@scale.invalid') AS leftover_auth,
       (SELECT count(*) FROM public.tenants WHERE code IN ('ZZM7', 'ZZM8')) AS leftover_tenants;
