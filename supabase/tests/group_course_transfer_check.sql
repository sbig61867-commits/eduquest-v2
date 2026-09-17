-- =============================================================================
-- Groups ↔ courses + student transfer regression check
-- =============================================================================
-- Run AFTER group_course_transfer_migration.sql.
-- Expected: every A-* row reads "blocked…", every L-* row reads "works" or the
-- stated value. SAFE TO RUN ANYTIME: one transaction, always rolled back.
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('e0000000-0000-0000-0000-0000000000a1','gt-manager-a@test.local'),
  ('e0000000-0000-0000-0000-0000000000a2','gt-teacher-a@test.local'),
  ('e0000000-0000-0000-0000-0000000000a3','gt-student-a@test.local'),
  ('e0000000-0000-0000-0000-0000000000a4','gt-student-a2@test.local'),
  ('e0000000-0000-0000-0000-0000000000b2','gt-teacher-b@test.local');
insert into public.tenants (id, name, slug, is_active) values
  ('e0000000-0000-0000-0000-00000000000a','__gt_tenant_a__','__gt-a__',true),
  ('e0000000-0000-0000-0000-00000000000b','__gt_tenant_b__','__gt-b__',true);
insert into public.users (id, email, full_name, role, tenant_id, is_active) values
  ('e0000000-0000-0000-0000-0000000000a1','gt-manager-a@test.local','GT Manager A','center_manager','e0000000-0000-0000-0000-00000000000a',true),
  ('e0000000-0000-0000-0000-0000000000a2','gt-teacher-a@test.local','GT Teacher A','teacher','e0000000-0000-0000-0000-00000000000a',true),
  ('e0000000-0000-0000-0000-0000000000a3','gt-student-a@test.local','GT Student A','student','e0000000-0000-0000-0000-00000000000a',true),
  ('e0000000-0000-0000-0000-0000000000a4','gt-student-a2@test.local','GT Student A2','student','e0000000-0000-0000-0000-00000000000a',true),
  ('e0000000-0000-0000-0000-0000000000b2','gt-teacher-b@test.local','GT Teacher B','teacher','e0000000-0000-0000-0000-00000000000b',true)
on conflict (id) do update set full_name=excluded.full_name, role=excluded.role, tenant_id=excluded.tenant_id, is_active=excluded.is_active;

-- Two courses in A ("level 3" and "level 2"), one in B. Each A course has one published item.
insert into public.courses (id, tenant_id, teacher_id, title, is_published, has_levels) values
  ('e0000000-0000-0000-0000-0000000000c3','e0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-0000000000a2','English 3',true,false),
  ('e0000000-0000-0000-0000-0000000000c2','e0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-0000000000a2','English 2',true,false),
  ('e0000000-0000-0000-0000-0000000000cb','e0000000-0000-0000-0000-00000000000b','e0000000-0000-0000-0000-0000000000b2','Foreign',true,false);
insert into public.course_units (id, course_id, tenant_id, title, order_index) values
  ('e0000000-0000-0000-0000-0000000000d3','e0000000-0000-0000-0000-0000000000c3','e0000000-0000-0000-0000-00000000000a','U3',0),
  ('e0000000-0000-0000-0000-0000000000d2','e0000000-0000-0000-0000-0000000000c2','e0000000-0000-0000-0000-00000000000a','U2',0);
insert into public.unit_items (id, unit_id, course_id, tenant_id, type, title, order_index, is_published) values
  ('e0000000-0000-0000-0000-0000000000f3','e0000000-0000-0000-0000-0000000000d3','e0000000-0000-0000-0000-0000000000c3','e0000000-0000-0000-0000-00000000000a','text','I3',0,true),
  ('e0000000-0000-0000-0000-0000000000f2','e0000000-0000-0000-0000-0000000000d2','e0000000-0000-0000-0000-0000000000c2','e0000000-0000-0000-0000-00000000000a','text','I2',0,true);

insert into public.groups (id, tenant_id, teacher_id, name, course_id, max_students) values
  ('e0000000-0000-0000-0000-000000000013','e0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-0000000000a2','Level 3 – evening','e0000000-0000-0000-0000-0000000000c3',null),
  ('e0000000-0000-0000-0000-000000000012','e0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-0000000000a2','Level 2 – morning','e0000000-0000-0000-0000-0000000000c2',null),
  ('e0000000-0000-0000-0000-000000000011','e0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-0000000000a2','Full group','e0000000-0000-0000-0000-0000000000c2',1);
insert into public.group_students (group_id, student_id) values
  ('e0000000-0000-0000-0000-000000000013','e0000000-0000-0000-0000-0000000000a3'),
  ('e0000000-0000-0000-0000-000000000011','e0000000-0000-0000-0000-0000000000a4');
insert into public.course_enrollments (course_id, student_id, tenant_id) values
  ('e0000000-0000-0000-0000-0000000000c3','e0000000-0000-0000-0000-0000000000a3','e0000000-0000-0000-0000-00000000000a');
insert into public.student_progress (student_id, unit_item_id, tenant_id) values
  ('e0000000-0000-0000-0000-0000000000a3','e0000000-0000-0000-0000-0000000000f3','e0000000-0000-0000-0000-00000000000a');

create temp table r (test text, outcome text) on commit drop;
grant insert, select on r to authenticated, anon;

