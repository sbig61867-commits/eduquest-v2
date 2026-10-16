-- =============================================================================
-- anon default privileges check
-- =============================================================================
-- Companion to supabase/anon_default_privileges_migration.sql. Creates probe
-- objects the way a migration would (as postgres) and reads what each role gets.
--
--   Default ACL
--   D-01  postgres/public/tables default, anon entry          -> anon=r/postgres
--   D-02  same row, authenticated + service_role entries      -> arwdDxtm/postgres (unchanged)
--   New table, RLS NOT enabled (a migration that forgot it)
--   D-03  anon ACL on the new table                           -> anon=r/postgres
--   D-04  PUBLIC entries on the new table                     -> 0
--   D-05  anon effective INSERT/UPDATE/DELETE/TRUNCATE        -> false (incl. PUBLIC + memberships)
--   D-06  anon INSERT                                         -> blocked (42501)
--   D-07  anon SELECT                                         -> ok
--   D-08  authenticated INSERT                                -> ok (unchanged)
--   Same table after ENABLE ROW LEVEL SECURITY, no policy
--   D-09  relrowsecurity                                      -> true
--   D-10  anon SELECT                                         -> ok, 0 rows
--   D-11  authenticated INSERT                                -> blocked by RLS (42501)
--   Other objects
--   D-12  new view, anon ACL                                  -> anon=r/postgres
--   D-13  new function: PUBLIC / anon EXECUTE                 -> true / true (out of scope,
--                                                                 hard rule 3 revokes per function)
--   D-14  new sequence, anon ACL                              -> anon=rwU/postgres (out of scope)
--   D-15  roles anon is a member of                           -> (none)
--   D-16  existing public tables: anon privileges             -> 32 (SELECT only, unchanged)
--
-- Before the migration D-01/D-03/D-12 read anon=arwdDxtm/postgres, D-05 true
-- and D-06 "ALLOWED".
--
-- SAFE TO RUN ANYTIME: run as postgres; one block ending in RAISE EXCEPTION,
-- so everything (probe objects included) is rolled back. The results are in
-- the error message.
-- =============================================================================

DO $chk$
DECLARE r text := ''; n int; d text; rel oid;
BEGIN
  SELECT array_to_string(defaclacl,' ') INTO d FROM pg_default_acl
   WHERE defaclrole='postgres'::regrole AND defaclnamespace='public'::regnamespace AND defaclobjtype='r';
  r := 'D-01 ' || coalesce(substring(d from 'anon=[^ ]*'), '(none)');
  r := r || ' | D-02 ' || coalesce(substring(d from 'authenticated=[^ ]*'), '(none)') || ' ' || coalesce(substring(d from 'service_role=[^ ]*'), '(none)');

  CREATE TABLE public.__defacl_probe (id int, note text);
  rel := 'public.__defacl_probe'::regclass;
  r := r || ' | D-03 ' || coalesce(substring((SELECT array_to_string(relacl,' ') FROM pg_class WHERE oid=rel) from 'anon=[^ ]*'), '(none)');
  SELECT count(*) INTO n FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid=rel AND a.grantee=0;
  r := r || ' | D-04 PUBLIC entries=' || n;
  r := r || ' | D-05 anon effective write=' || has_table_privilege('anon', rel, 'INSERT,UPDATE,DELETE,TRUNCATE');

  SET LOCAL ROLE anon;
  BEGIN INSERT INTO public.__defacl_probe VALUES (1, 'x'); r := r || ' | D-06 anon insert=ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN r := r || ' | D-06 anon insert=blocked (42501)'; END;
  BEGIN SELECT count(*) INTO n FROM public.__defacl_probe; r := r || ' | D-07 anon select=ok';
  EXCEPTION WHEN others THEN r := r || ' | D-07 anon select=' || sqlstate; END;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  BEGIN INSERT INTO public.__defacl_probe VALUES (2, 'x'); r := r || ' | D-08 authenticated insert=ok';
  EXCEPTION WHEN others THEN r := r || ' | D-08 authenticated insert=' || sqlstate; END;
  RESET ROLE;

  ALTER TABLE public.__defacl_probe ENABLE ROW LEVEL SECURITY;
  r := r || ' | D-09 rls=' || (SELECT relrowsecurity FROM pg_class WHERE oid=rel);
  SET LOCAL ROLE anon;
  BEGIN SELECT count(*) INTO n FROM public.__defacl_probe; r := r || ' | D-10 anon select=ok rows=' || n;
  EXCEPTION WHEN others THEN r := r || ' | D-10 anon select=' || sqlstate; END;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  BEGIN INSERT INTO public.__defacl_probe VALUES (3, 'x'); r := r || ' | D-11 authenticated insert=ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN r := r || ' | D-11 authenticated insert=blocked by RLS (42501)'; END;
  RESET ROLE;

  CREATE VIEW public.__defacl_probe_view AS SELECT 1 AS x;
  r := r || ' | D-12 view ' || coalesce(substring((SELECT array_to_string(relacl,' ') FROM pg_class WHERE oid='public.__defacl_probe_view'::regclass) from 'anon=[^ ]*'), '(none)');

  CREATE FUNCTION public.__defacl_probe_fn() RETURNS int LANGUAGE sql AS 'SELECT 1';
  r := r || ' | D-13 fn PUBLIC exec=' || EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                               WHERE p.oid='public.__defacl_probe_fn()'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE')
       || ' anon exec=' || has_function_privilege('anon', 'public.__defacl_probe_fn()', 'EXECUTE');

  CREATE SEQUENCE public.__defacl_probe_seq;
  r := r || ' | D-14 seq ' || coalesce(substring((SELECT array_to_string(relacl,' ') FROM pg_class WHERE oid='public.__defacl_probe_seq'::regclass) from 'anon=[^ ]*'), '(none)');

  SELECT coalesce(string_agg(r2.rolname, ','), '(none)') INTO d FROM pg_auth_members m JOIN pg_roles r2 ON r2.oid=m.roleid WHERE m.member='anon'::regrole;
  r := r || ' | D-15 anon member of=' || d;

  SELECT count(*) INTO n FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
   WHERE c.relnamespace='public'::regnamespace AND c.relname NOT LIKE '\_\_defacl%' AND a.grantee='anon'::regrole;
  r := r || ' | D-16 existing anon privs=' || n;

  RAISE EXCEPTION 'CHECK_ROLLED_BACK: %', r;
END $chk$;
