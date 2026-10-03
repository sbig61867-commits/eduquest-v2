-- P-09 — regression / measurement check for supabase/groups_select_initplan_migration.sql (groups_select init-plan).
--
-- Works on either form of groups_select, so it is both the DRY RUN (the migration's ALTER POLICY first, in the same
-- transaction) and the check after applying:
--   A. the live groups_select is exactly the pre-P-09 text, or exactly that text with only the (SELECT …) wrappers
--      added (text replacement); cmd / permissive / roles / WITH CHECK as before;
--   P. performance as centre manager A (median of 5, database time only): M1 groups only, M2 memberships only,
--      M3 C1 shape (groups.* + a per-group member count, as PostgREST's group_students(count)), M5 centre-mail shape;
--      M4 = M3 without RLS; EXPLAIN facts for M3 (bare helper calls in a Filter, loops of the groups probe, time).
--      Measured on the live form, then on the OTHER form (switched inside the transaction), then on the live form
--      again (order effect);
--   B. characterization on both forms: 12 personas (owner, university admin A, centre managers A with and without
--      capabilities, teacher A, a student in 2 groups, a student in none, centre manager / teacher / student of B, a
--      session without a profile row, anon) — visible groups, visible memberships, per-group member counts (C1 shape)
--      and the centre-mail shape, against the documented rules computed without RLS, plus tenant and student
--      isolation; then both forms compared persona by persona (md5);
--   F. fingerprint of every other policy, the public functions, indexes, table grants and triggers: identical on
--      both forms.
-- Ends with RAISE EXCEPTION: the report is the error message and EVERYTHING (dataset, policy switch) is rolled back.
-- ALTER POLICY holds an ACCESS EXCLUSIVE lock on public.groups until that rollback (about a minute): run it while
-- the platform is idle.
-- Dataset: the groups part of center_rosters_baseline_check.sql — A: 1 000 groups and 19 281 memberships (group 1:
-- 300, groups 2..1000: 19), 20 000 students (every 9th disabled), 500 teachers; B: one group of 5. Section B adds one
-- membership (a student in groups 2 and 3), so its counts are 19 282.
-- DIAGNOSTIC: times are the database's only; never extrapolate them.

DO $chk$
DECLARE
  c_old CONSTANT text := '((deleted_at IS NULL) AND ((current_user_role() = ''super_admin''::text) OR ((current_user_role() <> ''student''::text) AND (tenant_id = current_tenant_id())) OR ((current_user_role() = ''student''::text) AND (id IN ( SELECT current_student_group_ids() AS current_student_group_ids)))))';
  c_new text;
  tA uuid := gen_random_uuid(); tB uuid := gen_random_uuid();
  g1 uuid; g2 uuid; g3 uuid; gB uuid; mgrA uuid; gids uuid[];
  live text; seq text[]; cur text; fp0 text; fpx text; meta0 text; metax text;
  r text := ''; ok boolean; f int; i int; qi int; c bigint; s bigint; t0 timestamptz; arr numeric[]; med numeric; line text;
  qs text[]; names text[]; ex_ms text; ex_hits text; bare boolean; loops_max bigint; m text;
  p record; own uuid[]; other_t uuid; other_g uuid; denied boolean; pass int := 0; fail int := 0; same int := 0; diff int := 0;
  vg bigint; hg text; vgs bigint; hgs text; c1n bigint; c1s bigint; c1h text; mn bigint; msum bigint; mh text;
  fg bigint; fgs bigint; xs bigint; xg bigint; g2n bigint; g2dis bigint;
BEGIN
  SET LOCAL statement_timeout = '118s';
  SET LOCAL search_path = public, pg_temp;
  c_new := replace(replace(c_old, 'current_user_role()', '( SELECT current_user_role() AS current_user_role)'),
                   'current_tenant_id()', '( SELECT current_tenant_id() AS current_tenant_id)');

  -- ── A. The live form ────────────────────────────────────────────────────
  SELECT qual, cmd || '/' || permissive || '/' || roles::text || '/' || coalesce(with_check, '-') INTO live, meta0
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'groups' AND policyname = 'groups_select';
  IF live = c_new THEN seq := ARRAY[c_new, c_old, c_new];
  ELSIF live = c_old THEN seq := ARRAY[c_old, c_new, c_old];
  ELSE RAISE EXCEPTION 'RESULT: A1 FAIL — groups_select is neither the pre-P-09 nor the P-09 text: %', live;
  END IF;
  r := r || format('A1 live groups_select = %s text exactly: PASS | ', CASE WHEN live = c_new THEN 'P-09 (wrapped)' ELSE 'pre-P-09 (bare)' END);
  ok := replace(replace(c_new, '( SELECT current_user_role() AS current_user_role)', 'current_user_role()'),
                '( SELECT current_tenant_id() AS current_tenant_id)', 'current_tenant_id()') = c_old
        AND (length(c_new) - length(replace(c_new, '( SELECT current_user_role() AS current_user_role)', ''))) / length('( SELECT current_user_role() AS current_user_role)') = 3
        AND (length(c_new) - length(replace(c_new, '( SELECT current_tenant_id() AS current_tenant_id)', ''))) / length('( SELECT current_tenant_id() AS current_tenant_id)') = 1
        AND position('current_student_group_ids() AS current_student_group_ids' IN c_new) > 0;
  r := r || format('A2 P-09 text = pre-P-09 text + 3 role and 1 tenant wrappers only: %s | ', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  r := r || format('A3 cmd/permissive/roles/with_check: %s | ', meta0);
  SELECT md5(concat_ws('#',
    (SELECT string_agg(schemaname||'.'||tablename||'.'||policyname||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,'')||':'||array_to_string(roles, ','), '|' ORDER BY schemaname, tablename, policyname)
       FROM pg_policies WHERE NOT (schemaname = 'public' AND tablename = 'groups' AND policyname = 'groups_select')),
    (SELECT string_agg(pr.oid::regprocedure::text || ':' || md5(pr.prosrc) || ':' || pr.prosecdef::text || ':' || pr.provolatile::text || ':' || coalesce(array_to_string(pr.proconfig, ','), '') || ':' || coalesce(pr.proacl::text, ''), '|' ORDER BY pr.oid::regprocedure::text)
       FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace WHERE ns.nspname = 'public'),
    (SELECT string_agg(schemaname||'.'||indexname||':'||indexdef, '|' ORDER BY schemaname, indexname) FROM pg_indexes WHERE schemaname IN ('public', 'storage', 'realtime')),
    (SELECT string_agg(table_schema||'.'||table_name||':'||grantee||':'||privilege_type, '|' ORDER BY table_schema, table_name, grantee, privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'public'),
    (SELECT string_agg(event_object_table||'.'||trigger_name||':'||action_statement||':'||event_manipulation, '|' ORDER BY event_object_table, trigger_name, event_manipulation) FROM information_schema.triggers WHERE trigger_schema = 'public')))
  INTO fp0;

  -- ── Dataset ─────────────────────────────────────────────────────────────
  INSERT INTO public.tenants (id, name, slug, code) VALUES
    (tA, 'P09 A (rolled back)', 'p09-a-' || substr(tA::text, 1, 8), 'ZZP9A'),
    (tB, 'P09 B (rolled back)', 'p09-b-' || substr(tB::text, 1, 8), 'ZZP9B');
  CREATE TEMP TABLE _ids ON COMMIT DROP AS SELECT gen_random_uuid() AS id, g AS k FROM generate_series(1, 25605) g;
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    SELECT x.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p09_' || x.k || '@scale.invalid', '{}', '{}', now(), now() FROM _ids x;
  UPDATE public.users u SET
    tenant_id = CASE WHEN x.k <= 20503 THEN tA ELSE tB END,
    role = CASE WHEN x.k <= 20000 OR x.k BETWEEN 20504 AND 25503 OR x.k = 25605 THEN 'student'
                WHEN x.k <= 20500 OR x.k BETWEEN 25504 AND 25603 THEN 'teacher'
                WHEN x.k = 20501 THEN 'university_admin'
                ELSE 'center_manager' END,
    full_name = 'Person Number ' || x.k,
    is_active = (x.k % 9 <> 0),
    created_at = now() - (x.k || ' seconds')::interval
  FROM _ids x WHERE u.id = x.id;
  SELECT x.id INTO mgrA FROM _ids x WHERE x.k = 20502;
  UPDATE public.users SET permissions = '{"manage_groups": true, "manage_courses": true}'::jsonb WHERE id = mgrA;
  UPDATE public.users SET role = 'super_admin', tenant_id = NULL WHERE id = (SELECT x.id FROM _ids x WHERE x.k = 25605);
  CREATE TEMP TABLE _groups ON COMMIT DROP AS SELECT gen_random_uuid() AS id, g FROM generate_series(1, 1000) g;
  INSERT INTO public.groups (id, tenant_id, teacher_id, name, description)
    SELECT gg.id, tA, (SELECT x.id FROM _ids x WHERE x.k = 20001 + (gg.g % 500)), 'Group ' || gg.g, 'Section of the term — group ' || gg.g FROM _groups gg;
  SELECT gg.id INTO g1 FROM _groups gg WHERE gg.g = 1; SELECT gg.id INTO g2 FROM _groups gg WHERE gg.g = 2; SELECT gg.id INTO g3 FROM _groups gg WHERE gg.g = 3;
  INSERT INTO public.group_students (group_id, student_id) SELECT g1, x.id FROM _ids x WHERE x.k BETWEEN 1 AND 300;
  INSERT INTO public.group_students (group_id, student_id)
    SELECT gg.id, x.id FROM _groups gg JOIN _ids x ON x.k BETWEEN 301 + (gg.g - 2) * 19 AND 301 + (gg.g - 2) * 19 + 18 WHERE gg.g >= 2;
  gB := gen_random_uuid();
  INSERT INTO public.groups (id, tenant_id, teacher_id, name) VALUES (gB, tB, (SELECT x.id FROM _ids x WHERE x.k = 25504), 'B group');
  INSERT INTO public.group_students (group_id, student_id) SELECT gB, x.id FROM _ids x WHERE x.k BETWEEN 20504 AND 20508;
  ANALYZE public.users; ANALYZE public.groups; ANALYZE public.group_students;
  SELECT count(*) INTO c FROM public.groups WHERE tenant_id = tA;
  SELECT count(*) INTO s FROM public.group_students gs JOIN public.groups g ON g.id = gs.group_id WHERE g.tenant_id = tA;
  r := r || format('DATASET A groups=%s memberships=%s | ', c, s);
  SELECT array_agg(id) INTO gids FROM public.groups WHERE tenant_id = tA;

  -- ── P. Performance: live form, other form, live form again ──────────────
  names := ARRAY['M1 groups', 'M2 memberships', 'M3 C1 shape', 'M5 mail shape'];
  qs := ARRAY[
    format('SELECT count(*), octet_length(coalesce(json_agg(to_jsonb(g))::text, %L)) FROM (SELECT * FROM public.groups WHERE tenant_id = %L ORDER BY created_at DESC) g', '', tA),
    format('SELECT count(*), 0::bigint FROM public.group_students WHERE group_id = ANY(%L::uuid[])', gids),
    format('SELECT count(*), octet_length(coalesce(json_agg(x.j)::text, %L)) FROM (SELECT to_jsonb(g) || jsonb_build_object(''group_students'', jsonb_build_array(jsonb_build_object(''count'', (SELECT count(*) FROM public.group_students gs WHERE gs.group_id = g.id)))) AS j FROM public.groups g WHERE g.tenant_id = %L ORDER BY g.created_at DESC) x', '', tA),
    format('SELECT count(*), octet_length(coalesce(json_agg(x)::text, %L)) FROM (SELECT g.id, g.name, (SELECT count(*) FROM public.group_students gs WHERE gs.group_id = g.id) AS member_count FROM public.groups g WHERE g.tenant_id = %L AND g.is_active ORDER BY g.name) x', '', tA)
  ];
  cur := live;
  FOR f IN 1 .. 3 LOOP
    IF seq[f] <> cur THEN
      EXECUTE format('ALTER POLICY groups_select ON public.groups USING (%s)', seq[f]);
      cur := seq[f];
    END IF;
    SELECT qual INTO line FROM pg_policies WHERE schemaname = 'public' AND tablename = 'groups' AND policyname = 'groups_select';
    IF line <> cur THEN RAISE EXCEPTION 'RESULT: policy switch did not store the expected text: %', line; END IF;
    m := CASE WHEN cur = c_new THEN 'P-09' ELSE 'pre-P-09' END || CASE WHEN f = 3 THEN ' (again)' ELSE '' END;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', mgrA, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE qs[3] INTO c, s;  -- warm-up, discarded
    FOR qi IN 1 .. array_length(qs, 1) LOOP
      arr := '{}';
      FOR i IN 1 .. 5 LOOP
        t0 := clock_timestamp(); EXECUTE qs[qi] INTO c, s;
        arr := arr || round((extract(epoch FROM clock_timestamp() - t0) * 1000)::numeric, 1);
      END LOOP;
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY v) INTO med FROM unnest(arr) v;
      r := r || format('P %s %s: rows=%s bytes=%s median=%s ms %s | ', m, names[qi], c, s, round(med, 1), arr);
    END LOOP;
    bare := false; loops_max := 0; ex_ms := '?'; ex_hits := '?';
    FOR line IN EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) ' || qs[3] LOOP
      IF line LIKE '%Filter:%' AND (line LIKE '%current_user_role()%' OR line LIKE '%current_tenant_id()%') THEN bare := true; END IF;
      IF line LIKE '%groups_pkey on groups%' AND line ~ 'loops=\d+' THEN
        loops_max := greatest(loops_max, substring(line FROM 'loops=(\d+)')::bigint);
      END IF;
      IF line LIKE 'Execution Time:%' THEN ex_ms := substring(line FROM 'Execution Time: ([0-9.]+)'); END IF;
      IF ex_hits = '?' AND line ~ 'Buffers: shared hit=\d+' THEN ex_hits := substring(line FROM 'shared hit=(\d+)'); END IF;
    END LOOP;
    r := r || format('E %s M3 EXPLAIN: bare helper calls in a Filter=%s, groups_pkey probe loops=%s, top buffers=%s, execution=%s ms | ',
      m, bare, loops_max, ex_hits, ex_ms);
    EXECUTE 'RESET ROLE';
    IF f = 1 THEN
      arr := '{}';
      FOR i IN 1 .. 5 LOOP
        t0 := clock_timestamp(); EXECUTE qs[3] INTO c, s;
        arr := arr || round((extract(epoch FROM clock_timestamp() - t0) * 1000)::numeric, 1);
      END LOOP;
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY v) INTO med FROM unnest(arr) v;
      r := r || format('P M4 C1 shape WITHOUT RLS: rows=%s median=%s ms | ', c, round(med, 1));
    END IF;
  END LOOP;

  -- ── B. Characterization on both forms ───────────────────────────────────
  INSERT INTO public.group_students (group_id, student_id) SELECT g3, x.id FROM _ids x WHERE x.k = 310;
  CREATE TEMP TABLE _p ON COMMIT DROP AS SELECT * FROM (VALUES
    (1, 'owner (super_admin)', (SELECT x.id FROM _ids x WHERE x.k = 25605), NULL::uuid, 'super'),
    (2, 'university_admin A', (SELECT x.id FROM _ids x WHERE x.k = 20501), tA, 'staff'),
    (3, 'centre manager A (manage_groups+courses)', (SELECT x.id FROM _ids x WHERE x.k = 20502), tA, 'staff'),
    (4, 'centre manager A2 (no capability)', (SELECT x.id FROM _ids x WHERE x.k = 20503), tA, 'staff'),
    (5, 'teacher A (owns 2 groups)', (SELECT x.id FROM _ids x WHERE x.k = 20001), tA, 'staff'),
    (6, 'student A in groups 2+3', (SELECT x.id FROM _ids x WHERE x.k = 310), tA, 'student'),
    (7, 'student A in no group', (SELECT x.id FROM _ids x WHERE x.k = 19500), tA, 'student'),
    (8, 'centre manager B', (SELECT x.id FROM _ids x WHERE x.k = 25604), tB, 'staff'),
    (9, 'teacher B', (SELECT x.id FROM _ids x WHERE x.k = 25504), tB, 'staff'),
    (10, 'student B', (SELECT x.id FROM _ids x WHERE x.k = 20504), tB, 'student'),
    (11, 'signed in, no profile row', gen_random_uuid(), NULL::uuid, 'none'),
    (12, 'anon (no session)', NULL::uuid, NULL::uuid, 'anon')) v(n, name, uid, tenant, kind);
  CREATE TEMP TABLE _eg (pn int, id uuid) ON COMMIT DROP;
  CREATE TEMP TABLE _egs (pn int, group_id uuid, student_id uuid) ON COMMIT DROP;
  CREATE TEMP TABLE _snap (form text, pn int, vg bigint, hg text, vgs bigint, hgs text, c1n bigint, c1s bigint, c1h text,
                           mn bigint, msum bigint, mh text, fg bigint, fgs bigint, xs bigint, xg bigint, denied boolean) ON COMMIT DROP;
  CREATE INDEX ON _eg (pn, id);
  CREATE INDEX ON _egs (pn, group_id);
  -- expected, from the documented rules, without RLS
  FOR p IN SELECT * FROM _p ORDER BY n LOOP
    IF p.kind = 'super' THEN
      INSERT INTO _eg SELECT p.n, id FROM public.groups WHERE deleted_at IS NULL;
      INSERT INTO _egs SELECT p.n, group_id, student_id FROM public.group_students;
    ELSIF p.kind = 'staff' THEN
      INSERT INTO _eg SELECT p.n, id FROM public.groups WHERE deleted_at IS NULL AND tenant_id = p.tenant;
      INSERT INTO _egs SELECT p.n, gs.group_id, gs.student_id FROM public.group_students gs
        WHERE gs.student_id = p.uid OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = gs.group_id AND g.deleted_at IS NULL AND g.tenant_id = p.tenant);
    ELSIF p.kind = 'student' THEN
      INSERT INTO _eg SELECT p.n, id FROM public.groups WHERE deleted_at IS NULL AND id IN (SELECT group_id FROM public.group_students WHERE student_id = p.uid);
      INSERT INTO _egs SELECT p.n, group_id, student_id FROM public.group_students WHERE student_id = p.uid;
    END IF;
    SELECT count(*), md5(coalesce(string_agg(e.id::text, ',' ORDER BY e.id), '')) INTO vg, hg FROM _eg e WHERE e.pn = p.n;
    SELECT count(*), md5(coalesce(string_agg(e.group_id::text || e.student_id::text, ',' ORDER BY e.group_id, e.student_id), '')) INTO vgs, hgs
      FROM _egs e WHERE e.pn = p.n;
    SELECT count(*), coalesce(sum(cnt), 0), md5(coalesce(string_agg(id::text || ':' || cnt, ',' ORDER BY id), '')) INTO c1n, c1s, c1h
      FROM (SELECT e.id, count(s2.student_id) cnt FROM _eg e LEFT JOIN _egs s2 ON s2.pn = p.n AND s2.group_id = e.id
            WHERE e.pn = p.n GROUP BY e.id) x;
    SELECT count(*), coalesce(sum(cnt), 0), md5(coalesce(string_agg(id::text || ':' || name || ':' || cnt, ',' ORDER BY name, id), '')) INTO mn, msum, mh
      FROM (SELECT g.id, g.name, count(s2.student_id) cnt FROM public.groups g JOIN _eg e ON e.pn = p.n AND e.id = g.id
            LEFT JOIN _egs s2 ON s2.pn = p.n AND s2.group_id = g.id
            WHERE g.tenant_id = coalesce(p.tenant, tA) AND g.is_active GROUP BY g.id, g.name) x;
    INSERT INTO _snap VALUES ('expected', p.n, vg, hg, vgs, hgs, c1n, c1s, c1h, mn, msum, mh, 0, 0, 0, 0, false);
  END LOOP;

  FOR f IN 1 .. 2 LOOP
    IF f = 2 THEN
      EXECUTE format('ALTER POLICY groups_select ON public.groups USING (%s)', seq[2]);
      cur := seq[2];
      SELECT md5(concat_ws('#',
        (SELECT string_agg(schemaname||'.'||tablename||'.'||policyname||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,'')||':'||array_to_string(roles, ','), '|' ORDER BY schemaname, tablename, policyname)
           FROM pg_policies WHERE NOT (schemaname = 'public' AND tablename = 'groups' AND policyname = 'groups_select')),
        (SELECT string_agg(pr.oid::regprocedure::text || ':' || md5(pr.prosrc) || ':' || pr.prosecdef::text || ':' || pr.provolatile::text || ':' || coalesce(array_to_string(pr.proconfig, ','), '') || ':' || coalesce(pr.proacl::text, ''), '|' ORDER BY pr.oid::regprocedure::text)
           FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace WHERE ns.nspname = 'public'),
        (SELECT string_agg(schemaname||'.'||indexname||':'||indexdef, '|' ORDER BY schemaname, indexname) FROM pg_indexes WHERE schemaname IN ('public', 'storage', 'realtime')),
        (SELECT string_agg(table_schema||'.'||table_name||':'||grantee||':'||privilege_type, '|' ORDER BY table_schema, table_name, grantee, privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'public'),
        (SELECT string_agg(event_object_table||'.'||trigger_name||':'||action_statement||':'||event_manipulation, '|' ORDER BY event_object_table, trigger_name, event_manipulation) FROM information_schema.triggers WHERE trigger_schema = 'public')))
      INTO fpx;
      SELECT cmd || '/' || permissive || '/' || roles::text || '/' || coalesce(with_check, '-') INTO metax
        FROM pg_policies WHERE schemaname = 'public' AND tablename = 'groups' AND policyname = 'groups_select';
    END IF;
    m := CASE WHEN cur = c_new THEN 'P-09' ELSE 'pre-P-09' END;
    FOR p IN SELECT * FROM _p ORDER BY n LOOP
      own := ARRAY(SELECT group_id FROM public.group_students WHERE student_id = p.uid);
      other_t := CASE WHEN p.tenant = tB THEN tA ELSE tB END;
      other_g := CASE WHEN p.tenant = tB THEN g1 ELSE gB END;
      denied := false;
      PERFORM set_config('request.jwt.claims', CASE WHEN p.uid IS NULL THEN '' ELSE json_build_object('sub', p.uid, 'role', 'authenticated')::text END, true);
      BEGIN
        EXECUTE CASE WHEN p.kind = 'anon' THEN 'SET LOCAL ROLE anon' ELSE 'SET LOCAL ROLE authenticated' END;
        SELECT count(*), md5(coalesce(string_agg(id::text, ',' ORDER BY id), '')) INTO vg, hg FROM public.groups;
        SELECT count(*), md5(coalesce(string_agg(group_id::text || student_id::text, ',' ORDER BY group_id, student_id), '')) INTO vgs, hgs FROM public.group_students;
        SELECT count(*), coalesce(sum(cnt), 0), md5(coalesce(string_agg(id::text || ':' || cnt, ',' ORDER BY id), '')) INTO c1n, c1s, c1h
          FROM (SELECT g.id, (SELECT count(*) FROM public.group_students gs WHERE gs.group_id = g.id) cnt FROM public.groups g) x;
        SELECT count(*), coalesce(sum(cnt), 0), md5(coalesce(string_agg(id::text || ':' || name || ':' || cnt, ',' ORDER BY name, id), '')) INTO mn, msum, mh
          FROM (SELECT g.id, g.name, (SELECT count(*) FROM public.group_students gs WHERE gs.group_id = g.id) cnt FROM public.groups g
                WHERE g.tenant_id = coalesce(p.tenant, tA) AND g.is_active) x;
        SELECT count(*) INTO fg FROM public.groups WHERE tenant_id = other_t;
        SELECT count(*) INTO fgs FROM public.group_students WHERE group_id = other_g;
        SELECT count(*) INTO xs FROM public.group_students WHERE student_id IS DISTINCT FROM p.uid;
        SELECT count(*) INTO xg FROM public.groups WHERE NOT (id = ANY(own));
        EXECUTE 'RESET ROLE';
      EXCEPTION WHEN insufficient_privilege THEN
        denied := true;
      END;
      EXECUTE 'RESET ROLE';
      INSERT INTO _snap VALUES (m, p.n, vg, hg, vgs, hgs, c1n, c1s, c1h, mn, msum, mh, fg, fgs, xs, xg, denied);
    END LOOP;
  END LOOP;

  FOR p IN SELECT pp.n, pp.name, pp.kind, a.*, e.vg evg, e.hg ehg, e.vgs evgs, e.hgs ehgs, e.c1h ec1h, e.mh emh,
                  b.hg bhg, b.hgs bhgs, b.c1h bc1h, b.mh bmh, b.denied bdenied
             FROM _p pp JOIN _snap a ON a.pn = pp.n AND a.form = 'pre-P-09'
             JOIN _snap b ON b.pn = pp.n AND b.form = 'P-09' JOIN _snap e ON e.pn = pp.n AND e.form = 'expected' ORDER BY pp.n LOOP
    ok := NOT p.denied AND p.vg = p.evg AND p.hg = p.ehg AND p.vgs = p.evgs AND p.hgs = p.ehgs AND p.c1h = p.ec1h AND p.mh = p.emh
          AND (p.kind = 'super' OR (p.fg = 0 AND p.fgs = 0)) AND (p.kind <> 'student' OR (p.xs = 0 AND p.xg = 0));
    IF ok THEN pass := pass + 1; ELSE fail := fail + 1; END IF;
    IF NOT p.bdenied AND p.bhg = p.hg AND p.bhgs = p.hgs AND p.bc1h = p.c1h AND p.bmh = p.mh THEN same := same + 1; ELSE diff := diff + 1; END IF;
    r := r || format('B%s %s: groups %s · memberships %s · C1 %s groups / sum %s · mail %s / sum %s · other tenant %s/%s%s → rules %s, P-09 = pre-P-09 %s | ',
      p.n, p.name, p.vg, p.vgs, p.c1n, p.c1s, p.mn, p.msum,
      CASE WHEN p.kind = 'super' THEN '-' ELSE p.fg::text END, CASE WHEN p.kind = 'super' THEN '-' ELSE p.fgs::text END,
      CASE WHEN p.kind = 'student' THEN format(' · others'' rows %s, groups outside own %s', p.xs, p.xg) ELSE '' END,
      CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END,
      CASE WHEN NOT p.bdenied AND p.bhg = p.hg AND p.bhgs = p.hgs AND p.bc1h = p.c1h AND p.bmh = p.mh THEN 'identical' ELSE 'DIFFERENT' END);
  END LOOP;
  r := r || format('B summary: rules %s PASS / %s FAIL; P-09 vs pre-P-09 %s identical / %s different | ', pass, fail, same, diff);
  SELECT count(*), count(*) FILTER (WHERE NOT u.is_active) INTO g2n, g2dis FROM public.group_students gs JOIN public.users u ON u.id = gs.student_id WHERE gs.group_id = g2;
  r := r || format('B mail fact: group 2 member_count %s, of which disabled %s (unchanged behaviour) | ', g2n, g2dis);

  -- ── F. Everything else unchanged ────────────────────────────────────────
  r := r || format('F1 other policies, functions, indexes, grants, triggers identical on both forms: %s | ', CASE WHEN fp0 = fpx THEN 'PASS' ELSE 'FAIL' END);
  r := r || format('F2 groups_select cmd/permissive/roles/with_check identical: %s | ', CASE WHEN meta0 = metax THEN 'PASS' ELSE 'FAIL' END);

  RAISE EXCEPTION 'RESULT: %', r;
END $chk$;