-- ── Schema guards ────────────────────────────────────────────────────────────
do $$ begin update public.groups set course_id='e0000000-0000-0000-0000-0000000000cb' where id='e0000000-0000-0000-0000-000000000013';
  insert into r values ('A-S01 group linked to another tenant''s course','VULNERABLE');
exception when others then insert into r values ('A-S01 group linked to another tenant''s course','blocked '||sqlstate); end $$;
do $$ begin update public.groups set image_url='javascript:alert(1)' where id='e0000000-0000-0000-0000-000000000013';
  insert into r values ('A-S02 non-https group image','VULNERABLE');
exception when others then insert into r values ('A-S02 non-https group image','blocked '||sqlstate); end $$;

-- ── Transfer (service role path) ─────────────────────────────────────────────
do $$ begin perform public.transfer_student_group('e0000000-0000-0000-0000-0000000000a1','e0000000-0000-0000-0000-0000000000a3','e0000000-0000-0000-0000-000000000013','e0000000-0000-0000-0000-000000000011','requested');
  insert into r values ('A-T01 transfer into a full group','VULNERABLE');
exception when others then insert into r values ('A-T01 transfer into a full group','blocked '||sqlerrm); end $$;
do $$ begin perform public.transfer_student_group('e0000000-0000-0000-0000-0000000000a2','e0000000-0000-0000-0000-0000000000a3','e0000000-0000-0000-0000-000000000013','e0000000-0000-0000-0000-000000000012','requested');
  insert into r values ('A-T02 teacher (not staff) performs a transfer','VULNERABLE');
exception when others then insert into r values ('A-T02 teacher (not staff) performs a transfer','blocked '||sqlerrm); end $$;
do $$ begin perform public.transfer_student_group('e0000000-0000-0000-0000-0000000000a1','e0000000-0000-0000-0000-0000000000a3','e0000000-0000-0000-0000-000000000013','e0000000-0000-0000-0000-000000000012','');
  insert into r values ('A-T03 transfer without a reason','VULNERABLE');
exception when others then insert into r values ('A-T03 transfer without a reason','blocked '||sqlerrm); end $$;

do $$ declare in_old int; in_new int; enr_old int; enr_new int; prog int; t record; begin
  perform public.transfer_student_group('e0000000-0000-0000-0000-0000000000a1','e0000000-0000-0000-0000-0000000000a3','e0000000-0000-0000-0000-000000000013','e0000000-0000-0000-0000-000000000012','placement test result');
  select count(*) into in_old  from public.group_students where group_id='e0000000-0000-0000-0000-000000000013' and student_id='e0000000-0000-0000-0000-0000000000a3';
  select count(*) into in_new  from public.group_students where group_id='e0000000-0000-0000-0000-000000000012' and student_id='e0000000-0000-0000-0000-0000000000a3';
  select count(*) into enr_old from public.course_enrollments where course_id='e0000000-0000-0000-0000-0000000000c3' and student_id='e0000000-0000-0000-0000-0000000000a3';
  select count(*) into enr_new from public.course_enrollments where course_id='e0000000-0000-0000-0000-0000000000c2' and student_id='e0000000-0000-0000-0000-0000000000a3';
  select count(*) into prog    from public.student_progress where student_id='e0000000-0000-0000-0000-0000000000a3';
  select * into t from public.group_transfers where student_id='e0000000-0000-0000-0000-0000000000a3';
  insert into r values ('L-01 moved between groups (must be old=0 new=1)', 'old='||in_old||' new='||in_new);
  insert into r values ('L-02 enrolments (must be old=0 new=1)', 'old='||enr_old||' new='||enr_new);
  insert into r values ('L-03 old progress rows untouched (must be 1)', prog::text);
  insert into r values ('L-04 frozen snapshot (must be changed=true 1/1 English 3)', 'changed='||t.course_changed||' '||t.frozen_completed||'/'||t.frozen_total||' '||t.from_course_title);
exception when others then insert into r values ('L-01..04 transfer','BROKEN '||sqlstate||' '||left(sqlerrm,80)); end $$;

-- ── Reads (session client) ───────────────────────────────────────────────────
set role authenticated;
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
do $$ declare n int; begin select count(*) into n from public.group_transfers;
  insert into r values ('L-05 student reads own transfer history (must be 1)', n::text); end $$;
do $$ begin insert into public.group_transfers (tenant_id, student_id, from_group_name, to_group_name, reason) values ('e0000000-0000-0000-0000-00000000000a','e0000000-0000-0000-0000-0000000000a3','x','y','forged');
  insert into r values ('A-R01 student writes transfer history','VULNERABLE');
exception when others then insert into r values ('A-R01 student writes transfer history','blocked '||sqlstate); end $$;
do $$ begin perform public.transfer_student_group('e0000000-0000-0000-0000-0000000000a1','e0000000-0000-0000-0000-0000000000a3','e0000000-0000-0000-0000-000000000012','e0000000-0000-0000-0000-000000000013','self move');
  insert into r values ('A-R02 student calls transfer RPC directly','VULNERABLE');
exception when others then insert into r values ('A-R02 student calls transfer RPC directly','blocked '||sqlstate); end $$;
reset role;

set role authenticated;
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-0000000000a4","role":"authenticated"}';
do $$ declare n int; begin select count(*) into n from public.group_transfers;
  insert into r values ('A-R03 other student reads someone else''s history (must be 0)', case when n>0 then 'VULNERABLE ('||n||')' else 'blocked (0 rows)' end); end $$;
reset role;

select * from r order by test;
rollback;
