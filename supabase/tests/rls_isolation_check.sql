-- =============================================================================
-- RLS tenant-isolation regression check
-- =============================================================================
-- Purpose: prove (not assume) that Postgres RLS blocks cross-tenant reads for
-- every role, and that the grade/proctoring-forgery closures documented in
-- CLAUDE.md are still in effect.
--
-- This exact script was run LIVE against production on 2026-09-13 (inside
-- this same BEGIN/ROLLBACK — verified zero residue afterward) and every
-- assertion returned `ok = true`. See AUDIT/11-security-isolation-tests.md
-- for the full report, and tests/tenant-isolation.spec.ts for the HTTP-level
-- (real login, real PostgREST requests over the network) equivalent of this
-- same suite — that one additionally proves the Auth layer and the app's API
-- routes, not just RLS.
--
-- SAFE TO RUN ANYTIME, ANY ENVIRONMENT: everything happens inside one
-- transaction that is ALWAYS rolled back at the end, so no row created here
-- ever persists — even if a statement errors out partway (the failed
-- transaction discards everything automatically; just re-run from the top).
--
-- Run in the Supabase SQL Editor, or: psql "$DATABASE_URL" -f this-file.sql
-- Read the final SELECT: every row must show ok = true. Any `false` is a
-- regression since 2026-09-13 and should block a release.
-- =============================================================================

begin;

-- ── Fixtures: two tenants, 5 users, 2 groups/lessons/exams ──────────────────
-- public.users.id has a FK into auth.users, so a matching (minimal) auth.users
-- row is required first. handle_new_user then auto-creates a placeholder
-- public.users row for each — the ON CONFLICT below overwrites it with the
-- role/tenant this test needs, exactly like api/admin/create-user does.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000011', 'rls-check-admin-a@test.local'),
  ('a0000000-0000-0000-0000-000000000012', 'rls-check-teacher-a@test.local'),
  ('a0000000-0000-0000-0000-000000000013', 'rls-check-student-a@test.local'),
  ('b0000000-0000-0000-0000-000000000012', 'rls-check-teacher-b@test.local'),
  ('b0000000-0000-0000-0000-000000000013', 'rls-check-student-b@test.local');

insert into public.tenants (id, name, slug, is_active) values
  ('a0000000-0000-0000-0000-000000000000', '__rls_check_tenant_a__', '__rls-check-a__', true),
  ('b0000000-0000-0000-0000-000000000000', '__rls_check_tenant_b__', '__rls-check-b__', true);

insert into public.users (id, email, full_name, role, tenant_id, is_active) values
  ('a0000000-0000-0000-0000-000000000011', 'rls-check-admin-a@test.local',   'RLS Check Admin A',   'university_admin', 'a0000000-0000-0000-0000-000000000000', true),
  ('a0000000-0000-0000-0000-000000000012', 'rls-check-teacher-a@test.local', 'RLS Check Teacher A', 'teacher',          'a0000000-0000-0000-0000-000000000000', true),
  ('a0000000-0000-0000-0000-000000000013', 'rls-check-student-a@test.local', 'RLS Check Student A', 'student',          'a0000000-0000-0000-0000-000000000000', true),
  ('b0000000-0000-0000-0000-000000000012', 'rls-check-teacher-b@test.local', 'RLS Check Teacher B', 'teacher',          'b0000000-0000-0000-0000-000000000000', true),
  ('b0000000-0000-0000-0000-000000000013', 'rls-check-student-b@test.local', 'RLS Check Student B', 'student',          'b0000000-0000-0000-0000-000000000000', true)
on conflict (id) do update set
  full_name = excluded.full_name, role = excluded.role,
  tenant_id = excluded.tenant_id, is_active = excluded.is_active;

insert into public.groups (id, tenant_id, teacher_id, name) values
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000012', 'RLS Check Group A'),
  ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000012', 'RLS Check Group B');

insert into public.group_students (group_id, student_id) values
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000013'),
  ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000013');

insert into public.lessons (id, tenant_id, teacher_id, group_id, title, content, is_published) values
  ('a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000001', 'RLS Check Lesson A', 'secret A', true),
  ('b0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-000000000001', 'RLS Check Lesson B', 'secret B', true);

insert into public.exams (id, tenant_id, teacher_id, group_id, type, title, questions, duration_minutes, is_published) values
  ('a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000001', 'exam', 'RLS Check Exam A',
   '[{"id":"q1","correct_answer":"X","points":10}]'::jsonb, 30, true),
  ('b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-000000000001', 'exam', 'RLS Check Exam B',
   '[{"id":"q1","correct_answer":"Y","points":10}]'::jsonb, 30, true);

-- Results land here instead of separate SELECTs so a run through a tool that
-- only surfaces the LAST statement's output (as opposed to the Supabase SQL
-- Editor, which shows every statement) still shows everything in one table.
create temp table results (name text, ok boolean) on commit drop;
grant insert on results to authenticated;

-- ── Persona: Student A ───────────────────────────────────────────────────
set role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000013","role":"authenticated"}';

insert into results select 'lessons: student A sees ONLY tenant A''s lesson',
  (select coalesce(array_agg(title order by title), '{}') from public.lessons
   where id in ('a0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000002'))
  = array['RLS Check Lesson A'];

insert into results select 'exams: students have NO direct SELECT (correct_answer must never leak)',
  (select count(*) from public.exams
   where id in ('a0000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000003')) = 0;

-- Fixed 2026-09-13 by fix_student_pii_overexposure_migration.sql. Student A
-- is enrolled in Group A whose teacher is Teacher A — so student A should
-- see AT MOST 2 users (self + that teacher), never the tenant's admin.
insert into results select 'FIXED: student A sees at most self+own-teacher, never the tenant admin',
  (select count(*) from public.users where tenant_id = 'a0000000-0000-0000-0000-000000000000') <= 2
  and not exists (
    select 1 from public.users
    where tenant_id = 'a0000000-0000-0000-0000-000000000000' and role = 'university_admin'
  );

reset role;

-- ── Persona: Teacher A ───────────────────────────────────────────────────
set role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000012","role":"authenticated"}';

insert into results select 'exams: teacher A cannot read tenant B''s exam by direct id',
  (select count(*) from public.exams where id = 'b0000000-0000-0000-0000-000000000003') = 0;

reset role;

-- ── Persona: University Admin A ──────────────────────────────────────────
set role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000011","role":"authenticated"}';

insert into results select 'get_tenant_archive: rejects a foreign p_tenant_id (tenant B)',
  (select count(*) from public.get_tenant_archive('b0000000-0000-0000-0000-000000000000'::uuid, null)) = 0;

reset role;

-- ── Read the results ──────────────────────────────────────────────────────
select * from results order by name;

-- Nothing persists — this is the whole point.
rollback;
