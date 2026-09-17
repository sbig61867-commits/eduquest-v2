-- =============================================================================
-- Academic structure regression check (institution_type + academic_structure)
-- =============================================================================
-- Run AFTER institution_type_migration.sql and academic_structure_migration.sql.
-- Tenants A and B are switched to structure_mode='academic'; tenant C stays on
-- the default 'flat' (the original structure) and must reject every write.
-- Expected: every A-* row reads "blocked…", every L-* row reads "works" or the
-- stated value. Anything else is a regression.
--
-- SAFE TO RUN ANYTIME: one transaction, always rolled back, zero residue.
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('d0000000-0000-0000-0000-0000000000a1','as-admin-a@test.local'),
  ('d0000000-0000-0000-0000-0000000000a2','as-teacher-a@test.local'),
  ('d0000000-0000-0000-0000-0000000000a3','as-student-a@test.local'),
  ('d0000000-0000-0000-0000-0000000000b3','as-student-b@test.local');
insert into public.tenants (id, name, slug, is_active) values
  ('d0000000-0000-0000-0000-00000000000a','__as_tenant_a__','__as-a__',true),
  ('d0000000-0000-0000-0000-00000000000c','__as_tenant_c__','__as-c__',true);
insert into public.tenants (id, name, slug, is_active, institution_type) values
  ('d0000000-0000-0000-0000-00000000000b','__as_tenant_b__','__as-b__',true,'school');

-- Defaults are checked before A and B are switched on.
create temp table r (test text, outcome text) on commit drop;
grant insert, select on r to authenticated, anon;
insert into r select 'L-00 new tenant defaults (must be university/flat)', institution_type||'/'||structure_mode
  from public.tenants where id='d0000000-0000-0000-0000-00000000000a';

update public.tenants set structure_mode='academic'
  where id in ('d0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-00000000000b');
insert into public.users (id, email, full_name, role, tenant_id, is_active) values
  ('d0000000-0000-0000-0000-0000000000a1','as-admin-a@test.local','AS Admin A','university_admin','d0000000-0000-0000-0000-00000000000a',true),
  ('d0000000-0000-0000-0000-0000000000a2','as-teacher-a@test.local','AS Teacher A','teacher','d0000000-0000-0000-0000-00000000000a',true),
  ('d0000000-0000-0000-0000-0000000000a3','as-student-a@test.local','AS Student A','student','d0000000-0000-0000-0000-00000000000a',true),
  ('d0000000-0000-0000-0000-0000000000b3','as-student-b@test.local','AS Student B','student','d0000000-0000-0000-0000-00000000000b',true)
on conflict (id) do update set full_name=excluded.full_name, role=excluded.role, tenant_id=excluded.tenant_id, is_active=excluded.is_active;

