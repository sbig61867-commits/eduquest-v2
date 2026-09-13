-- =============================================================================
-- RLS WRITE-PATH regression check (companion to rls_isolation_check.sql)
-- =============================================================================
-- rls_isolation_check.sql only exercises SELECT. This file attacks the
-- INSERT/UPDATE path, which the first audit pass (2026-09-13) never tested and
-- where the re-verification found 1 Critical + 5 High + 2 Medium issues.
--
-- Expected output:
--   BEFORE supabase/fix_rls_write_path_migration.sql is applied: the A-* rows
--   read "VULNERABLE" (T01, T03, T04, T05, T06, T07, T09, T10 — observed live
--   on 2026-09-13).
--   AFTER it is applied: every A-* row must read "blocked", and every L-* row
--   must read "works" / the stated values. Anything else is a regression.
--
-- SAFE TO RUN ANYTIME: one transaction, always rolled back, zero residue.
-- Run in the Supabase SQL Editor (or psql). Read the final SELECT.
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('c0000000-0000-0000-0000-0000000000a1','wp-admin-a@test.local'),
  ('c0000000-0000-0000-0000-0000000000a2','wp-teacher-a@test.local'),
  ('c0000000-0000-0000-0000-0000000000a4','wp-teacher-a2@test.local'),
  ('c0000000-0000-0000-0000-0000000000a3','wp-student-a@test.local'),
  ('c0000000-0000-0000-0000-0000000000a5','wp-student-a2@test.local'),
  ('c0000000-0000-0000-0000-0000000000b2','wp-teacher-b@test.local'),
  ('c0000000-0000-0000-0000-0000000000b3','wp-student-b@test.local');
insert into public.tenants (id, name, slug, is_active) values
  ('c0000000-0000-0000-0000-00000000000a','__wp_tenant_a__','__wp-a__',true),
  ('c0000000-0000-0000-0000-00000000000b','__wp_tenant_b__','__wp-b__',true);
insert into public.users (id, email, full_name, role, tenant_id, is_active) values
  ('c0000000-0000-0000-0000-0000000000a1','wp-admin-a@test.local','WP Admin A','university_admin','c0000000-0000-0000-0000-00000000000a',true),
  ('c0000000-0000-0000-0000-0000000000a2','wp-teacher-a@test.local','WP Teacher A','teacher','c0000000-0000-0000-0000-00000000000a',true),
  ('c0000000-0000-0000-0000-0000000000a4','wp-teacher-a2@test.local','WP Teacher A2','teacher','c0000000-0000-0000-0000-00000000000a',true),
  ('c0000000-0000-0000-0000-0000000000a3','wp-student-a@test.local','WP Student A','student','c0000000-0000-0000-0000-00000000000a',true),
  ('c0000000-0000-0000-0000-0000000000a5','wp-student-a2@test.local','WP Student A2','student','c0000000-0000-0000-0000-00000000000a',true),
  ('c0000000-0000-0000-0000-0000000000b2','wp-teacher-b@test.local','WP Teacher B','teacher','c0000000-0000-0000-0000-00000000000b',true),
  ('c0000000-0000-0000-0000-0000000000b3','wp-student-b@test.local','WP Student B','student','c0000000-0000-0000-0000-00000000000b',true)
on conflict (id) do update set full_name=excluded.full_name, role=excluded.role, tenant_id=excluded.tenant_id, is_active=excluded.is_active;

insert into public.groups (id, tenant_id, teacher_id, name) values
  ('c0000000-0000-0000-0000-0000000000c1','c0000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-0000000000a2','WP Group A'),
  ('c0000000-0000-0000-0000-0000000000c2','c0000000-0000-0000-0000-00000000000b','c0000000-0000-0000-0000-0000000000b2','WP Group B');
insert into public.group_students (group_id, student_id) values
  ('c0000000-0000-0000-0000-0000000000c1','c0000000-0000-0000-0000-0000000000a3'),
  ('c0000000-0000-0000-0000-0000000000c2','c0000000-0000-0000-0000-0000000000b3');
insert into public.lessons (id, tenant_id, group_id, teacher_id, title, is_published) values
  ('c0000000-0000-0000-0000-0000000000d1','c0000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-0000000000c1','c0000000-0000-0000-0000-0000000000a2','WP Lesson A',true);
