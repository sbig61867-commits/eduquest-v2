-- =============================================================================
-- Admin → user escalation + suspended-tenant regression check
-- =============================================================================
-- Companion to supabase/fix_admin_user_escalation_migration.sql.
--
-- Expected output: every L-* row "works" / its stated value, every A-* row
-- "blocked …". A single "VULNERABLE" or "BROKEN" is a release blocker.
-- Before the migration, A-E01..A-E04 read VULNERABLE (that is the finding).
--
-- SAFE TO RUN ANYTIME: one transaction, always rolled back, zero residue.
-- =============================================================================

begin;

create temp table r (test text, outcome text) on commit drop;
grant insert, select on r to authenticated;

insert into public.tenants (id, name, slug, is_active) values
  ('e0000000-0000-0000-0000-00000000000a','__esc_tenant_a__','__esc-a__',true)
on conflict (id) do nothing;

-- a1 admin · a2 admin (peer) · a3 teacher · a4 centre manager · a5 student
-- a6 student disabled individually · a7 auth user whose profile row is missing
insert into auth.users (id, email) values
  ('e0000000-0000-0000-0000-0000000000a1','esc-admin@test.local'),
  ('e0000000-0000-0000-0000-0000000000a2','esc-admin2@test.local'),
  ('e0000000-0000-0000-0000-0000000000a3','esc-teacher@test.local'),
  ('e0000000-0000-0000-0000-0000000000a4','esc-cm@test.local'),
  ('e0000000-0000-0000-0000-0000000000a5','esc-student@test.local'),
  ('e0000000-0000-0000-0000-0000000000a6','esc-student-off@test.local'),
  ('e0000000-0000-0000-0000-0000000000a7','esc-orphan@test.local'),
  ('e0000000-0000-0000-0000-0000000000a8','esc-joiner@test.local')
on conflict (id) do nothing;

insert into public.users (id, email, full_name, role, tenant_id, is_active) values
  ('e0000000-0000-0000-0000-0000000000a1','esc-admin@test.local','Esc Admin','university_admin','e0000000-0000-0000-0000-00000000000a',true),
  ('e0000000-0000-0000-0000-0000000000a2','esc-admin2@test.local','Esc Admin 2','university_admin','e0000000-0000-0000-0000-00000000000a',true),
  ('e0000000-0000-0000-0000-0000000000a3','esc-teacher@test.local','Esc Teacher','teacher','e0000000-0000-0000-0000-00000000000a',true),
  ('e0000000-0000-0000-0000-0000000000a4','esc-cm@test.local','Esc CM','center_manager','e0000000-0000-0000-0000-00000000000a',true),
  ('e0000000-0000-0000-0000-0000000000a5','esc-student@test.local','Esc Student','student','e0000000-0000-0000-0000-00000000000a',true),
  ('e0000000-0000-0000-0000-0000000000a6','esc-student-off@test.local','Esc Student Off','student','e0000000-0000-0000-0000-00000000000a',false),
  ('e0000000-0000-0000-0000-0000000000a8','esc-joiner@test.local','Esc Joiner','student',null,true)
on conflict (id) do update set role=excluded.role, tenant_id=excluded.tenant_id, is_active=excluded.is_active;
delete from public.users where id='e0000000-0000-0000-0000-0000000000a7';

-- ── Admin A1 through the session client (PostgREST) ─────────────────────────
set role authenticated;
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

