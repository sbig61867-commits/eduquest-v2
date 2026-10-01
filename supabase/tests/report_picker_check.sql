-- Batch 2 / R1 — /super-admin/reports entity picker: everything preloaded vs on-demand search.
--
-- Synthetic platform, fully rolled back:
--   institution A: 20 000 students (every 9th disabled), 500 teachers, 1 000 groups (one archived);
--   institution B:  5 000 students, 100 teachers, 10 groups; one owner (super_admin, no tenant) and admin A.
-- Read through RLS AS THE OWNER (the page and the search route both use the owner's session).
-- BEFORE = the page's four reads. AFTER = one search (src/lib/data/report-targets.ts searchReportTargets):
-- the chosen institution, role / groups, name or email ILIKE, ORDER BY name, id, LIMIT 20.
-- Ends with RAISE EXCEPTION: EVERYTHING is rolled back.
-- DIAGNOSTIC: sizes scale with rows, times do not — never extrapolate times.

DO $$
DECLARE
  tA uuid := gen_random_uuid(); tB uuid := gen_random_uuid();
  ownerX uuid; adminA uuid; archived uuid;
  t0 timestamptz; r text := ''; c bigint; sz bigint; c2 bigint; sz2 bigint; c3 bigint; sz3 bigint; c4 bigint; sz4 bigint;
  n bigint; ok boolean;
BEGIN
  SET LOCAL statement_timeout = '118s';
  INSERT INTO public.tenants (id, name, slug, code) VALUES
    (tA, 'R1 A (rolled back)', 'r1-a-' || substr(tA::text, 1, 8), 'ZZR1'),
    (tB, 'R1 B (rolled back)', 'r1-b-' || substr(tB::text, 1, 8), 'ZZR2');
  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT gen_random_uuid() AS id, g AS k FROM generate_series(1, 25602) g;
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'r1p' || k || '@scale.invalid', '{}', '{}', now(), now() FROM _ids;
  -- k=1..20000 students A, 20001..20500 teachers A, 20501..25500 students B, 25501..25600 teachers B,
  -- 25601 owner, 25602 admin A
  UPDATE public.users u SET
    tenant_id = CASE WHEN _ids.k <= 20500 OR _ids.k = 25602 THEN tA WHEN _ids.k <= 25600 THEN tB END,
    role = CASE WHEN _ids.k <= 20000 OR _ids.k BETWEEN 20501 AND 25500 THEN 'student'
                WHEN _ids.k <= 20500 OR _ids.k BETWEEN 25501 AND 25600 THEN 'teacher'
                WHEN _ids.k = 25601 THEN 'super_admin' ELSE 'university_admin' END,
    full_name = 'Person Number ' || _ids.k || ' Family Name',
    is_active = (_ids.k % 9 <> 0)
  FROM _ids WHERE u.id = _ids.id;
  SELECT id INTO ownerX FROM _ids WHERE k = 25601; SELECT id INTO adminA FROM _ids WHERE k = 25602;
  INSERT INTO public.groups (tenant_id, teacher_id, name)
    SELECT tA, (SELECT id FROM _ids WHERE k = 20001 + (g % 500)), 'Group ' || g FROM generate_series(1, 1000) g;
  INSERT INTO public.groups (tenant_id, teacher_id, name)
    SELECT tB, (SELECT id FROM _ids WHERE k = 25501 + (g % 100)), 'Group ' || g FROM generate_series(1, 10) g;
  SELECT id INTO archived FROM public.groups WHERE tenant_id = tA AND name = 'Group 7';
  UPDATE public.groups SET deleted_at = now() WHERE id = archived;
  ANALYZE public.users; ANALYZE public.groups;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', ownerX, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- BEFORE: the page's reads (every institution's teachers, groups and students).
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, full_name, email, tenant_id FROM public.users WHERE role = 'teacher' ORDER BY full_name) x;
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c2, sz2 FROM (
    SELECT id, name, tenant_id FROM public.groups ORDER BY name) x;
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c3, sz3 FROM (
    SELECT id, full_name, email, tenant_id FROM public.users WHERE role = 'student' ORDER BY full_name) x;
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c4, sz4 FROM (
    SELECT id, name FROM public.tenants ORDER BY name) x;
  r := r || format('BEFORE teachers=%s (%s KB) groups=%s (%s KB) students=%s (%s KB) tenants=%s (%s KB) total=%s KB %s ms | ',
    c, sz / 1024, c2, sz2 / 1024, c3, sz3 / 1024, c4, sz4 / 1024, (sz + sz2 + sz3 + sz4) / 1024,
    round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- AFTER: the page keeps only the institutions; each search returns <= 20 rows.
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, full_name, email FROM public.users
    WHERE tenant_id = tA AND role = 'student' AND (full_name ILIKE '%Person%' OR email ILIKE '%Person%')
    ORDER BY full_name, id LIMIT 20) x;
  r := r || format('AFTER student broad search rows=%s json=%s B %s ms | ', c, sz, round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, full_name, email FROM public.users
    WHERE tenant_id = tA AND role = 'teacher' AND (full_name ILIKE '%Number 2001%' OR email ILIKE '%Number 2001%')
    ORDER BY full_name, id LIMIT 20) x;
  r := r || format('AFTER teacher name search rows=%s json=%s B %s ms | ', c, sz, round(extract(epoch FROM clock_timestamp() - t0) * 1000));
  t0 := clock_timestamp();
  SELECT count(*), octet_length(coalesce(json_agg(x)::text, '')) INTO c, sz FROM (
    SELECT id, name FROM public.groups WHERE tenant_id = tA AND name ILIKE '%Group 1%' ORDER BY name, id LIMIT 20) x;
  r := r || format('AFTER group search rows=%s json=%s B %s ms | ', c, sz, round(extract(epoch FROM clock_timestamp() - t0) * 1000));

  -- Correctness / parity / isolation.
  SELECT count(*) INTO n FROM (SELECT id FROM public.users
    WHERE tenant_id = tA AND role = 'student' AND (full_name ILIKE '%r1p18@scale%' OR email ILIKE '%r1p18@scale%') LIMIT 20) x;
  r := r || format('P1 email search finds a DISABLED student (k=18, as the old list did): %s | ', CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL ' || n END);
  SELECT bool_and(tenant_id = tB) AND count(*) = 20 INTO ok FROM (SELECT tenant_id FROM public.users
    WHERE tenant_id = tB AND role = 'student' AND (full_name ILIKE '%Person%' OR email ILIKE '%Person%') ORDER BY full_name, id LIMIT 20) x;
  r := r || format('P2 institution B search returns only B rows: %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  SELECT count(*) INTO n FROM public.groups WHERE tenant_id = tA AND name ILIKE '%Group 7%' AND id = archived;
  r := r || format('P3 archived group not offered (RLS, as before): %s | ', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END);
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tA AND role = 'teacher' AND full_name ILIKE '%Person Number 25%';
  r := r || format('P4 a B teacher name never matches inside A: %s | ', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ' || n END);
  EXECUTE 'RESET ROLE';

  -- Defence in depth: the route refuses a non-owner before any search, and RLS still keeps an
  -- institution admin out of another institution.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adminA, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.users WHERE tenant_id = tB AND role = 'student';
  SELECT count(*) INTO c FROM public.groups WHERE tenant_id = tB;
  r := r || format('P5 admin A reads 0 of B (users %s, groups %s): %s', n, c, CASE WHEN n = 0 AND c = 0 THEN 'PASS' ELSE 'FAIL' END);
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'RESULT: %', r;
END $$;

-- Afterwards (expect 0 / 0):
SELECT (SELECT count(*) FROM auth.users WHERE email LIKE 'r1p%@scale.invalid') AS leftover_auth,
       (SELECT count(*) FROM public.tenants WHERE code IN ('ZZR1', 'ZZR2')) AS leftover_tenants;
