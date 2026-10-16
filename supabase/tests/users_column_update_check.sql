-- =============================================================================
-- users column-level UPDATE check
-- =============================================================================
-- Companion to supabase/users_column_update_lockdown_migration.sql. Runs every
-- write a signed-in user can send to public.users, as the real role, and says
-- whether the GRANT, RLS or nothing stopped it; then the service_role paths the
-- app uses for everything else.
--
-- App write paths through a user session (inventory 2026-10-16, two only):
--   U-01  any user: own locale   (src/components/shared/locale-switcher.tsx)
--   U-03  super_admin: own full_name (super-admin/settings/settings-client.tsx)
-- Expected after the migration:
--   U-01..U-04 allowed, U-05 refused by RLS (students cannot rename themselves)
--   X-02 allowed (super_admin renames another account: full_name is granted)
--   X-03 / X-04 "no row (0)" — RLS hides other users' rows from a regular user
--   every L-* and X-01 refused by GRANT
--   R-01 the refused values are unchanged when read back
--   S-01..S-03 allowed (service_role: institution assignment + member code
--   reissue, authorization flags, student name lock)
--   P-01 authenticated SELECT / INSERT / DELETE unchanged
--
-- SAFE TO RUN ANYTIME: run as postgres; ONE block, ONE transaction, ending in
-- RAISE EXCEPTION, so every row it writes is rolled back. Probe rows only:
-- fixed ids d0000000-…, probe institution with the explicit code ZZUPD (no
-- sequence is advanced). No network: pg_net/http are not installed and no
-- trigger on users/tenants/auth.users calls out; users/tenants are in no
-- publication. The results are in the error message.
-- =============================================================================

DO $chk$
DECLARE
  r text := ''; n int; outcome text; v text;
  t   uuid := 'd0000000-0000-0000-0000-0000000000a0';
  s   uuid := 'd0000000-0000-0000-0000-000000000011';   -- student
  s2  uuid := 'd0000000-0000-0000-0000-000000000012';   -- another student
  te  uuid := 'd0000000-0000-0000-0000-000000000021';   -- teacher
  sa  uuid := 'd0000000-0000-0000-0000-000000000031';   -- super_admin (probe)
  nw  uuid := 'd0000000-0000-0000-0000-000000000041';   -- new account, no institution yet
  te_created timestamptz; te_code text; te_email text; nw_code_before text;
  rec record;