insert into public.courses (id, tenant_id, teacher_id, title, is_published) values
  ('c0000000-0000-0000-0000-0000000000e1','c0000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-0000000000a2','WP Course A',false),
  ('c0000000-0000-0000-0000-0000000000e2','c0000000-0000-0000-0000-00000000000b','c0000000-0000-0000-0000-0000000000b2','WP Course B',true);
insert into public.course_units (id, course_id, tenant_id, title, order_index) values
  ('c0000000-0000-0000-0000-0000000000f1','c0000000-0000-0000-0000-0000000000e1','c0000000-0000-0000-0000-00000000000a','WP Unit A', 0);
insert into public.exams (id, tenant_id, teacher_id, title, type, questions, is_published, course_id, group_id) values
  ('c0000000-0000-0000-0000-000000000011','c0000000-0000-0000-0000-00000000000b','c0000000-0000-0000-0000-0000000000b2','WP Exam B','exam','[{"id":"q1","correct_answer":"Y","points":10}]'::jsonb,true,'c0000000-0000-0000-0000-0000000000e2',null),
  ('c0000000-0000-0000-0000-000000000012','c0000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-0000000000a2','WP Exam A','exam','[{"id":"q1","correct_answer":"X","points":10}]'::jsonb,true,null,'c0000000-0000-0000-0000-0000000000c1');
insert into public.invitations (id, role, tenant_id, invited_by, expires_at) values
  ('c0000000-0000-0000-0000-000000000021','student','c0000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-0000000000a2', now() + interval '1 day');
insert into public.staff_requests (id, tenant_id, from_user_id, to_user_id, subject) values
  ('c0000000-0000-0000-0000-000000000031','c0000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-0000000000a2','c0000000-0000-0000-0000-0000000000a1','WP request');

create temp table r (test text, outcome text) on commit drop;
grant insert, select on r to authenticated;

