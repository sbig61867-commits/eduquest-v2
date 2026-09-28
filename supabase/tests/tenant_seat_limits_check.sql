-- =============================================================================
-- Plan seat limits regression check (students + teachers)
-- =============================================================================
-- Companion to supabase/tenant_seat_limits_migration.sql. Every row runs as the
-- service role / owner — the same privileges the route handlers write with —
-- because the limit must hold on the privileged path, not just behind RLS.
--
-- Expected: every A-* row "blocked …", every L-* row "works" / its stated value.
-- A single "VULNERABLE" or "BROKEN" is a release blocker.
--
-- SAFE TO RUN ANYTIME: one transaction, always rolled back, zero residue.
-- =============================================================================

begin;

create temp table r (test text, outcome text) on commit drop;

insert into public.tenants (id, name, slug, is_active, student_limit, teacher_limit) values
  ('f0000000-0000-0000-0000-00000000000a','__seat_tenant__','__seat-a__',true, 2, 1);

insert into auth.users (id, email) values
  ('f0000000-0000-0000-0000-0000000000c1','seat-s1@test.local'),
  ('f0000000-0000-0000-0000-0000000000c2','seat-s2@test.local'),
  ('f0000000-0000-0000-0000-0000000000c3','seat-s3@test.local'),
  ('f0000000-0000-0000-0000-0000000000c4','seat-s4@test.local'),
  ('f0000000-0000-0000-0000-0000000000e1','seat-t1@test.local'),
  ('f0000000-0000-0000-0000-0000000000e2','seat-t2@test.local'),
  ('f0000000-0000-0000-0000-0000000000a1','seat-a1@test.local');
-- handle_new_user made placeholder profiles (student, no tenant, not counted).

do $$ begin
  update public.users set role='student', tenant_id='f0000000-0000-0000-0000-00000000000a'
   where id in ('f0000000-0000-0000-0000-0000000000c1','f0000000-0000-0000-0000-0000000000c2');
  update public.users set role='student', tenant_id='f0000000-0000-0000-0000-00000000000a', is_active=false
   where id = 'f0000000-0000-0000-0000-0000000000c4';
  update public.users set role='teacher', tenant_id='f0000000-0000-0000-0000-00000000000a'
   where id = 'f0000000-0000-0000-0000-0000000000e1';
  insert into r values ('L-01 fill up to the limit (2 students, 1 teacher)','works');
exception when others then insert into r values ('L-01 fill up to the limit (2 students, 1 teacher)','BROKEN '||sqlerrm); end $$;

do $$ begin
  update public.users set role='student', tenant_id='f0000000-0000-0000-0000-00000000000a' where id='f0000000-0000-0000-0000-0000000000c3';
  insert into r values ('A-01 third student joins a full institution (create-user / invite path)','VULNERABLE');
exception when others then insert into r values ('A-01 third student joins a full institution (create-user / invite path)','blocked '||sqlerrm); end $$;

insert into public.invitations (id, token, role, tenant_id, is_public, expires_at, status)
values ('f0000000-0000-0000-0000-0000000000f1','seat-public-token','student','f0000000-0000-0000-0000-00000000000a',true, now() + interval '1 day','pending');
do $$ begin
  perform public.accept_invitation('seat-public-token','f0000000-0000-0000-0000-0000000000c3','Seat S3');
  insert into r values ('A-02 public student link accepted while full (Google / RPC path)','VULNERABLE');
exception when others then insert into r values ('A-02 public student link accepted while full (Google / RPC path)','blocked '||sqlerrm); end $$;

do $$ begin
  update public.users set is_active=true where id='f0000000-0000-0000-0000-0000000000c4';
  insert into r values ('A-03 re-enabling a disabled student while full','VULNERABLE');
exception when others then insert into r values ('A-03 re-enabling a disabled student while full','blocked '||sqlerrm); end $$;

do $$ begin
  update public.users set role='teacher', tenant_id='f0000000-0000-0000-0000-00000000000a' where id='f0000000-0000-0000-0000-0000000000e2';
  insert into r values ('A-04 second teacher while the teacher limit is 1','VULNERABLE');
exception when others then insert into r values ('A-04 second teacher while the teacher limit is 1','blocked '||sqlerrm); end $$;

do $$ begin
  update public.users set role='teacher' where id='f0000000-0000-0000-0000-0000000000c1';
  insert into r values ('A-05 moving a student into the full teacher role','VULNERABLE');
exception when others then insert into r values ('A-05 moving a student into the full teacher role','blocked '||sqlerrm); end $$;

do $$ begin
  update public.users set full_name='Renamed', locale='en' where id='f0000000-0000-0000-0000-0000000000c1';
  insert into r values ('L-02 existing students keep working while full (profile edit)','works');
exception when others then insert into r values ('L-02 existing students keep working while full (profile edit)','BROKEN '||sqlerrm); end $$;

do $$ begin
  update public.users set role='university_admin', tenant_id='f0000000-0000-0000-0000-00000000000a' where id='f0000000-0000-0000-0000-0000000000a1';
  insert into r values ('L-03 staff accounts are not seats (admin added while full)','works');
exception when others then insert into r values ('L-03 staff accounts are not seats (admin added while full)','BROKEN '||sqlerrm); end $$;

do $$ declare n int; begin
  update public.tenants set student_limit=0 where id='f0000000-0000-0000-0000-00000000000a';
  select count(*) into n from public.users where tenant_id='f0000000-0000-0000-0000-00000000000a' and role='student' and is_active;
  insert into r values ('L-04 lowering the limit below usage disables nobody (must be 2)', n::text);
  update public.tenants set student_limit=2 where id='f0000000-0000-0000-0000-00000000000a';
end $$;

do $$ begin
  update public.users set is_active=false where id='f0000000-0000-0000-0000-0000000000c2';
  perform public.accept_invitation('seat-public-token','f0000000-0000-0000-0000-0000000000c3','Seat S3');
  insert into r values ('L-05 a freed seat can be taken again (join after one leaves)','works');
exception when others then insert into r values ('L-05 a freed seat can be taken again (join after one leaves)','BROKEN '||sqlerrm); end $$;

do $$ begin
  update public.tenants set student_limit=null, teacher_limit=null where id='f0000000-0000-0000-0000-00000000000a';
  update public.users set is_active=true where id in ('f0000000-0000-0000-0000-0000000000c2','f0000000-0000-0000-0000-0000000000c4');
  update public.users set role='teacher', tenant_id='f0000000-0000-0000-0000-00000000000a' where id='f0000000-0000-0000-0000-0000000000e2';
  insert into r values ('L-06 owner raises / removes the limit: effective immediately','works');
exception when others then insert into r values ('L-06 owner raises / removes the limit: effective immediately','BROKEN '||sqlerrm); end $$;

do $$ declare n int; begin
  update public.tenants set student_limit=1, teacher_limit=1 where id='f0000000-0000-0000-0000-00000000000a';
  update public.tenants set is_active=false where id='f0000000-0000-0000-0000-00000000000a';
  update public.tenants set is_active=true  where id='f0000000-0000-0000-0000-00000000000a';
  select count(*) into n from public.users where tenant_id='f0000000-0000-0000-0000-00000000000a' and role in ('student','teacher') and is_active;
  insert into r values ('L-07 suspend + restore an over-limit institution restores everyone (must be 6)', n::text);
exception when others then insert into r values ('L-07 suspend + restore an over-limit institution restores everyone (must be 6)','BROKEN '||sqlerrm); end $$;

select test, outcome from r order by test;

rollback;
