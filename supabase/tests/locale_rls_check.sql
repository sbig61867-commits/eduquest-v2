-- =============================================================================
-- Locale-preference RLS regression check  (i18n Phase 0b)
-- =============================================================================
-- Companion to supabase/locale_preferences_migration.sql. Run it AFTER that
-- migration is applied — before it, every row reads "N/A (pre-migration)"
-- because the columns do not exist yet.
--
-- What it proves, and why it exists:
--
--   `users_update` protects columns by ENUMERATION. Adding a column that is
--   not in the enumeration silently makes it self-writable. That is the
--   intended behaviour for `locale` — but the identical mechanism is how a
--   protected column would silently become writable if someone edited the
--   policy carelessly later. So this file asserts BOTH halves:
--
--     L-*  a user may set their own locale, and may clear it back to NULL
--     A-*  the new column is not a lever on any protected column, on any
--          other user's row, or on the tenant default
--
-- Expected output: every L-* row "works", every A-* row "blocked …".
-- A single "VULNERABLE" is a release blocker.
--
-- SAFE TO RUN ANYTIME: one transaction, always rolled back, zero residue.
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('d0000000-0000-0000-0000-0000000000a1','loc-admin-a@test.local'),
  ('d0000000-0000-0000-0000-0000000000a3','loc-student-a@test.local'),
  ('d0000000-0000-0000-0000-0000000000a5','loc-student-a2@test.local')
on conflict (id) do nothing;

insert into public.tenants (id, name, slug, is_active) values
  ('d0000000-0000-0000-0000-00000000000a','__loc_tenant_a__','__loc-a__',true),
  ('d0000000-0000-0000-0000-00000000000b','__loc_tenant_b__','__loc-b__',true)
on conflict (id) do nothing;

insert into public.users (id, email, full_name, role, tenant_id, is_active) values
  ('d0000000-0000-0000-0000-0000000000a1','loc-admin-a@test.local','Loc Admin A','university_admin','d0000000-0000-0000-0000-00000000000a',true),
  ('d0000000-0000-0000-0000-0000000000a3','loc-student-a@test.local','Loc Student A','student','d0000000-0000-0000-0000-00000000000a',true),
  ('d0000000-0000-0000-0000-0000000000a5','loc-student-a2@test.local','Loc Student A2','student','d0000000-0000-0000-0000-00000000000a',true)
on conflict (id) do update set role=excluded.role, tenant_id=excluded.tenant_id, is_active=excluded.is_active;

create temp table r (test text, outcome text) on commit drop;
grant insert, select on r to authenticated;

-- Guard: skip cleanly when the migration has not been applied yet.
do $$
declare has_cols boolean;
begin
  select count(*) = 2 into has_cols
    from information_schema.columns
   where table_schema = 'public'
     and ((table_name = 'users'   and column_name = 'locale')
       or (table_name = 'tenants' and column_name = 'default_locale'));
  if not has_cols then
    insert into r values ('PRE-MIGRATION', 'N/A — run supabase/locale_preferences_migration.sql first');
  end if;
end $$;

-- ── Student A (self) ────────────────────────────────────────────────────────
set role authenticated;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-0000000000a3","role":"authenticated"}';

do $$ declare n int; begin
  update public.users set locale='en' where id='d0000000-0000-0000-0000-0000000000a3'; get diagnostics n=row_count;
  insert into r values ('L-01 user sets own locale (must work)', case when n>0 then 'works' else 'BROKEN (0 rows)' end);
exception when others then insert into r values ('L-01 user sets own locale (must work)','BROKEN '||sqlstate||' '||left(sqlerrm,60)); end $$;

do $$ declare n int; begin
  update public.users set locale=null where id='d0000000-0000-0000-0000-0000000000a3'; get diagnostics n=row_count;
  insert into r values ('L-02 user clears locale back to NULL / inherit (must work)', case when n>0 then 'works' else 'BROKEN (0 rows)' end);
exception when others then insert into r values ('L-02 user clears locale back to NULL / inherit (must work)','BROKEN '||sqlstate||' '||left(sqlerrm,60)); end $$;

do $$ declare n int; begin
  update public.users set locale='fr' where id='d0000000-0000-0000-0000-0000000000a3'; get diagnostics n=row_count;
  insert into r values ('A-L01 unsupported locale value passes the CHECK', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('A-L01 unsupported locale value passes the CHECK','blocked '||sqlstate); end $$;

-- Each of these changes `locale` AND one protected column in the same
-- statement. The pinned predicate must reject the statement as a whole.
do $$ declare n int; begin
  update public.users set locale='en', role='super_admin' where id='d0000000-0000-0000-0000-0000000000a3'; get diagnostics n=row_count;
  insert into r values ('A-L02 [Critical] locale + role escalation', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('A-L02 [Critical] locale + role escalation','blocked '||sqlstate); end $$;

do $$ declare n int; begin
  update public.users set locale='en', tenant_id='d0000000-0000-0000-0000-00000000000b' where id='d0000000-0000-0000-0000-0000000000a3'; get diagnostics n=row_count;
  insert into r values ('A-L03 [Critical] locale + tenant hop', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('A-L03 [Critical] locale + tenant hop','blocked '||sqlstate); end $$;

do $$ declare n int; begin
  update public.users set locale='en', is_active=true where id='d0000000-0000-0000-0000-0000000000a3'; get diagnostics n=row_count;
  -- is_active is already true, so this is a no-op write; it must still be the
  -- pinned comparison that decides, not the value coincidence.
  update public.users set locale='en', is_active=false where id='d0000000-0000-0000-0000-0000000000a3'; get diagnostics n=row_count;
  insert into r values ('A-L04 [High] locale + is_active', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('A-L04 [High] locale + is_active','blocked '||sqlstate); end $$;

do $$ declare n int; begin
  update public.users set locale='en', permissions='{"manage_students":true}'::jsonb where id='d0000000-0000-0000-0000-0000000000a3'; get diagnostics n=row_count;
  insert into r values ('A-L05 [Critical] locale + permissions self-grant', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('A-L05 [Critical] locale + permissions self-grant','blocked '||sqlstate); end $$;

do $$ declare n int; begin
  update public.users set locale='en', can_create_courses=true where id='d0000000-0000-0000-0000-0000000000a3'; get diagnostics n=row_count;
  insert into r values ('A-L06 [High] locale + can_create_courses', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('A-L06 [High] locale + can_create_courses','blocked '||sqlstate); end $$;

do $$ declare n int; begin
  update public.users set locale='en', is_university_student=false where id='d0000000-0000-0000-0000-0000000000a3'; get diagnostics n=row_count;
  insert into r values ('A-L07 [Medium] locale + is_university_student', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('A-L07 [Medium] locale + is_university_student','blocked '||sqlstate); end $$;

do $$ declare n int; begin
  update public.users set locale='en' where id='d0000000-0000-0000-0000-0000000000a5'; get diagnostics n=row_count;
  insert into r values ('A-L08 [Medium] student sets ANOTHER user''s locale', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('A-L08 [Medium] student sets ANOTHER user''s locale','blocked '||sqlstate); end $$;

do $$ declare n int; begin
  update public.tenants set default_locale='en' where id='d0000000-0000-0000-0000-00000000000a'; get diagnostics n=row_count;
  insert into r values ('A-L09 [High] student rewrites the institution default locale', case when n>0 then 'VULNERABLE' else 'blocked (0 rows)' end);
exception when others then insert into r values ('A-L09 [High] student rewrites the institution default locale','blocked '||sqlstate); end $$;

reset role;

select test, outcome from r order by test;

rollback;
