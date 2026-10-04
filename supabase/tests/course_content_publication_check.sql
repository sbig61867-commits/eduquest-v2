-- A — regression check for supabase/a_unpublished_course_content_migration.sql (unpublished course content).
--
-- Works on either form of course_levels_select / course_units_select / unit_items_select, so it is both the DRY RUN
-- (the migration file first, in the same transaction) and the check after applying:
--   A. the live policies are exactly the pre-A form or exactly the A form (the A statements below must store the
--      same expressions as the migration file); cmd / permissive / roles / WITH CHECK identical on both forms;
--   B. 12 personas on BOTH forms — owner, university admin A, centre manager A, the courses' teacher, another
--      teacher, a student enrolled in a levelled + a flat published course, a student enrolled in nothing, a student
--      enrolled in an UNPUBLISHED course, teacher B, student B, a session without a profile row, anon:
--        * visible levels / units / items = the documented rule computed without RLS (the parent course visible
--          through the unchanged courses_select; for a student on the A form, also the whole publication chain);
--        * every non-student persona sees exactly the same rows on both forms;
--        * a student on the A form sees no row outside the chain (on the pre-A form the drafts are visible — the gap);
--        * what the course player renders (published level → unit → item, by course shape) is identical on both
--          forms and, on the A form, equals the student's visible items;
--        * nobody but the owner sees a row of another institution (whole tables, real data included);
--   C. the SECURITY DEFINER readers (get_course_progress, get_course_analytics, get_center_dashboard,
--      get_group_engagement) return identical results on both forms;
--   W. write path on the A form: a student cannot update or insert content, the courses' teacher still edits a
--      draft, another teacher cannot, a student still records progress on a published item;
--   F. fingerprint of every other policy, the public functions, indexes, table grants and triggers: identical on
--      both forms.
-- Synthetic institutions use explicit codes (ZZA1 / ZZA2) so tenant_code_seq is not consumed.
-- Ends with RAISE EXCEPTION: the report is the error message and EVERYTHING (dataset, policy switch) is rolled back.
-- ALTER POLICY holds an ACCESS EXCLUSIVE lock on the three tables until that rollback (a few seconds).

