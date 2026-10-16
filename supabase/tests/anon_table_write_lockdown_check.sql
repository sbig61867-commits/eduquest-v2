-- =============================================================================
-- anon table-write lockdown check
-- =============================================================================
-- Companion to supabase/anon_table_write_lockdown_migration.sql.
--
--   A-01  anon holds no non-SELECT privilege on any public table   -> 0
--   A-02  anon still holds SELECT on the same 32 tables            -> 32
--   A-03  anon INSERT into contact_messages                         -> blocked
--   A-04  anon UPDATE of users                                      -> blocked
--   A-05  anon read of feature_flags still runs (RLS decides rows)  -> ok
--
-- Before the migration A-01 reads 32 rows' worth of privileges and A-03/A-04
-- read "blocked" too (RLS) — the difference is the SQLSTATE: 42501 from the
-- grant instead of an RLS violation.
--
-- SAFE TO RUN ANYTIME: one transaction, always rolled back, zero residue.
-- =============================================================================

begin;

create temp table _r (id text, result text) on commit drop;
grant all on _r to anon;

insert into _r
select 'A-01 anon non-SELECT table privileges', count(*)::text
from pg_class c cross join lateral aclexplode(c.relacl) a
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  and a.grantee = 'anon'::regrole and a.privilege_type <> 'SELECT';

insert into _r
select 'A-02 anon SELECT tables', count(*)::text
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  and has_table_privilege('anon', c.oid, 'SELECT');

set local role anon;

do $$ begin
  insert into public.contact_messages (name, email, message) values ('x', 'x@test.local', 'x');
  insert into _r values ('A-03 anon insert contact_messages', 'VULNERABLE');
exception when insufficient_privilege then
  insert into _r values ('A-03 anon insert contact_messages', 'blocked (42501 grant)');
when others then
  insert into _r values ('A-03 anon insert contact_messages', 'blocked (' || sqlstate || ')');
end $$;

do $$ begin
  update public.users set full_name = full_name where false;
  insert into _r values ('A-04 anon update users', 'VULNERABLE (grant held)');
exception when insufficient_privilege then
  insert into _r values ('A-04 anon update users', 'blocked (42501 grant)');
end $$;

do $$ declare n int; begin
  select count(*) into n from public.feature_flags;
  insert into _r values ('A-05 anon read feature_flags', 'ok (' || n || ' global rows)');
exception when others then
  insert into _r values ('A-05 anon read feature_flags', 'BROKEN (' || sqlstate || ')');
end $$;

reset role;

select * from _r order by id;

rollback;
