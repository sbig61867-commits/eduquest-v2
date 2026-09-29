-- =============================================================================
-- Regression check for audit_2026_09_29_migration.sql
-- =============================================================================
-- Expected AFTER the migration: every A-* row "blocked …", every L-* row
-- "works" / "true", A8 "dropped". Before it, A1 / A2 / A5 read VULNERABLE and
-- A7 errors (current_email does not exist yet).
--
-- SAFE TO RUN ANYTIME: one transaction, always rolled back, zero residue.
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('f0000000-0000-0000-0000-0000000000a3','fx-student@test.local'),
  ('f0000000-0000-0000-0000-0000000000a1','fx-admin@test.local');
insert into public.tenants (id, name, slug, is_active) values
  ('f0000000-0000-0000-0000-00000000000a','__fx_a__','__fx-a__',true);
insert into public.users (id, email, full_name, role, tenant_id, is_active) values
  ('f0000000-0000-0000-0000-0000000000a3','fx-student@test.local','FX Student','student','f0000000-0000-0000-0000-00000000000a',true),
  ('f0000000-0000-0000-0000-0000000000a1','fx-admin@test.local','FX Admin','university_admin','f0000000-0000-0000-0000-00000000000a',true)
on conflict (id) do update set role=excluded.role, tenant_id=excluded.tenant_id, email=excluded.email;

create temp table r (test text, outcome text) on commit drop;
grant insert, select on r to authenticated, anon;

-- ── Student ─────────────────────────────────────────────────────────────────
set role authenticated;
set local request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
do $$ declare n int; begin update public.users set email='rector@university.edu' where id=auth.uid(); get diagnostics n=row_count;
  insert into r values ('A1 student changes own email', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('A1 student changes own email','blocked '||sqlstate); end $$;
do $$ declare n int; begin update public.users set avatar_url='https://attacker.example/p.png' where id=auth.uid(); get diagnostics n=row_count;
  insert into r values ('A2 student changes own avatar', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('A2 student changes own avatar','blocked '||sqlstate); end $$;
do $$ declare n int; begin update public.users set role='university_admin' where id=auth.uid(); get diagnostics n=row_count;
  insert into r values ('A3 student self-promotes (existing pin)', case when n>0 then 'VULNERABLE' else 'blocked' end);
exception when others then insert into r values ('A3 student self-promotes (existing pin)','blocked '||sqlstate); end $$;
do $$ declare n int; begin update public.users set full_name='Other Name' where id=auth.uid(); get diagnostics n=row_count;
  insert into r values ('A4 student renames self (existing pin)', case when n>0 then 'VULNERABLE' else 'blocked' end);
exception when others then insert into r values ('A4 student renames self (existing pin)','blocked '||sqlstate); end $$;
do $$ declare n int; begin update public.users set locale='en' where id=auth.uid(); get diagnostics n=row_count;
  insert into r values ('L1 student switches own locale (must work)', case when n>0 then 'works' else 'BROKEN' end);
exception when others then insert into r values ('L1 student switches own locale (must work)','BROKEN '||sqlstate); end $$;
reset role;

-- ── Institution admin ───────────────────────────────────────────────────────
set role authenticated;
set local request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$ declare n int; begin update public.users set email='x@y.z' where id=auth.uid(); get diagnostics n=row_count;
  insert into r values ('A5 admin changes own email', case when n>0 then 'VULNERABLE' else 'blocked' end);
exception when others then insert into r values ('A5 admin changes own email','blocked '||sqlstate); end $$;
do $$ declare n int; begin update public.users set full_name='Dr FX Admin', locale='ar' where id=auth.uid(); get diagnostics n=row_count;
  insert into r values ('L2 admin renames self + locale (must work)', case when n>0 then 'works' else 'BROKEN' end);
exception when others then insert into r values ('L2 admin renames self + locale (must work)','BROKEN '||sqlstate); end $$;
reset role;

-- ── Anonymous / server ──────────────────────────────────────────────────────
set role anon;
do $$ begin perform public.current_email(); insert into r values ('A7 anon executes current_email', 'VULNERABLE');
exception when others then insert into r values ('A7 anon executes current_email','blocked '||sqlstate); end $$;
reset role;
do $$ declare n int; begin update public.users set email='svc@x.y' where id='f0000000-0000-0000-0000-0000000000a3'; get diagnostics n=row_count;
  insert into r values ('L4 service role (server) still writes email', case when n>0 then 'works' else 'BROKEN' end); end $$;
insert into r select 'L5 announcement-images bucket still public', (select public::text from storage.buckets where id='announcement-images');
insert into r select 'A8 storage listing policy gone',
  case when exists (select 1 from pg_policies where schemaname='storage' and policyname='announcement_images_public_read') then 'STILL THERE' else 'dropped' end;

select test, outcome from r order by test;

rollback;