DO $chk$
DECLARE
  pre_sql CONSTANT text[] := ARRAY[
    'ALTER POLICY course_levels_select ON public.course_levels USING (EXISTS (SELECT 1 FROM public.courses c WHERE c.id = course_levels.course_id))',
    'ALTER POLICY course_units_select ON public.course_units USING (EXISTS (SELECT 1 FROM public.courses c WHERE c.id = course_units.course_id))',
    'ALTER POLICY unit_items_select ON public.unit_items USING (EXISTS (SELECT 1 FROM public.course_units cu JOIN public.courses c ON c.id = cu.course_id WHERE cu.id = unit_items.unit_id))'];
  a_sql CONSTANT text[] := ARRAY[
    'ALTER POLICY course_levels_select ON public.course_levels USING (EXISTS (SELECT 1 FROM public.courses c WHERE c.id = course_levels.course_id) AND ((SELECT public.current_user_role()) IS DISTINCT FROM ''student'' OR course_levels.is_published))',
    'ALTER POLICY course_units_select ON public.course_units USING (EXISTS (SELECT 1 FROM public.courses c WHERE c.id = course_units.course_id) AND ((SELECT public.current_user_role()) IS DISTINCT FROM ''student'' OR (course_units.is_published AND (course_units.level_id IS NULL OR EXISTS (SELECT 1 FROM public.course_levels l WHERE l.id = course_units.level_id AND l.is_published)))))',
    'ALTER POLICY unit_items_select ON public.unit_items USING (EXISTS (SELECT 1 FROM public.course_units cu JOIN public.courses c ON c.id = cu.course_id WHERE cu.id = unit_items.unit_id) AND ((SELECT public.current_user_role()) IS DISTINCT FROM ''student'' OR (unit_items.is_published AND EXISTS (SELECT 1 FROM public.course_units pu WHERE pu.id = unit_items.unit_id AND pu.is_published AND (pu.level_id IS NULL OR EXISTS (SELECT 1 FROM public.course_levels pl WHERE pl.id = pu.level_id AND pl.is_published))))))'];
  quals_sql CONSTANT text := $q$SELECT string_agg(policyname || '=' || qual, ' # ' ORDER BY policyname) FROM pg_policies
    WHERE schemaname = 'public' AND policyname IN ('course_levels_select', 'course_units_select', 'unit_items_select')$q$;
  meta_sql CONSTANT text := $q$SELECT string_agg(policyname || '/' || cmd || '/' || permissive || '/' || roles::text || '/' || coalesce(with_check, '-'), ' # ' ORDER BY policyname)
    FROM pg_policies WHERE schemaname = 'public' AND policyname IN ('course_levels_select', 'course_units_select', 'unit_items_select')$q$;
  fp_sql CONSTANT text := $q$SELECT md5(concat_ws('#',
    (SELECT string_agg(schemaname || '.' || tablename || '.' || policyname || '/' || cmd || '/' || permissive || '/' || roles::text || '/' || coalesce(qual, '') || '/' || coalesce(with_check, ''), '|' ORDER BY schemaname, tablename, policyname)
       FROM pg_policies WHERE NOT (schemaname = 'public' AND policyname IN ('course_levels_select', 'course_units_select', 'unit_items_select'))),
    (SELECT string_agg(p.oid::regprocedure::text || '/' || md5(p.prosrc) || '/' || p.prosecdef || '/' || p.provolatile::text || '/' || coalesce(array_to_string(p.proconfig, ','), '') || '/' || coalesce(array_to_string(p.proacl, ','), ''), '|' ORDER BY p.oid::regprocedure::text)
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace),
    (SELECT string_agg(schemaname || '.' || indexname || '/' || indexdef, '|' ORDER BY schemaname, indexname) FROM pg_indexes WHERE schemaname IN ('public', 'realtime', 'storage')),
    (SELECT string_agg(grantee || '/' || table_schema || '.' || table_name || '/' || privilege_type, '|' ORDER BY grantee, table_schema, table_name, privilege_type) FROM information_schema.role_table_grants WHERE table_schema = 'public'),
    (SELECT string_agg(event_object_table || '.' || trigger_name || '/' || event_manipulation || '/' || action_statement, '|' ORDER BY event_object_table, trigger_name, event_manipulation) FROM information_schema.triggers WHERE trigger_schema = 'public')))$q$;
  q_live text; q_pre text; q_a text; live_form text; meta_pre text; meta_a text; fp_pre text; fp_a text;
  tA uuid := gen_random_uuid(); tB uuid := gen_random_uuid();
  uOwn uuid := gen_random_uuid(); uUA uuid := gen_random_uuid(); uCM uuid := gen_random_uuid(); uT1 uuid := gen_random_uuid();
  uT2 uuid := gen_random_uuid(); uS1 uuid := gen_random_uuid(); uS2 uuid := gen_random_uuid(); uS3 uuid := gen_random_uuid();
  uTB uuid := gen_random_uuid(); uSB uuid := gen_random_uuid(); uNone uuid := gen_random_uuid();
  cL uuid := gen_random_uuid(); cF uuid := gen_random_uuid(); cU uuid := gen_random_uuid(); cB uuid := gen_random_uuid();
  l1 uuid := gen_random_uuid(); l2 uuid := gen_random_uuid(); lu1 uuid := gen_random_uuid();
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid(); u4 uuid := gen_random_uuid();
  uf1 uuid := gen_random_uuid(); uf2 uuid := gen_random_uuid(); uu1 uuid := gen_random_uuid(); ub1 uuid := gen_random_uuid();
  i1 uuid := gen_random_uuid(); i2 uuid := gen_random_uuid(); i3 uuid := gen_random_uuid(); i4 uuid := gen_random_uuid();
  i5 uuid := gen_random_uuid(); i6 uuid := gen_random_uuid(); if1 uuid := gen_random_uuid(); if2 uuid := gen_random_uuid();
  if3 uuid := gen_random_uuid(); iu1 uuid := gen_random_uuid(); ib1 uuid := gen_random_uuid(); ib2 uuid := gen_random_uuid();
  gA uuid := gen_random_uuid();
  frm text; p record; k int;
  v_vc uuid[]; v_vl uuid[]; v_vu uuid[]; v_vi uuid[]; v_hl text; v_hu text; v_hi text;
  v_np bigint; v_hp text; v_x bigint; v_denied boolean;
  e_l text; e_u text; e_i text; v_exp bigint; v_ok boolean; v_res text; v_n int;
  r text := ''; pass int := 0; fail int := 0; same int := 0; diff int := 0;