-- ── Teacher A ───────────────────────────────────────────────────────────────
set role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ declare n int; begin update public.invitations set role='university_admin', is_public=true where id='c0000000-0000-0000-0000-000000000021'; get diagnostics n=row_count;
  insert into r values ('A-T01 [Critical] teacher turns own invitation into university_admin', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('A-T01 [Critical] teacher turns own invitation into university_admin','blocked '||sqlstate); end $$;
do $$ declare n int; begin insert into public.invitations (role, tenant_id, invited_by, expires_at, group_id) values ('student','c0000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-0000000000a2', now()+interval '1 day','c0000000-0000-0000-0000-0000000000c2'); get diagnostics n=row_count;
  insert into r values ('A-T03 [High] invitation into another tenant''s group', case when n>0 then 'VULNERABLE' else 'blocked' end);
exception when others then insert into r values ('A-T03 [High] invitation into another tenant''s group','blocked '||sqlstate); end $$;
do $$ declare n int; begin update public.staff_requests set status='accepted' where id='c0000000-0000-0000-0000-000000000031'; get diagnostics n=row_count;
  insert into r values ('A-T04 [Medium] sender accepts own request (state machine bypass)', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('A-T04 [Medium] sender accepts own request (state machine bypass)','blocked '||sqlstate); end $$;
do $$ declare n int; begin update public.lessons set group_id='c0000000-0000-0000-0000-0000000000c2' where id='c0000000-0000-0000-0000-0000000000d1'; get diagnostics n=row_count;
  insert into r values ('A-T05 [High] move own lesson into another tenant''s group', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('A-T05 [High] move own lesson into another tenant''s group','blocked '||sqlstate); end $$;
do $$ declare n int; begin insert into public.exams (tenant_id, teacher_id, title, type, questions, is_published, group_id) values ('c0000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-0000000000b2','inj','exam','[]'::jsonb,true,'c0000000-0000-0000-0000-0000000000c2'); get diagnostics n=row_count;
  insert into r values ('A-T06 [High] exam with spoofed teacher_id into another tenant''s group', case when n>0 then 'VULNERABLE' else 'blocked' end);
exception when others then insert into r values ('A-T06 [High] exam with spoofed teacher_id into another tenant''s group','blocked '||sqlstate); end $$;
do $$ declare n int; begin insert into public.group_students (group_id, student_id) values ('c0000000-0000-0000-0000-0000000000c1','c0000000-0000-0000-0000-0000000000b3'); get diagnostics n=row_count;
  insert into r values ('A-T07 [High] enrol another tenant''s student into own group', case when n>0 then 'VULNERABLE' else 'blocked' end);
exception when others then insert into r values ('A-T07 [High] enrol another tenant''s student into own group','blocked '||sqlstate); end $$;
do $$ declare n int; begin insert into public.course_units (course_id, tenant_id, title, order_index) values ('c0000000-0000-0000-0000-0000000000e1','c0000000-0000-0000-0000-00000000000a','owner unit', 1); get diagnostics n=row_count;
  insert into r values ('L-01 owner adds a unit to own course (must work)', case when n>0 then 'works' else 'BROKEN (0 rows)' end);
exception when others then insert into r values ('L-01 owner adds a unit to own course (must work)','BROKEN '||sqlstate||' '||left(sqlerrm,60)); end $$;
reset role;

-- ── Teacher A2 (colleague in the same tenant) ─────────────────────────────────
set role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-0000000000a4","role":"authenticated"}';
do $$ declare n int; begin insert into public.course_units (course_id, tenant_id, title, order_index) values ('c0000000-0000-0000-0000-0000000000e1','c0000000-0000-0000-0000-00000000000a','colleague unit', 2); get diagnostics n=row_count;
  insert into r values ('A-T08 [Medium] colleague adds a unit to another teacher''s course', case when n>0 then 'VULNERABLE' else 'blocked' end);
exception when others then insert into r values ('A-T08 [Medium] colleague adds a unit to another teacher''s course','blocked '||sqlstate); end $$;
reset role;

-- ── Student A ────────────────────────────────────────────────────────────────
set role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
do $$ declare n int; begin insert into public.course_enrollments (course_id, student_id, tenant_id) values ('c0000000-0000-0000-0000-0000000000e1','c0000000-0000-0000-0000-0000000000a5','c0000000-0000-0000-0000-00000000000a'); get diagnostics n=row_count;
  insert into r values ('A-T09 [Medium] student enrols another student into a course', case when n>0 then 'VULNERABLE' else 'blocked' end);
exception when others then insert into r values ('A-T09 [Medium] student enrols another student into a course','blocked '||sqlstate); end $$;
do $$ declare n int; m int; begin insert into public.course_enrollments (course_id, student_id, tenant_id) values ('c0000000-0000-0000-0000-0000000000e2','c0000000-0000-0000-0000-0000000000a3','c0000000-0000-0000-0000-00000000000a'); get diagnostics n=row_count;
  select count(*) into m from public.get_student_exams() where id='c0000000-0000-0000-0000-000000000011';
  insert into r values ('A-T10 [High] self-enrol in another tenant''s course + read its exam', case when n>0 then 'VULNERABLE (foreign exam visible='||m||')' else 'blocked' end);
exception when others then insert into r values ('A-T10 [High] self-enrol in another tenant''s course + read its exam','blocked '||sqlstate); end $$;
do $$ declare e int; l int; begin
  select count(*) into e from public.get_student_exams() where id='c0000000-0000-0000-0000-000000000012';
  select count(*) into l from public.lessons where id='c0000000-0000-0000-0000-0000000000d1';
  insert into r values ('L-02 student still sees own group exam and lesson (must be exam=1 lesson=1)', 'exam='||e||' lesson='||l);
end $$;
do $$ declare n int; begin update public.users set role='university_admin' where id='c0000000-0000-0000-0000-0000000000a3'; get diagnostics n=row_count;
  insert into r values ('A-R11 [regression] student self-promotes role', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('A-R11 [regression] student self-promotes role','blocked '||sqlstate); end $$;
do $$ declare n int; begin insert into public.exam_submissions (exam_id, student_id, tenant_id, score, max_score) values ('c0000000-0000-0000-0000-000000000012','c0000000-0000-0000-0000-0000000000a3','c0000000-0000-0000-0000-00000000000a',100,10); get diagnostics n=row_count;
  insert into r values ('A-R13 [regression] student forges exam_submissions row', case when n>0 then 'VULNERABLE' else 'blocked' end);
exception when others then insert into r values ('A-R13 [regression] student forges exam_submissions row','blocked '||sqlstate); end $$;
reset role;

insert into r select 'Z SECURITY DEFINER functions missing pg_temp (must be 0)', count(*)::text
from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
where ns.nspname='public' and p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') not like '%pg_temp%';

select * from r order by test;
rollback;