do $$ declare n int; begin
  update public.users set role='university_admin', permissions='{}'::jsonb where id='e0000000-0000-0000-0000-0000000000a3'; get diagnostics n=row_count;
  insert into r values ('A-E01 [High] admin promotes a teacher to university_admin', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('A-E01 [High] admin promotes a teacher to university_admin','blocked '||sqlstate); end $$;

do $$ declare n int; begin
  update public.users set permissions='{"announce_to_university":true,"manage_center_staff":true}'::jsonb where id='e0000000-0000-0000-0000-0000000000a4'; get diagnostics n=row_count;
  insert into r values ('A-E02 [High] admin writes a centre manager''s capabilities directly', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('A-E02 [High] admin writes a centre manager''s capabilities directly','blocked '||sqlstate); end $$;

do $$ declare n int; begin
  update public.users set is_active=false, role='student' where id='e0000000-0000-0000-0000-0000000000a2'; get diagnostics n=row_count;
  insert into r values ('A-E03 [Medium] admin disables / demotes a peer admin', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('A-E03 [Medium] admin disables / demotes a peer admin','blocked '||sqlstate); end $$;

do $$ declare n int; begin
  insert into public.users (id, email, full_name, role, tenant_id, is_active)
    values ('e0000000-0000-0000-0000-0000000000a7','esc-orphan@test.local','Orphan','super_admin',null,true);
  get diagnostics n=row_count;
  insert into r values ('A-E04 [High] admin inserts a super_admin profile row', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('A-E04 [High] admin inserts a super_admin profile row','blocked '||sqlstate); end $$;

do $$ declare n int; begin
  update public.users set full_name='Esc Admin renamed' where id='e0000000-0000-0000-0000-0000000000a1'; get diagnostics n=row_count;
  insert into r values ('L-E01 admin still edits own profile', case when n>0 then 'works' else 'BROKEN (0 rows)' end);
exception when others then insert into r values ('L-E01 admin still edits own profile','BROKEN '||sqlstate); end $$;

-- ── Individually disabled student A6 (JWT still valid for ~1h) ──────────────
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-0000000000a6","role":"authenticated"}';
do $$ declare n int; begin
  update public.users set suspended_by_tenant=true where id='e0000000-0000-0000-0000-0000000000a6'; get diagnostics n=row_count;
  insert into r values ('A-E05 [Medium] user marks self suspended_by_tenant (restore would re-enable)', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('A-E05 [Medium] user marks self suspended_by_tenant (restore would re-enable)','blocked '||sqlstate); end $$;

reset role;

-- ── Tenant suspension cascade + invitations (service role / owner path) ─────
insert into public.invitations (id, token, role, tenant_id, is_public, expires_at, status)
values ('e0000000-0000-0000-0000-0000000000f1','esc-public-token','student','e0000000-0000-0000-0000-00000000000a',true, now() + interval '1 day','pending')
on conflict (id) do nothing;

update public.tenants set is_active=false where id='e0000000-0000-0000-0000-00000000000a';

do $$ declare on_ int; off_marked int; off_unmarked int; begin
  select count(*) filter (where is_active),
         count(*) filter (where not is_active and suspended_by_tenant),
         count(*) filter (where not is_active and not suspended_by_tenant)
    into on_, off_marked, off_unmarked
  from public.users where tenant_id='e0000000-0000-0000-0000-00000000000a';
  insert into r values ('L-S01 suspend: all off, pre-disabled unmarked (must be on=0 marked=5 unmarked=1)',
    'on='||on_||' marked='||off_marked||' unmarked='||off_unmarked);
end $$;

do $$ begin
  perform public.accept_invitation('esc-public-token','e0000000-0000-0000-0000-0000000000a8','Esc Joiner');
  insert into r values ('A-S01 [Medium] public invitation accepted into a suspended tenant','VULNERABLE');
exception when others then insert into r values ('A-S01 [Medium] public invitation accepted into a suspended tenant','blocked '||left(sqlerrm,40)); end $$;

update public.tenants set is_active=true where id='e0000000-0000-0000-0000-00000000000a';

do $$ declare on_ int; a6 boolean; begin
  select count(*) filter (where is_active) into on_ from public.users where tenant_id='e0000000-0000-0000-0000-00000000000a';
  select is_active into a6 from public.users where id='e0000000-0000-0000-0000-0000000000a6';
  insert into r values ('L-S02 restore: re-enables only what the suspension disabled (must be on=5 pre_disabled=false)',
    'on='||on_||' pre_disabled='||a6);
end $$;

do $$ declare t uuid; begin
  perform public.accept_invitation('esc-public-token','e0000000-0000-0000-0000-0000000000a8','Esc Joiner');
  select tenant_id into t from public.users where id='e0000000-0000-0000-0000-0000000000a8';
  insert into r values ('L-S03 public invitation still works for an active tenant',
    case when t = 'e0000000-0000-0000-0000-00000000000a' then 'works' else 'BROKEN' end);
exception when others then insert into r values ('L-S03 public invitation still works for an active tenant','BROKEN '||left(sqlerrm,60)); end $$;

select test, outcome from r order by test;

rollback;