BEGIN
  SET LOCAL statement_timeout = '60s';
  SET LOCAL search_path = public, pg_temp;

  -- ── A. Forms ────────────────────────────────────────────────────────────
  EXECUTE quals_sql INTO q_live;
  FOR k IN 1..3 LOOP EXECUTE pre_sql[k]; END LOOP;
  EXECUTE quals_sql INTO q_pre; EXECUTE meta_sql INTO meta_pre; EXECUTE fp_sql INTO fp_pre;
  FOR k IN 1..3 LOOP EXECUTE a_sql[k]; END LOOP;
  EXECUTE quals_sql INTO q_a; EXECUTE meta_sql INTO meta_a; EXECUTE fp_sql INTO fp_a;
  live_form := CASE WHEN q_live = q_a THEN 'A' WHEN q_live = q_pre THEN 'pre-A' END;
  IF live_form IS NULL THEN
    RAISE EXCEPTION 'RESULT: A1 FAIL — the live policies are neither the pre-A nor the A form: %', q_live;
  END IF;
  r := r || format('A1 live policies = %s form exactly: PASS | ', live_form);
  r := r || format('A2 cmd/permissive/roles/with_check identical on both forms: %s (%s) | ',
                   CASE WHEN meta_pre = meta_a THEN 'PASS' ELSE 'FAIL' END, meta_a);

  -- ── Dataset (as the table owner) ────────────────────────────────────────
  INSERT INTO public.tenants (id, name, slug, code) VALUES
    (tA, 'A check A (rb)', 'a-chk-a-' || substr(tA::text, 1, 8), 'ZZA1'),
    (tB, 'A check B (rb)', 'a-chk-b-' || substr(tB::text, 1, 8), 'ZZA2');
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    SELECT x.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', x.em, '{}', '{}', now(), now()
    FROM (VALUES (uOwn, 'achk.own@aud.invalid'), (uUA, 'achk.ua@aud.invalid'), (uCM, 'achk.cm@aud.invalid'),
                 (uT1, 'achk.t1@aud.invalid'), (uT2, 'achk.t2@aud.invalid'), (uS1, 'achk.s1@aud.invalid'),
                 (uS2, 'achk.s2@aud.invalid'), (uS3, 'achk.s3@aud.invalid'), (uTB, 'achk.tb@aud.invalid'),
                 (uSB, 'achk.sb@aud.invalid')) x(id, em);
  UPDATE public.users u SET role = x.role, tenant_id = x.t, full_name = 'ACHK ' || x.role, is_active = true
    FROM (VALUES (uOwn, 'super_admin', NULL::uuid), (uUA, 'university_admin', tA), (uCM, 'center_manager', tA),
                 (uT1, 'teacher', tA), (uT2, 'teacher', tA), (uS1, 'student', tA), (uS2, 'student', tA),
                 (uS3, 'student', tA), (uTB, 'teacher', tB), (uSB, 'student', tB)) x(id, role, t)
    WHERE u.id = x.id;
  INSERT INTO public.courses (id, tenant_id, teacher_id, title, is_published, has_levels) VALUES
    (cL, tA, uT1, 'ACHK levelled', true, true), (cF, tA, uT1, 'ACHK flat', true, false),
    (cU, tA, uT1, 'ACHK unpublished', false, true), (cB, tB, uTB, 'ACHK B flat', true, false);
  INSERT INTO public.course_levels (id, course_id, tenant_id, title, order_index, is_published) VALUES
    (l1, cL, tA, 'L1 published', 1, true), (l2, cL, tA, 'L2 draft', 2, false), (lu1, cU, tA, 'LU1 published', 1, true);
  INSERT INTO public.course_units (id, level_id, course_id, tenant_id, title, order_index, is_published) VALUES
    (u1, l1, cL, tA, 'U1 published', 1, true), (u2, l1, cL, tA, 'U2 draft', 2, false),
    (u3, l2, cL, tA, 'U3 published, draft level', 1, true), (u4, l2, cL, tA, 'U4 draft, draft level', 2, false),
    (uf1, NULL, cF, tA, 'UF1 published', 1, true), (uf2, NULL, cF, tA, 'UF2 draft', 2, false),
    (uu1, lu1, cU, tA, 'UU1 published', 1, true), (ub1, NULL, cB, tB, 'UB1 published', 1, true);
  INSERT INTO public.unit_items (id, unit_id, course_id, tenant_id, type, title, content, order_index, is_published) VALUES
    (i1, u1, cL, tA, 'text', 'I1 published', '{"body":"published text"}', 1, true),
    (i2, u1, cL, tA, 'text', 'I2 draft', '{"body":"draft text"}', 2, false),
    (i3, u2, cL, tA, 'text', 'I3 published, draft unit', '{"body":"x"}', 1, true),
    (i4, u2, cL, tA, 'text', 'I4 draft, draft unit', '{"body":"x"}', 2, false),
    (i5, u3, cL, tA, 'text', 'I5 published, draft level', '{"body":"x"}', 1, true),
    (i6, u4, cL, tA, 'text', 'I6 published, draft unit + level', '{"body":"x"}', 1, true),
    (if1, uf1, cF, tA, 'text', 'IF1 published', '{"body":"x"}', 1, true),
    (if2, uf1, cF, tA, 'video', 'IF2 draft video', '{"video_url":"https://example.invalid/v"}', 2, false),
    (if3, uf2, cF, tA, 'text', 'IF3 published, draft unit', '{"body":"x"}', 1, true),
    (iu1, uu1, cU, tA, 'text', 'IU1 published, unpublished course', '{"body":"x"}', 1, true),
    (ib1, ub1, cB, tB, 'text', 'IB1 published', '{"body":"x"}', 1, true),
    (ib2, ub1, cB, tB, 'text', 'IB2 draft', '{"body":"x"}', 2, false);
  INSERT INTO public.course_enrollments (course_id, student_id, tenant_id) VALUES
    (cL, uS1, tA), (cF, uS1, tA), (cU, uS3, tA), (cB, uSB, tB);
  INSERT INTO public.groups (id, tenant_id, teacher_id, name, course_id) VALUES (gA, tA, uT1, 'ACHK group', cL);
  INSERT INTO public.group_students (group_id, student_id) VALUES (gA, uS1);
  INSERT INTO public.student_progress (student_id, tenant_id, unit_item_id) VALUES (uS1, tA, i1), (uS1, tA, i2);

  CREATE TEMP TABLE _p (n int, name text, uid uuid, kind text, tid uuid) ON COMMIT DROP;
  INSERT INTO _p VALUES
    (1, 'owner', uOwn, 'owner', NULL), (2, 'university admin A', uUA, 'staff', tA), (3, 'centre manager A', uCM, 'staff', tA),
    (4, 'teacher of the courses', uT1, 'staff', tA), (5, 'other teacher A', uT2, 'staff', tA),
    (6, 'student enrolled (levelled + flat)', uS1, 'student', tA), (7, 'student enrolled in nothing', uS2, 'student', tA),
    (8, 'student enrolled in an unpublished course', uS3, 'student', tA), (9, 'teacher B', uTB, 'staff', tB),
    (10, 'student B', uSB, 'student', tB), (11, 'session without a profile', uNone, 'none', NULL), (12, 'anon', NULL, 'anon', NULL);

  -- Every synthetic row with its publication chain, computed without RLS.
  CREATE TEMP TABLE _rows ON COMMIT DROP AS
    SELECT 'L'::text AS kind, l.id, l.course_id, l.is_published AS chain FROM public.course_levels l WHERE l.tenant_id IN (tA, tB)
    UNION ALL
    SELECT 'U', u.id, u.course_id,
           u.is_published AND (u.level_id IS NULL OR EXISTS (SELECT 1 FROM public.course_levels l WHERE l.id = u.level_id AND l.is_published))
      FROM public.course_units u WHERE u.tenant_id IN (tA, tB)
    UNION ALL
    SELECT 'I', i.id, cu.course_id,
           i.is_published AND cu.is_published AND (cu.level_id IS NULL OR EXISTS (SELECT 1 FROM public.course_levels l WHERE l.id = cu.level_id AND l.is_published))
      FROM public.unit_items i JOIN public.course_units cu ON cu.id = i.unit_id WHERE i.tenant_id IN (tA, tB);
  CREATE TEMP TABLE _snap (form text, pn int, nl int, nu int, ni int, hl text, hu text, hi text, np bigint, hp text,
                           nx bigint, nexp bigint, rules_ok boolean, denied boolean) ON COMMIT DROP;
  CREATE TEMP TABLE _fn (form text, fname text, res text) ON COMMIT DROP;

  -- ── B + C. Both forms ───────────────────────────────────────────────────
  FOREACH frm IN ARRAY ARRAY['pre-A', 'A'] LOOP
    FOR k IN 1..3 LOOP EXECUTE CASE WHEN frm = 'A' THEN a_sql[k] ELSE pre_sql[k] END; END LOOP;

    FOR p IN SELECT * FROM _p ORDER BY n LOOP
      v_denied := false; v_vc := NULL; v_vl := NULL; v_vu := NULL; v_vi := NULL; v_np := 0; v_hp := '-'; v_x := 0;
      BEGIN
        PERFORM set_config('request.jwt.claims',
          CASE WHEN p.kind = 'anon' THEN '' ELSE json_build_object('sub', p.uid, 'role', 'authenticated')::text END, true);
        EXECUTE CASE WHEN p.kind = 'anon' THEN 'SET LOCAL ROLE anon' ELSE 'SET LOCAL ROLE authenticated' END;
        SELECT array_agg(id ORDER BY id) INTO v_vc FROM public.courses WHERE tenant_id IN (tA, tB);
        SELECT array_agg(id ORDER BY id) INTO v_vl FROM public.course_levels WHERE tenant_id IN (tA, tB);
        SELECT array_agg(id ORDER BY id) INTO v_vu FROM public.course_units WHERE tenant_id IN (tA, tB);
        SELECT array_agg(id ORDER BY id) INTO v_vi FROM public.unit_items WHERE tenant_id IN (tA, tB);
        -- What the course player renders (page.tsx: published levels → units → items by course shape).
        SELECT count(*), coalesce(md5(string_agg(i.id::text, ',' ORDER BY i.id)), '-') INTO v_np, v_hp
          FROM public.unit_items i
          JOIN public.course_units u ON u.id = i.unit_id
          JOIN public.courses c ON c.id = u.course_id
          LEFT JOIN public.course_levels l ON l.id = u.level_id
         WHERE i.tenant_id IN (tA, tB) AND i.is_published AND u.is_published AND c.is_published
           AND ((c.has_levels AND l.id IS NOT NULL AND l.is_published) OR (NOT c.has_levels AND u.level_id IS NULL));
        -- Rows of another institution (whole tables, real data included).
        SELECT (SELECT count(*) FROM public.course_levels WHERE tenant_id IS DISTINCT FROM p.tid)
             + (SELECT count(*) FROM public.course_units WHERE tenant_id IS DISTINCT FROM p.tid)
             + (SELECT count(*) FROM public.unit_items WHERE tenant_id IS DISTINCT FROM p.tid) INTO v_x;
        EXECUTE 'RESET ROLE';
      EXCEPTION WHEN insufficient_privilege THEN
        -- A refused read is "no rows" (acceptable for anon only, checked below).
        v_denied := true; v_vc := NULL; v_vl := NULL; v_vu := NULL; v_vi := NULL; v_np := 0; v_hp := '-';
      END;
      v_vc := coalesce(v_vc, '{}'); v_vl := coalesce(v_vl, '{}'); v_vu := coalesce(v_vu, '{}'); v_vi := coalesce(v_vi, '{}');
      v_hl := CASE WHEN cardinality(v_vl) = 0 THEN '-' ELSE md5(array_to_string(v_vl, ',')) END;
      v_hu := CASE WHEN cardinality(v_vu) = 0 THEN '-' ELSE md5(array_to_string(v_vu, ',')) END;
      v_hi := CASE WHEN cardinality(v_vi) = 0 THEN '-' ELSE md5(array_to_string(v_vi, ',')) END;

      -- The documented rule: the parent course visible (unchanged courses_select) and, for a student on the A form,
      -- the whole publication chain.
      SELECT coalesce(md5(string_agg(id::text, ',' ORDER BY id) FILTER (WHERE kind = 'L')), '-'),
             coalesce(md5(string_agg(id::text, ',' ORDER BY id) FILTER (WHERE kind = 'U')), '-'),
             coalesce(md5(string_agg(id::text, ',' ORDER BY id) FILTER (WHERE kind = 'I')), '-')
        INTO e_l, e_u, e_i
        FROM _rows WHERE course_id = ANY (v_vc) AND (NOT (p.kind = 'student' AND frm = 'A') OR chain);
      SELECT count(*) INTO v_exp FROM _rows
       WHERE NOT chain AND ((kind = 'L' AND id = ANY (v_vl)) OR (kind = 'U' AND id = ANY (v_vu)) OR (kind = 'I' AND id = ANY (v_vi)));
      v_ok := (NOT v_denied OR p.kind = 'anon')
              AND v_hl = e_l AND v_hu = e_u AND v_hi = e_i
              AND (p.kind = 'owner' OR v_x = 0);
      INSERT INTO _snap VALUES (frm, p.n, cardinality(v_vl), cardinality(v_vu), cardinality(v_vi), v_hl, v_hu, v_hi,
        v_np, v_hp, v_x, v_exp, v_ok, v_denied);
    END LOOP;

    -- C. SECURITY DEFINER readers, each as a persona allowed to call it.
    FOR p IN SELECT * FROM (VALUES ('get_course_progress(levelled course, student)', uS1,
                                    format('SELECT coalesce(string_agg(x::text, %L ORDER BY x::text), %L) FROM public.get_course_progress(%L, %L) x', ',', '-', cL, uS1)),
                                   ('get_course_progress(flat course, student)', uS1,
                                    format('SELECT coalesce(string_agg(x::text, %L ORDER BY x::text), %L) FROM public.get_course_progress(%L, %L) x', ',', '-', cF, uS1)),
                                   ('get_course_analytics(30) as university admin', uUA,
                                    format('SELECT coalesce(string_agg(x::text, %L ORDER BY x::text), %L) FROM public.get_course_analytics(30) x', ',', '-')),
                                   ('get_center_dashboard(30) as university admin', uUA,
                                    format('SELECT coalesce(string_agg(x::text, %L ORDER BY x::text), %L) FROM public.get_center_dashboard(30) x', ',', '-')),
                                   ('get_group_engagement(group, 30) as its teacher', uT1,
                                    format('SELECT coalesce(string_agg(x::text, %L ORDER BY x::text), %L) FROM public.get_group_engagement(%L, 30) x', ',', '-', gA))
                            ) f(fname, uid, q) LOOP
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', p.uid, 'role', 'authenticated')::text, true);
        EXECUTE 'SET LOCAL ROLE authenticated';
        EXECUTE p.q INTO v_res;
        EXECUTE 'RESET ROLE';
      EXCEPTION WHEN others THEN
        v_res := 'ERR ' || SQLSTATE || ' ' || SQLERRM;
      END;
      INSERT INTO _fn VALUES (frm, p.fname, v_res);
    END LOOP;
  END LOOP;

  FOR p IN SELECT pp.n, pp.name, pp.kind, a.nl anl, a.nu anu, a.ni ani, a.np anp, a.nexp anexp, a.rules_ok aok,
                  a.hl ahl, a.hu ahu, a.hi ahi, a.hp ahp, a.nx anx,
                  b.nl bnl, b.nu bnu, b.ni bni, b.np bnp, b.nexp bnexp, b.rules_ok bok, b.hl bhl, b.hu bhu, b.hi bhi, b.hp bhp
             FROM _p pp JOIN _snap b ON b.pn = pp.n AND b.form = 'pre-A' JOIN _snap a ON a.pn = pp.n AND a.form = 'A'
            ORDER BY pp.n LOOP
    IF p.kind = 'student' THEN
      -- Student: the rule on both forms, no draft on A, the player unchanged and equal to the visible items on A.
      v_ok := p.aok AND p.bok AND p.anexp = 0 AND p.ahp = p.bhp AND p.ahp = p.ahi;
      r := r || format('B%s %s: levels/units/items pre-A %s/%s/%s (outside the chain %s) → A %s/%s/%s (outside the chain %s) · player %s → %s items, equal %s · rows of another institution %s → %s | ',
        p.n, p.name, p.bnl, p.bnu, p.bni, p.bnexp, p.anl, p.anu, p.ani, p.anexp, p.bnp, p.anp,
        CASE WHEN p.ahp = p.bhp AND p.ahp = p.ahi THEN 'yes' ELSE 'NO' END, p.anx, CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END);
    ELSE
      -- Everyone else: the rule on both forms, and exactly the same rows.
      v_ok := p.aok AND p.bok AND p.ahl = p.bhl AND p.ahu = p.bhu AND p.ahi = p.bhi;
      IF p.ahl = p.bhl AND p.ahu = p.bhu AND p.ahi = p.bhi THEN same := same + 1; ELSE diff := diff + 1; END IF;
      r := r || format('B%s %s: levels/units/items %s/%s/%s on both forms, identical %s%s → %s | ',
        p.n, p.name, p.anl, p.anu, p.ani,
        CASE WHEN p.ahl = p.bhl AND p.ahu = p.bhu AND p.ahi = p.bhi THEN 'yes' ELSE 'NO' END,
        CASE WHEN p.kind = 'owner' THEN '' ELSE format(' · rows of another institution %s', p.anx) END,
        CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END);
    END IF;
    IF v_ok THEN pass := pass + 1; ELSE fail := fail + 1; END IF;
  END LOOP;
  r := r || format('B summary: %s PASS / %s FAIL; non-student personas identical on both forms %s / different %s | ', pass, fail, same, diff);

  FOR p IN SELECT a.fname, a.res ares, b.res bres FROM _fn a JOIN _fn b ON b.fname = a.fname AND b.form = 'pre-A'
            WHERE a.form = 'A' ORDER BY a.fname LOOP
    r := r || format('C %s: identical on both forms %s (%s) | ', p.fname,
      CASE WHEN p.ares = p.bres AND p.ares NOT LIKE 'ERR%' THEN 'PASS' ELSE 'FAIL' END, left(p.ares, 140));
  END LOOP;

  -- ── W. Write path on the A form (the A form is in place after the loop) ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uS1, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.unit_items SET title = title WHERE id IN (i1, i2); GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || format('W1 enrolled student updates a published + a draft item: %s rows → %s | ', v_n, CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END);
  BEGIN
    INSERT INTO public.unit_items (unit_id, course_id, tenant_id, type, title, is_published) VALUES (u1, cL, tA, 'text', 'x', true);
    r := r || 'W2 enrolled student inserts an item: INSERTED → FAIL | ';
  EXCEPTION WHEN insufficient_privilege THEN
    r := r || format('W2 enrolled student inserts an item: refused %s → PASS | ', SQLSTATE);
  END;
  BEGIN
    INSERT INTO public.student_progress (student_id, tenant_id, unit_item_id) VALUES (uS1, tA, if1);
    r := r || 'W3 enrolled student records progress on a published item: allowed → PASS | ';
  EXCEPTION WHEN others THEN
    r := r || format('W3 enrolled student records progress on a published item: %s → FAIL | ', SQLERRM);
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uT1, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.unit_items SET title = title || '' WHERE id = i2; GET DIAGNOSTICS v_n = ROW_COUNT;
  EXECUTE 'RESET ROLE';
  r := r || format('W4 the courses'' teacher edits a draft item: %s row → %s | ', v_n, CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uT2, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.unit_items SET title = title WHERE id IN (i1, i2); GET DIAGNOSTICS v_n = ROW_COUNT;
  EXECUTE 'RESET ROLE';
  r := r || format('W5 another teacher edits the items: %s rows → %s | ', v_n, CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END);

  -- ── F. Everything else unchanged ────────────────────────────────────────
  r := r || format('F1 other policies, public functions, indexes, table grants, triggers identical on both forms: %s',
                   CASE WHEN fp_pre = fp_a THEN 'PASS' ELSE 'FAIL' END);

  RAISE EXCEPTION 'RESULT: %', r;
END $chk$;