-- Seed as the service role (how /api/academic/* writes).
insert into public.academic_units (id, tenant_id, level, name) values
  ('d0000000-0000-0000-0000-0000000000e1','d0000000-0000-0000-0000-00000000000a',1,'Faculty A'),
  ('d0000000-0000-0000-0000-0000000000e2','d0000000-0000-0000-0000-00000000000b',1,'Stage B');
insert into public.academic_terms (id, tenant_id, name, starts_on, ends_on, is_current) values
  ('d0000000-0000-0000-0000-0000000000f1','d0000000-0000-0000-0000-00000000000a','Term A','2026-09-01','2027-01-31',true),
  ('d0000000-0000-0000-0000-0000000000f2','d0000000-0000-0000-0000-00000000000b','Term B','2026-09-01','2027-01-31',true);
insert into public.groups (id, tenant_id, teacher_id, name) values
  ('d0000000-0000-0000-0000-0000000000c1','d0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-0000000000a2','AS Group A');

-- ── Schema-level guards (service role) ───────────────────────────────────────
do $$ begin insert into public.tenants (name, slug, institution_type) values ('x','__as-bad__','hospital');
  insert into r values ('A-S01 invalid institution_type','VULNERABLE');
exception when others then insert into r values ('A-S01 invalid institution_type','blocked '||sqlstate); end $$;
do $$ begin insert into public.academic_units (tenant_id, parent_id, level, name) values ('d0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-0000000000e2',2,'cross');
  insert into r values ('A-S02 level-2 unit under another tenant''s parent','VULNERABLE');
exception when others then insert into r values ('A-S02 level-2 unit under another tenant''s parent','blocked '||sqlstate); end $$;
do $$ begin insert into public.academic_units (tenant_id, level, name) values ('d0000000-0000-0000-0000-00000000000a',2,'orphan');
  insert into r values ('A-S03 level-2 unit without parent','VULNERABLE');
exception when others then insert into r values ('A-S03 level-2 unit without parent','blocked '||sqlstate); end $$;
do $$ begin insert into public.academic_terms (tenant_id, name, starts_on, ends_on, is_current) values ('d0000000-0000-0000-0000-00000000000a','Term A2','2027-02-01','2027-06-30',true);
  insert into r values ('A-S04 second current term in one tenant','VULNERABLE');
exception when others then insert into r values ('A-S04 second current term in one tenant','blocked '||sqlstate); end $$;
do $$ begin update public.groups set academic_unit_id='d0000000-0000-0000-0000-0000000000e2' where id='d0000000-0000-0000-0000-0000000000c1';
  insert into r values ('A-S05 group linked to another tenant''s unit','VULNERABLE');
exception when others then insert into r values ('A-S05 group linked to another tenant''s unit','blocked '||sqlstate); end $$;
do $$ begin update public.groups set term_id='d0000000-0000-0000-0000-0000000000f2' where id='d0000000-0000-0000-0000-0000000000c1';
  insert into r values ('A-S06 group linked to another tenant''s term','VULNERABLE');
exception when others then insert into r values ('A-S06 group linked to another tenant''s term','blocked '||sqlstate); end $$;
do $$ declare n int; begin
  insert into public.academic_units (tenant_id, parent_id, level, name) values ('d0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-0000000000e1',2,'Dept A');
  update public.groups set academic_unit_id='d0000000-0000-0000-0000-0000000000e1', term_id='d0000000-0000-0000-0000-0000000000f1' where id='d0000000-0000-0000-0000-0000000000c1';
  get diagnostics n=row_count;
  insert into r values ('L-01 same-tenant level-2 unit + group links', case when n=1 then 'works' else 'BROKEN' end);
exception when others then insert into r values ('L-01 same-tenant level-2 unit + group links','BROKEN '||sqlstate||' '||left(sqlerrm,60)); end $$;

-- ── Structure mode (tenant C is 'flat') ──────────────────────────────────────
do $$ begin insert into public.academic_units (tenant_id, level, name) values ('d0000000-0000-0000-0000-00000000000c',1,'flat unit');
  insert into r values ('A-M01 unit created in a flat tenant','VULNERABLE');
exception when others then insert into r values ('A-M01 unit created in a flat tenant','blocked '||sqlstate); end $$;
do $$ begin insert into public.academic_terms (tenant_id, name, starts_on, ends_on) values ('d0000000-0000-0000-0000-00000000000c','flat term','2026-09-01','2027-01-31');
  insert into r values ('A-M02 term created in a flat tenant','VULNERABLE');
exception when others then insert into r values ('A-M02 term created in a flat tenant','blocked '||sqlstate); end $$;
-- Revert A to flat: existing links survive, new links are refused, clearing is allowed.
do $$ declare kept int; begin
  update public.tenants set structure_mode='flat' where id='d0000000-0000-0000-0000-00000000000a';
  select count(*) into kept from public.groups where id='d0000000-0000-0000-0000-0000000000c1' and academic_unit_id is not null;
  insert into r values ('L-M03 revert to flat keeps existing links (must be 1)', kept::text);
  begin
    update public.groups set academic_unit_id=(select id from public.academic_units where name='Dept A') where id='d0000000-0000-0000-0000-0000000000c1';
    insert into r values ('A-M04 new link while flat','VULNERABLE');
  exception when others then insert into r values ('A-M04 new link while flat','blocked '||sqlstate); end;
  begin
    update public.groups set term_id=null where id='d0000000-0000-0000-0000-0000000000c1';
    insert into r values ('L-M05 clearing a link while flat','works');
  exception when others then insert into r values ('L-M05 clearing a link while flat','BROKEN '||sqlstate); end;
  update public.tenants set structure_mode='academic' where id='d0000000-0000-0000-0000-00000000000a';
  select count(*) into kept from public.academic_units where tenant_id='d0000000-0000-0000-0000-00000000000a' and deleted_at is null;
  insert into r values ('L-M06 re-enable academic brings units back (must be 2)', kept::text);
end $$;

-- ── has_center (institution_type_migration.sql) ──────────────────────────────
do $$ begin
  insert into r select 'L-C00 existing/new tenant keeps its centre (must be true)', has_center::text
    from public.tenants where id='d0000000-0000-0000-0000-00000000000a';
end $$;
do $$ begin
  update public.tenants set has_center=false where id='d0000000-0000-0000-0000-00000000000c';
  insert into auth.users (id, email) values ('d0000000-0000-0000-0000-0000000000c9','as-cm-c@test.local');
  insert into public.users (id, email, full_name, role, tenant_id, is_active)
    values ('d0000000-0000-0000-0000-0000000000c9','as-cm-c@test.local','CM C','center_manager','d0000000-0000-0000-0000-00000000000c',true)
    on conflict (id) do update set role=excluded.role, tenant_id=excluded.tenant_id;
  insert into r values ('A-C01 centre manager created in a tenant without a centre','VULNERABLE');
exception when others then insert into r values ('A-C01 centre manager created in a tenant without a centre','blocked '||sqlstate); end $$;
do $$ begin
  update public.users set role='center_manager' where id='d0000000-0000-0000-0000-0000000000a2';
  insert into r values ('L-C02 centre manager allowed where the tenant has a centre','works');
  update public.users set role='teacher' where id='d0000000-0000-0000-0000-0000000000a2';
exception when others then insert into r values ('L-C02 centre manager allowed where the tenant has a centre','BROKEN '||sqlstate); end $$;

-- ── Admin A (session client — writes must be refused even for the admin) ─────
set role authenticated;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$ begin insert into public.academic_units (tenant_id, level, name) values ('d0000000-0000-0000-0000-00000000000a',1,'direct');
  insert into r values ('A-01 admin writes academic_units directly via PostgREST','VULNERABLE');
exception when others then insert into r values ('A-01 admin writes academic_units directly via PostgREST','blocked '||sqlstate); end $$;
reset role;

-- ── Student A ────────────────────────────────────────────────────────────────
set role authenticated;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
do $$ declare n int; begin update public.academic_terms set is_current=false where id='d0000000-0000-0000-0000-0000000000f1'; get diagnostics n=row_count;
  insert into r values ('A-02 student updates a term', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('A-02 student updates a term','blocked '||sqlstate); end $$;
do $$ declare own int; foreign_ int; t int; begin
  select count(*) into own from public.academic_units where tenant_id='d0000000-0000-0000-0000-00000000000a';
  select count(*) into foreign_ from public.academic_units where tenant_id='d0000000-0000-0000-0000-00000000000b';
  select count(*) into t from public.academic_terms where tenant_id='d0000000-0000-0000-0000-00000000000b';
  insert into r values ('L-02 student reads own units (must be own=2 foreign=0 foreignTerms=0)', 'own='||own||' foreign='||foreign_||' foreignTerms='||t);
end $$;
reset role;

-- ── Anonymous ────────────────────────────────────────────────────────────────
set role anon;
do $$ declare n int; begin select count(*) into n from public.academic_units;
  insert into r values ('A-03 anon reads academic_units', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('A-03 anon reads academic_units','blocked '||sqlstate); end $$;
reset role;

select * from r order by test;
rollback;
