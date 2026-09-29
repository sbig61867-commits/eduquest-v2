-- =============================================================================
-- Student name privacy + lock regression check
-- =============================================================================
-- Companion to supabase/student_name_lock_migration.sql. A student registers
-- with their four-part name; only they can read all four parts
-- (student_names), everyone else sees users.full_name = first + family name,
-- and the student cannot change their name afterwards — the institution
-- corrects it through /api/admin/student-name (service role).
--
--   N-L*  legitimate paths that must keep working
--   N-A*  attempts that must be blocked
--
-- Before the migration N-A01/N-A02 read "VULNERABLE" (a student could rename
-- themselves from the browser) and the student_names rows read "N/A"; after it
-- every N-A row reads "blocked".
--
-- SAFE TO RUN ANYTIME: one transaction, always rolled back, zero residue.
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('e0000000-0000-0000-0000-0000000000a0','nm-owner@test.local'),
  ('e0000000-0000-0000-0000-0000000000a1','nm-admin@test.local'),
  ('e0000000-0000-0000-0000-0000000000a2','nm-teacher@test.local'),
  ('e0000000-0000-0000-0000-0000000000a3','nm-student@test.local'),
  ('e0000000-0000-0000-0000-0000000000a4','nm-student2@test.local')
on conflict (id) do nothing;

insert into public.tenants (id, name, slug, is_active) values
  ('e0000000-0000-0000-0000-00000000000a','__nm_tenant__','__nm-a__',true)
on conflict (id) do nothing;

insert into public.users (id, email, full_name, role, tenant_id, is_active) values
  ('e0000000-0000-0000-0000-0000000000a0','nm-owner@test.local','Nm Owner','super_admin',null,true),
  ('e0000000-0000-0000-0000-0000000000a1','nm-admin@test.local','Nm Admin','university_admin','e0000000-0000-0000-0000-00000000000a',true),
  ('e0000000-0000-0000-0000-0000000000a2','nm-teacher@test.local','Nm Teacher','teacher','e0000000-0000-0000-0000-00000000000a',true),
  ('e0000000-0000-0000-0000-0000000000a3','nm-student@test.local','Ahmad Khatib','student','e0000000-0000-0000-0000-00000000000a',true),
  ('e0000000-0000-0000-0000-0000000000a4','nm-student2@test.local','Omar Nasser','student','e0000000-0000-0000-0000-00000000000a',true)
on conflict (id) do update set full_name=excluded.full_name, role=excluded.role, tenant_id=excluded.tenant_id, is_active=excluded.is_active;

-- The first student's private four parts (what the service-role routes write).
do $$ begin
  if to_regclass('public.student_names') is not null then
    execute $q$insert into public.student_names (user_id, first_name, father_name, grandfather_name, family_name)
             values ('e0000000-0000-0000-0000-0000000000a3','Ahmad','Mahmoud','Saleh','Khatib')$q$;
    execute $q$update public.users set name_complete = true where id = 'e0000000-0000-0000-0000-0000000000a3'$q$;
  end if;
end $$;

create temp table r (test text, outcome text) on commit drop;
grant insert, select on r to authenticated, anon, service_role;

-- Reads a student_names row as the current role: 'N/A' before the migration.
create function pg_temp.names_visible() returns text language plpgsql as $$
declare n int;
begin
  if to_regclass('public.student_names') is null then return 'N/A (pre-migration)'; end if;
  execute $q$select count(*) from public.student_names where user_id = 'e0000000-0000-0000-0000-0000000000a3'$q$ into n;
  return n::text;
exception when others then return 'error ' || sqlstate;
end $$;
grant execute on function pg_temp.names_visible() to authenticated, anon;

-- ── Student (self) ───────────────────────────────────────────────────────────
set role authenticated;
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-0000000000a3","role":"authenticated"}';

insert into r values ('N-L01 student reads their own four parts',
  case pg_temp.names_visible() when '1' then 'works' when 'N/A (pre-migration)' then 'N/A (pre-migration)' else 'BROKEN (' || pg_temp.names_visible() || ')' end);

do $$ declare n int; begin
  update public.users set locale='en' where id='e0000000-0000-0000-0000-0000000000a3'; get diagnostics n=row_count;
  insert into r values ('N-L02 student still updates another own field (locale)', case when n>0 then 'works' else 'BROKEN (0 rows)' end);
exception when others then insert into r values ('N-L02 student still updates another own field (locale)','BROKEN '||sqlstate||' '||left(sqlerrm,60)); end $$;

