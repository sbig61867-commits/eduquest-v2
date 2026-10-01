-- Batch 2 — centre teachers list: scale + isolation + lock-equivalence check (PERFORMANCE_CONTRACT.md P1, P4).
--
-- Institution A: 2 000 teachers (every 7th disabled), each owning (k % 4) university groups (every 10th
-- of them archived), teachers with k % 3 = 0 own one centre course, and teachers with k % 6 = 0 also run
-- a course-linked group; plus 1 admin and 1 centre manager. Institution B: 5 teachers with a group each
-- and 1 centre manager. Everything is read through RLS AS THE CENTRE MANAGER:
--   before = every teacher + every live group + every live course of the institution (page.tsx);
--   after  = one page (50) + exact count + active count, then the groups/courses of THAT PAGE's
--            teachers only (.in('teacher_id', ids)), as src/lib/data/people.ts listCenterTeachers does.
-- L1 proves the lock decision (account-scope.ts teacherBlock) is identical for all 2 000 teachers when
-- the footprint is computed page by page instead of from the whole institution.
-- Ends with RAISE EXCEPTION: the report is the error message and EVERYTHING is rolled back.
-- DIAGNOSTIC: sizes scale with rows, times do not — never extrapolate times.

DO $$
DECLARE
  tA uuid := gen_random_uuid(); tB uuid := gen_random_uuid();
  managerA uuid; managerB uuid; studentA uuid;
  t0 timestamptz; r text := ''; c bigint; sz bigint; sz2 bigint; sz3 bigint; n bigint; a bigint; p int; mism bigint := 0;
  ids uuid[];