BEGIN
  INSERT INTO public.tenants (id, name, slug, code, is_active) VALUES (t, '__upd_probe__', '__upd-probe__', 'ZZUPD', true);
  -- signup path: auth.users -> handle_new_user -> public.users -> assign_member_code
  INSERT INTO auth.users (id, email)
  SELECT u, 'upd-probe-' || right(u::text, 2) || '@test.local' FROM unnest(ARRAY[s, s2, te, sa, nw]) u;
  UPDATE public.users SET tenant_id = t, role = 'student' WHERE id IN (s, s2);
  UPDATE public.users SET tenant_id = t, role = 'teacher' WHERE id = te;
  UPDATE public.users SET tenant_id = NULL, role = 'super_admin' WHERE id = sa;
  SELECT created_at, member_code, email INTO te_created, te_code, te_email FROM public.users WHERE id = te;
  SELECT member_code INTO nw_code_before FROM public.users WHERE id = nw;

  r := 'P-01 authenticated SELECT/INSERT/DELETE='
    || has_table_privilege('authenticated', 'public.users', 'SELECT') || '/'
    || has_table_privilege('authenticated', 'public.users', 'INSERT') || '/'
    || has_table_privilege('authenticated', 'public.users', 'DELETE') || ' | ';

  FOR rec IN
    SELECT * FROM (VALUES
      -- label,                         caller, target, set clause
      ('U-01 student own locale',       s,  s,  'locale = ''en'''),
      ('U-02 teacher own locale',       te, te, 'locale = ''ar'''),
      ('U-03 super_admin own full_name', sa, sa, 'full_name = ''Owner Renamed'''),
      ('U-04 teacher own full_name',    te, te, 'full_name = ''Teacher Renamed'''),
      ('U-05 student own full_name',    s,  s,  'full_name = ''Student Renamed'''),
      ('X-02 super_admin renames another account', sa, s2, 'full_name = ''Renamed By Owner'''),
      ('X-03 student writes another student''s locale', s, s2, 'locale = ''ar'''),
      ('X-04 teacher writes a student''s full_name', te, s, 'full_name = ''Renamed By Teacher'''),
      ('L-01 role',                     s,  s,  'role = ''super_admin'''),
      ('L-02 tenant_id',                s,  s,  'tenant_id = NULL'),
      ('L-03 is_active',                s,  s,  'is_active = false'),
      ('L-04 permissions',              te, te, 'permissions = ''{"manage_students": true}''::jsonb'),
      ('L-05 can_create_courses',       te, te, 'can_create_courses = NOT coalesce(can_create_courses, false)'),
      ('L-06 is_university_student',    s,  s,  'is_university_student = NOT coalesce(is_university_student, true)'),
      ('L-07 suspended_by_tenant',      s,  s,  'suspended_by_tenant = true'),
      ('L-08 name_complete',            s,  s,  'name_complete = NOT coalesce(name_complete, false)'),
      ('L-09 email',                    te, te, 'email = ''changed@test.local'''),
      ('L-10 avatar_url',               te, te, 'avatar_url = ''https://example.invalid/a.png'''),
      ('L-11 member_code',              te, te, 'member_code = ''ZZUPD-T00000001'''),
      ('L-12 created_at',               te, te, 'created_at = now() - interval ''1 day'''),
      ('X-01 super_admin sets another account''s role', sa, s2, 'role = ''teacher''')
    ) v(label, caller, target, set_clause)
  LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', rec.caller, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      EXECUTE format('UPDATE public.users SET %s WHERE id = %L', rec.set_clause, rec.target);
      GET DIAGNOSTICS n = ROW_COUNT;
      outcome := CASE WHEN n = 1 THEN 'allowed' ELSE 'no row (' || n || ')' END;
    EXCEPTION WHEN insufficient_privilege THEN
      outcome := CASE WHEN sqlerrm ~* 'row-level security' THEN 'refused by RLS'
                      WHEN sqlerrm ~* 'permission denied' THEN 'refused by GRANT'
                      ELSE 'refused (' || sqlerrm || ')' END;
    END;
    RESET ROLE;
    r := r || rec.label || '=' || outcome || ' | ';
  END LOOP;

  -- The app writes really landed; the refused / hidden ones really did not.
  SELECT count(*) INTO n FROM public.users WHERE (id = s AND locale = 'en') OR (id = sa AND full_name = 'Owner Renamed');
  r := r || 'readback app writes=' || n || '/2 | ';
  SELECT concat_ws(',',
      CASE WHEN (SELECT role FROM public.users WHERE id = s) <> 'student' THEN 's.role' END,
      CASE WHEN (SELECT tenant_id FROM public.users WHERE id = s) IS DISTINCT FROM t THEN 's.tenant_id' END,
      CASE WHEN (SELECT is_active FROM public.users WHERE id = s) IS NOT TRUE THEN 's.is_active' END,
      CASE WHEN (SELECT role FROM public.users WHERE id = s2) <> 'student' THEN 's2.role' END,
      CASE WHEN (SELECT locale FROM public.users WHERE id = s2) IS NOT DISTINCT FROM 'ar' THEN 's2.locale' END,
      CASE WHEN (SELECT full_name FROM public.users WHERE id = s) IN ('Student Renamed', 'Renamed By Teacher') THEN 's.full_name' END,
      CASE WHEN (SELECT created_at FROM public.users WHERE id = te) IS DISTINCT FROM te_created THEN 'te.created_at' END,
      CASE WHEN (SELECT member_code FROM public.users WHERE id = te) IS DISTINCT FROM te_code THEN 'te.member_code' END,
      CASE WHEN (SELECT email FROM public.users WHERE id = te) IS DISTINCT FROM te_email THEN 'te.email' END,
      CASE WHEN (SELECT avatar_url FROM public.users WHERE id = te) IS NOT NULL THEN 'te.avatar_url' END,
      CASE WHEN (SELECT permissions FROM public.users WHERE id = te) ? 'manage_students' THEN 'te.permissions' END)
    INTO v;
  r := r || 'R-01 refused/hidden values unchanged=' || CASE WHEN v = '' THEN 'yes' ELSE 'NO: ' || v END
         || ' (X-02 landed=' || ((SELECT full_name FROM public.users WHERE id = s2) = 'Renamed By Owner') || ') | ';

  -- service_role: the API routes' client (create-user, accept-invitation,
  -- auth/callback, permissions, toggle-user, teacher-permissions,
  -- student-affiliation, student-names). It bypasses RLS; only the GRANT applies.
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  SET LOCAL ROLE service_role;
  BEGIN
    UPDATE public.users SET tenant_id = t, role = 'teacher' WHERE id = nw;
    r := r || 'S-01 service_role assigns institution+role=allowed';
  EXCEPTION WHEN others THEN r := r || 'S-01 FAILED ' || sqlstate || ' ' || sqlerrm; END;
  BEGIN
    UPDATE public.users SET permissions = '{"manage_students": true}'::jsonb, is_active = false, can_create_courses = true,
      is_university_student = false WHERE id = te;
    r := r || ' | S-02 service_role sets authorization flags=allowed';
  EXCEPTION WHEN others THEN r := r || ' | S-02 FAILED ' || sqlstate || ' ' || sqlerrm; END;
  BEGIN
    UPDATE public.users SET full_name = 'Locked Name', name_complete = true WHERE id = s;
    r := r || ' | S-03 service_role locks a student name=allowed';
  EXCEPTION WHEN others THEN r := r || ' | S-03 FAILED ' || sqlstate || ' ' || sqlerrm; END;
  RESET ROLE;
  SELECT member_code INTO v FROM public.users WHERE id = nw;
  r := r || ' | member code at signup=' || coalesce(nw_code_before, 'NULL') || ' -> after institution=' || coalesce(v, 'NULL');

  r := r || ' | service_role table UPDATE=' || has_table_privilege('service_role', 'public.users', 'UPDATE')
         || ' | authenticated table-level UPDATE=' || has_table_privilege('authenticated', 'public.users', 'UPDATE')
         || ' | authenticated UPDATE(locale)=' || has_column_privilege('authenticated', 'public.users', 'locale', 'UPDATE')
         || ' | authenticated UPDATE(role)=' || has_column_privilege('authenticated', 'public.users', 'role', 'UPDATE');

  RAISE EXCEPTION 'CHECK_ROLLED_BACK: %', r;
END $chk$;