do $$ declare n int; begin
  update public.users set full_name='Ahmad Khatib', locale='ar' where id='e0000000-0000-0000-0000-0000000000a3'; get diagnostics n=row_count;
  insert into r values ('N-L03 student write that repeats the unchanged name', case when n>0 then 'works' else 'BROKEN (0 rows)' end);
exception when others then insert into r values ('N-L03 student write that repeats the unchanged name','BROKEN '||sqlstate||' '||left(sqlerrm,60)); end $$;

do $$ declare n int; begin
  update public.users set full_name='x' where id='e0000000-0000-0000-0000-0000000000a3'; get diagnostics n=row_count;
  insert into r values ('N-A01 [High] student renames themselves', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('N-A01 [High] student renames themselves','blocked '||sqlstate); end $$;

do $$ declare n int; begin
  update public.users set locale='en', full_name='Omar Nasser' where id='e0000000-0000-0000-0000-0000000000a3'; get diagnostics n=row_count;
  insert into r values ('N-A02 [High] student takes another student''s name alongside a locale change', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('N-A02 [High] student takes another student''s name alongside a locale change','blocked '||sqlstate); end $$;

do $$ declare n int; begin
  update public.users set full_name='x' where id='e0000000-0000-0000-0000-0000000000a4'; get diagnostics n=row_count;
  insert into r values ('N-A03 [High] student renames another student', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('N-A03 [High] student renames another student','blocked '||sqlstate); end $$;

do $$ declare n int; begin
  update public.users set full_name='x', role='teacher' where id='e0000000-0000-0000-0000-0000000000a3'; get diagnostics n=row_count;
  insert into r values ('N-A04 [Critical] student escapes the lock by changing role in the same write', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('N-A04 [Critical] student escapes the lock by changing role in the same write','blocked '||sqlstate); end $$;

do $$ declare n int; begin
  if to_regclass('public.student_names') is null then insert into r values ('N-A05 [High] student rewrites their own four parts directly','N/A (pre-migration)'); return; end if;
  execute $q$update public.student_names set father_name='x' where user_id='e0000000-0000-0000-0000-0000000000a3'$q$; get diagnostics n=row_count;
  insert into r values ('N-A05 [High] student rewrites their own four parts directly', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('N-A05 [High] student rewrites their own four parts directly','blocked '||sqlstate); end $$;

do $$ declare n int; begin
  if to_regclass('public.student_names') is null then insert into r values ('N-A06 [High] student plants a four-part row for another student','N/A (pre-migration)'); return; end if;
  execute $q$insert into public.student_names (user_id, first_name, father_name, grandfather_name, family_name)
           values ('e0000000-0000-0000-0000-0000000000a4','a','b','c','d')$q$; get diagnostics n=row_count;
  insert into r values ('N-A06 [High] student plants a four-part row for another student', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('N-A06 [High] student plants a four-part row for another student','blocked '||sqlstate); end $$;

do $$ declare n int; begin
  if to_regprocedure('public.current_name_complete()') is null then insert into r values ('N-A07 [Low] student clears their own "name incomplete" flag','N/A (pre-migration)'); return; end if;
  execute $q$update public.users set name_complete = false where id='e0000000-0000-0000-0000-0000000000a3'$q$; get diagnostics n=row_count;
  insert into r values ('N-A07 [Low] student clears their own "name incomplete" flag', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('N-A07 [Low] student clears their own "name incomplete" flag','blocked '||sqlstate); end $$;

-- ── Another student ──────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-0000000000a4","role":"authenticated"}';
insert into r values ('N-A08 [High] another student reads the four parts',
  case pg_temp.names_visible() when '0' then 'blocked (0 rows)' when 'N/A (pre-migration)' then 'N/A (pre-migration)' else 'VULNERABLE (' || pg_temp.names_visible() || ')' end);

-- ── Teacher ──────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-0000000000a2","role":"authenticated"}';

insert into r values ('N-A09 [High] teacher reads the four parts',
  case pg_temp.names_visible() when '0' then 'blocked (0 rows)' when 'N/A (pre-migration)' then 'N/A (pre-migration)' else 'VULNERABLE (' || pg_temp.names_visible() || ')' end);

do $$ declare n int; begin
  update public.users set full_name='Nm Teacher Renamed' where id='e0000000-0000-0000-0000-0000000000a2'; get diagnostics n=row_count;
  insert into r values ('N-L04 teacher renames themselves', case when n>0 then 'works' else 'BROKEN (0 rows)' end);
exception when others then insert into r values ('N-L04 teacher renames themselves','BROKEN '||sqlstate||' '||left(sqlerrm,60)); end $$;

do $$ declare n int; begin
  update public.users set full_name='x' where id='e0000000-0000-0000-0000-0000000000a3'; get diagnostics n=row_count;
  insert into r values ('N-A10 [High] teacher renames a student directly', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('N-A10 [High] teacher renames a student directly','blocked '||sqlstate); end $$;

-- ── University admin ─────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

insert into r values ('N-A11 [High] university_admin reads the four parts',
  case pg_temp.names_visible() when '0' then 'blocked (0 rows)' when 'N/A (pre-migration)' then 'N/A (pre-migration)' else 'VULNERABLE (' || pg_temp.names_visible() || ')' end);

do $$ declare n int; begin
  update public.users set full_name='Nm Admin Renamed' where id='e0000000-0000-0000-0000-0000000000a1'; get diagnostics n=row_count;
  insert into r values ('N-L05 university_admin renames themselves', case when n>0 then 'works' else 'BROKEN (0 rows)' end);
exception when others then insert into r values ('N-L05 university_admin renames themselves','BROKEN '||sqlstate||' '||left(sqlerrm,60)); end $$;

do $$ declare n int; begin
  update public.users set full_name='x' where id='e0000000-0000-0000-0000-0000000000a3'; get diagnostics n=row_count;
  insert into r values ('N-A12 [Medium] university_admin renames a student directly (must use the route)', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('N-A12 [Medium] university_admin renames a student directly (must use the route)','blocked '||sqlstate); end $$;

-- ── Owner ────────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-0000000000a0","role":"authenticated"}';

insert into r values ('N-L06 super_admin reads the four parts',
  case pg_temp.names_visible() when '1' then 'works' when 'N/A (pre-migration)' then 'N/A (pre-migration)' else 'BROKEN (' || pg_temp.names_visible() || ')' end);

do $$ declare n int; begin
  update public.users set full_name='Ahmad Al-Khatib' where id='e0000000-0000-0000-0000-0000000000a3'; get diagnostics n=row_count;
  insert into r values ('N-L07 super_admin corrects a student''s name', case when n>0 then 'works' else 'BROKEN (0 rows)' end);
exception when others then insert into r values ('N-L07 super_admin corrects a student''s name','BROKEN '||sqlstate||' '||left(sqlerrm,60)); end $$;

reset role;

-- ── Anonymous ────────────────────────────────────────────────────────────────
set role anon;
insert into r values ('N-A13 [High] anon reads the four parts',
  case when pg_temp.names_visible() in ('0', 'N/A (pre-migration)') or pg_temp.names_visible() like 'error%'
       then 'blocked (' || pg_temp.names_visible() || ')' else 'VULNERABLE (' || pg_temp.names_visible() || ')' end);
reset role;

-- ── Service role (what src/lib/student-names.ts uses) ───────────────────────
set role service_role;
do $$ declare n int; begin
  update public.users set full_name='Ahmad Khatib' where id='e0000000-0000-0000-0000-0000000000a3'; get diagnostics n=row_count;
  if to_regclass('public.student_names') is not null then
    execute $q$update public.student_names set father_name='Mahmood' where user_id='e0000000-0000-0000-0000-0000000000a3'$q$;
  end if;
  insert into r values ('N-L08 service role corrects a student''s name and parts', case when n>0 then 'works' else 'BROKEN (0 rows)' end);
exception when others then insert into r values ('N-L08 service role corrects a student''s name and parts','BROKEN '||sqlstate||' '||left(sqlerrm,60)); end $$;
reset role;

-- ── Grants on the pin helpers ────────────────────────────────────────────────
insert into r values ('N-A14 [Low] anon may execute the pin helpers',
  case when to_regprocedure('public.current_full_name()') is null then 'N/A (pre-migration)'
       when has_function_privilege('anon', 'public.current_full_name()', 'EXECUTE')
         or has_function_privilege('anon', 'public.current_name_complete()', 'EXECUTE') then 'VULNERABLE'
       else 'blocked' end);
insert into r values ('N-L09 pin helpers pin search_path',
  case when to_regprocedure('public.current_full_name()') is null then 'N/A (pre-migration)'
       when (select count(*) from pg_proc
              where oid in (to_regprocedure('public.current_full_name()'), to_regprocedure('public.current_name_complete()'))
                and array_to_string(proconfig, ',') like '%search_path=public, pg_temp%') = 2 then 'works'
       else 'BROKEN (search_path not pinned)' end);

select test, outcome from r order by test;

rollback;