BEGIN
  SET LOCAL statement_timeout = '118s';
  INSERT INTO public.tenants (id, name, slug, code) VALUES
    (tA, 'CTLIST A (rolled back)', 'ctlist-a-' || substr(tA::text, 1, 8), 'ZZD1'),
    (tB, 'CTLIST B (rolled back)', 'ctlist-b-' || substr(tB::text, 1, 8), 'ZZD2');
  CREATE TEMP TABLE _ids ON COMMIT DROP AS
    SELECT gen_random_uuid() AS id, g AS k FROM generate_series(1, 2010) g;
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ct' || k || '@scale.invalid', '{}', '{}', now(), now() FROM _ids;
  -- k=1..2000 teachers A, 2001 admin A, 2002 centre manager A, 2003 student A,
  -- 2004 centre manager B, 2005..2009 teachers B, 2010 admin B
  UPDATE public.users u SET
    tenant_id = CASE WHEN _ids.k <= 2003 THEN tA ELSE tB END,
    role = CASE WHEN _ids.k IN (2001, 2010) THEN 'university_admin'
                WHEN _ids.k IN (2002, 2004) THEN 'center_manager'
                WHEN _ids.k = 2003 THEN 'student'
                ELSE 'teacher' END,
    full_name = CASE WHEN _ids.k BETWEEN 2005 AND 2009 THEN 'Other Institution ' || _ids.k
                     ELSE 'Teacher Number ' || _ids.k || ' Family' END,
    is_active = (_ids.k % 7 <> 0),
    created_at = now() - (_ids.k || ' seconds')::interval
  FROM _ids WHERE u.id = _ids.id;
  SELECT id INTO managerA FROM _ids WHERE k = 2002; SELECT id INTO managerB FROM _ids WHERE k = 2004;
  SELECT id INTO studentA FROM _ids WHERE k = 2003;

  -- Centre courses (k % 3 = 0) and their course-linked groups (k % 6 = 0).
  CREATE TEMP TABLE _courses ON COMMIT DROP AS
    SELECT gen_random_uuid() AS id, i.id AS teacher_id, i.k FROM _ids i WHERE i.k <= 2000 AND i.k % 3 = 0;
  INSERT INTO public.courses (id, tenant_id, teacher_id, title) SELECT id, tA, teacher_id, 'Course ' || k FROM _courses;
  INSERT INTO public.groups (tenant_id, teacher_id, name, course_id)
    SELECT tA, teacher_id, 'Section ' || k, id FROM _courses WHERE k % 6 = 0;
  -- University groups: k % 4 per teacher, every 10th archived.
  INSERT INTO public.groups (tenant_id, teacher_id, name, deleted_at)
    SELECT tA, i.id, 'Group ' || i.k || '-' || g, CASE WHEN (i.k + g) % 10 = 0 THEN now() END
    FROM _ids i CROSS JOIN generate_series(1, 3) g WHERE i.k <= 2000 AND g <= i.k % 4;
  INSERT INTO public.groups (tenant_id, teacher_id, name) SELECT tB, id, 'B group ' || k FROM _ids WHERE k BETWEEN 2005 AND 2009;
  ANALYZE public.users; ANALYZE public.groups; ANALYZE public.courses;

  -- Ground truth (as owner): the lock per teacher from the whole institution.
  CREATE TEMP TABLE _truth ON COMMIT DROP AS
    SELECT u.id,
      CASE WHEN coalesce(ug.n, 0) > 0 THEN 'sharedTeacher'
           WHEN coalesce(cg.n, 0) + coalesce(cc.n, 0) = 0 THEN 'unassignedTeacher' END AS block
    FROM public.users u
    LEFT JOIN (SELECT teacher_id, count(*) n FROM public.groups WHERE tenant_id = tA AND deleted_at IS NULL AND course_id IS NULL GROUP BY 1) ug ON ug.teacher_id = u.id
    LEFT JOIN (SELECT teacher_id, count(*) n FROM public.groups WHERE tenant_id = tA AND deleted_at IS NULL AND course_id IS NOT NULL GROUP BY 1) cg ON cg.teacher_id = u.id
    LEFT JOIN (SELECT teacher_id, count(*) n FROM public.courses WHERE tenant_id = tA AND deleted_at IS NULL GROUP BY 1) cc ON cc.teacher_id = u.id
    WHERE u.tenant_id = tA AND u.role = 'teacher';
  GRANT SELECT ON _truth TO authenticated;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', managerA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- BEFORE: page.tsx — every teacher, every live group, every live course.
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, full_name, email, is_active, created_at FROM public.users
    WHERE tenant_id = tA AND role = 'teacher' ORDER BY created_at DESC) x;
  SELECT octet_length(coalesce(json_agg(x)::text, '')) INTO sz2 FROM (
    SELECT teacher_id, course_id FROM public.groups WHERE tenant_id = tA AND deleted_at IS NULL) x;
  SELECT octet_length(coalesce(json_agg(x)::text, '')) INTO sz3 FROM (
    SELECT teacher_id FROM public.courses WHERE tenant_id = tA AND deleted_at IS NULL) x;
  r := r || format('BEFORE teachers=%s json=%s KB + groups %s KB + courses %s KB %s ms | ',
    c, sz / 1024, sz2 / 1024, sz3 / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- AFTER: page 1 + exact count + active count, then footprints of the page's 50 teachers.
  t0 := clock_timestamp();
  SELECT array_agg(id), count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO ids, c, sz FROM (
    SELECT id, full_name, email, is_active, created_at FROM public.users
    WHERE tenant_id = tA AND role = 'teacher' ORDER BY created_at DESC, id LIMIT 50 OFFSET 0) x;
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tA AND role = 'teacher';
  SELECT count(*) INTO a FROM public.users WHERE tenant_id = tA AND role = 'teacher' AND is_active;
  SELECT octet_length(coalesce(json_agg(x)::text, '')) INTO sz2 FROM (
    SELECT teacher_id, course_id FROM public.groups WHERE tenant_id = tA AND deleted_at IS NULL AND teacher_id = ANY (ids)) x;
  SELECT octet_length(coalesce(json_agg(x)::text, '')) INTO sz3 FROM (
    SELECT teacher_id FROM public.courses WHERE tenant_id = tA AND deleted_at IS NULL AND teacher_id = ANY (ids)) x;
  r := r || format('AFTER page rows=%s json=%s KB total=%s active=%s + page groups %s KB + page courses %s KB %s ms | ',
    c, sz / 1024, n, a, sz2 / 1024, sz3 / 1024, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  t0 := clock_timestamp();
  SELECT array_agg(id) INTO ids FROM (SELECT id FROM public.users WHERE tenant_id = tA AND role = 'teacher'
    ORDER BY created_at DESC, id LIMIT 50 OFFSET 1950) x;
  PERFORM 1 FROM public.groups WHERE tenant_id = tA AND deleted_at IS NULL AND teacher_id = ANY (ids);
  PERFORM 1 FROM public.courses WHERE tenant_id = tA AND deleted_at IS NULL AND teacher_id = ANY (ids);
  r := r || format('AFTER last page + footprints %s ms | ', round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- L1: lock decided page by page (through RLS) == lock from the whole institution, for every teacher.
  FOR p IN 0..39 LOOP
    SELECT array_agg(id) INTO ids FROM (SELECT id FROM public.users WHERE tenant_id = tA AND role = 'teacher'
      ORDER BY created_at DESC, id LIMIT 50 OFFSET p * 50) x;
    SELECT mism + count(*) INTO mism FROM (
      SELECT t.id,
        CASE WHEN coalesce(ug.n, 0) > 0 THEN 'sharedTeacher'
             WHEN coalesce(cg.n, 0) + coalesce(cc.n, 0) = 0 THEN 'unassignedTeacher' END AS block
      FROM unnest(ids) AS t(id)
      LEFT JOIN (SELECT teacher_id, count(*) n FROM public.groups WHERE tenant_id = tA AND deleted_at IS NULL AND course_id IS NULL AND teacher_id = ANY (ids) GROUP BY 1) ug ON ug.teacher_id = t.id
      LEFT JOIN (SELECT teacher_id, count(*) n FROM public.groups WHERE tenant_id = tA AND deleted_at IS NULL AND course_id IS NOT NULL AND teacher_id = ANY (ids) GROUP BY 1) cg ON cg.teacher_id = t.id
      LEFT JOIN (SELECT teacher_id, count(*) n FROM public.courses WHERE tenant_id = tA AND deleted_at IS NULL AND teacher_id = ANY (ids) GROUP BY 1) cc ON cc.teacher_id = t.id
    ) pagewise JOIN _truth USING (id) WHERE pagewise.block IS DISTINCT FROM _truth.block;
  END LOOP;
  SELECT count(*) INTO n FROM _truth;
  SELECT count(*) INTO c FROM _truth WHERE block IS NULL;
  r := r || format('L1 lock page-by-page == whole-institution for %s teachers: %s (centre-only %s, shared %s, unassigned %s) | ',
    n, CASE WHEN mism = 0 THEN 'PASS' ELSE 'FAIL ' || mism END, c,
    (SELECT count(*) FROM _truth WHERE block = 'sharedTeacher'), (SELECT count(*) FROM _truth WHERE block = 'unassignedTeacher'));

  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tA AND role = 'teacher' AND is_active;
  SELECT count(*) INTO c FROM generate_series(1, 2000) k WHERE k % 7 <> 0;
  r := r || format('F1 active count exact: %s | ', CASE WHEN n = c THEN 'PASS (' || n || ')' ELSE 'FAIL ' || n || '<>' || c END);
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tA AND role = 'teacher'
    AND (full_name ILIKE '%Number 1999%' OR email ILIKE '%Number 1999%');
  r := r || format('F2 search "Number 1999" = %s | ', CASE WHEN n = 1 THEN 'PASS (1)' ELSE 'FAIL ' || n END);

  -- ISOLATION (centre manager A).
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tB;
  r := r || format('I1 manager A reads tenant B users: %s | ', CASE WHEN n = 0 THEN 'PASS (0)' ELSE 'FAIL ' || n END);
  SELECT count(*) INTO n FROM public.groups WHERE tenant_id = tB;
  r := r || format('I2 manager A reads tenant B groups: %s | ', CASE WHEN n = 0 THEN 'PASS (0)' ELSE 'FAIL ' || n END);
  SELECT count(*) INTO n FROM public.users WHERE role = 'teacher' AND full_name ILIKE '%Other Institution%';
  r := r || format('I3 manager A search for B teachers: %s | ', CASE WHEN n = 0 THEN 'PASS (0)' ELSE 'FAIL ' || n END);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', managerB, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tB AND role = 'teacher';
  SELECT count(*) INTO c FROM public.users WHERE tenant_id = tA;
  SELECT count(*) INTO a FROM public.groups WHERE tenant_id = tA;
  r := r || format('I4 manager B sees its 5 teachers, none of A, no A groups: %s | ',
    CASE WHEN n = 5 AND c = 0 AND a = 0 THEN 'PASS' ELSE 'FAIL ' || n || '/' || c || '/' || a END);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', studentA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tA AND role = 'teacher';
  r := r || format('I5 a student in no group lists no teacher: %s | ', CASE WHEN n = 0 THEN 'PASS (0)' ELSE 'FAIL ' || n END);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    SELECT count(*) INTO n FROM public.users WHERE tenant_id = tA;
    r := r || format('I6 anon reads 0: %s', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ' || n END);
  EXCEPTION WHEN insufficient_privilege THEN
    r := r || 'I6 anon reads 0: PASS (42501, no access at all)';
  END;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'RESULT: %', r;
END $$;

-- Afterwards (expect 0 / 0 / 0):
SELECT (SELECT count(*) FROM auth.users WHERE email LIKE 'ct%@scale.invalid') AS leftover_auth,
       (SELECT count(*) FROM public.tenants WHERE code IN ('ZZD1', 'ZZD2')) AS leftover_tenants,
       (SELECT count(*) FROM public.groups WHERE name LIKE 'B group %' OR name LIKE 'Section %') AS leftover_groups;
