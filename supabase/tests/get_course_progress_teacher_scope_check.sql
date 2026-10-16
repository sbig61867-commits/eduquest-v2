-- =============================================================================
-- get_course_progress teacher scope check
-- =============================================================================
-- Companion to supabase/get_course_progress_teacher_scope_migration.sql.
-- Builds two probe institutions and calls get_course_progress as each role.
--
--   Institution A: course C (owner T_OWN); group G linked to C, taught by
--   T_GRP, with student S1. Student S2 is enrolled in C but not in G.
--   T_OTHER teaches nothing here. AD is A's university_admin.
--   Institution B: teacher T_B. SA is a probe super_admin.
--
--   P-01 S1 -> own progress                         allowed
--   P-02 S1 -> S2                                    FORBIDDEN
--   P-03 T_OWN (course owner) -> S2                  allowed
--   P-04 T_GRP (group teacher) -> S1                 allowed
--   P-05 T_GRP -> S2 (not in T_GRP's group)          FORBIDDEN
--   P-06 T_OTHER (same institution, unrelated) -> S1 FORBIDDEN   <- the fix
--   P-07 AD (university_admin) -> S1                 allowed
--   P-08 T_B (other institution) -> S1               FORBIDDEN
--   P-09 SA (super_admin) -> S1                      allowed
--   P-10 T_GRP -> S1 after G is soft-deleted         FORBIDDEN
--
-- Before the migration P-05, P-06 and P-10 read "allowed" (FAIL); after it
-- every row reads PASS.
--
-- SAFE TO RUN ANYTIME: run as postgres; one block ending in RAISE EXCEPTION,
-- so all probe rows are rolled back. Probe institutions carry explicit codes
-- (ZZCPA / ZZCPB), so tenant_code_seq is never advanced.
-- =============================================================================

DO $chk$
DECLARE
  r text := ''; ok boolean; n_pass int := 0; n_fail int := 0;
  t_a  uuid := 'c0000000-0000-0000-0000-0000000000a0';
  t_b  uuid := 'c0000000-0000-0000-0000-0000000000b0';
  c    uuid := 'c0000000-0000-0000-0000-0000000000c1';
  g    uuid := 'c0000000-0000-0000-0000-0000000000d1';
  s1   uuid := 'c0000000-0000-0000-0000-000000000011';
  s2   uuid := 'c0000000-0000-0000-0000-000000000012';
  town uuid := 'c0000000-0000-0000-0000-000000000021';
  tgrp uuid := 'c0000000-0000-0000-0000-000000000022';
  toth uuid := 'c0000000-0000-0000-0000-000000000023';
  ad   uuid := 'c0000000-0000-0000-0000-000000000031';
  tb   uuid := 'c0000000-0000-0000-0000-000000000041';
  sa   uuid := 'c0000000-0000-0000-0000-000000000051';
  rec record;
BEGIN
  INSERT INTO public.tenants (id, name, slug, code, is_active) VALUES
    (t_a, '__cp_probe_a__', '__cp-probe-a__', 'ZZCPA', true),
    (t_b, '__cp_probe_b__', '__cp-probe-b__', 'ZZCPB', true);

  -- auth.users -> handle_new_user creates each public.users row
  INSERT INTO auth.users (id, email)
  SELECT u, 'cp-probe-' || right(u::text, 2) || '@test.local' FROM unnest(ARRAY[s1, s2, town, tgrp, toth, ad, tb, sa]) u;

  UPDATE public.users SET tenant_id = t_a, role = 'student'          WHERE id IN (s1, s2);
  UPDATE public.users SET tenant_id = t_a, role = 'teacher'          WHERE id IN (town, tgrp, toth);
  UPDATE public.users SET tenant_id = t_a, role = 'university_admin' WHERE id = ad;
  UPDATE public.users SET tenant_id = t_b, role = 'teacher'          WHERE id = tb;
  UPDATE public.users SET tenant_id = NULL, role = 'super_admin'     WHERE id = sa;

  INSERT INTO public.courses (id, tenant_id, teacher_id, title) VALUES (c, t_a, town, '__cp probe course__');
  INSERT INTO public.groups (id, tenant_id, teacher_id, name, course_id) VALUES (g, t_a, tgrp, '__cp probe group__', c);
  INSERT INTO public.group_students (group_id, student_id) VALUES (g, s1);
  INSERT INTO public.course_enrollments (course_id, student_id, tenant_id) VALUES (c, s1, t_a), (c, s2, t_a);

  FOR rec IN
    SELECT * FROM (VALUES
      ('P-01 S1 -> own',            s1,   s1, true),
      ('P-02 S1 -> S2',             s1,   s2, false),
      ('P-03 course owner -> S2',   town, s2, true),
      ('P-04 group teacher -> S1',  tgrp, s1, true),
      ('P-05 group teacher -> S2',  tgrp, s2, false),
      ('P-06 unrelated teacher',    toth, s1, false),
      ('P-07 university_admin',     ad,   s1, true),
      ('P-08 other institution',    tb,   s1, false),
      ('P-09 super_admin',          sa,   s1, true)
    ) v(label, caller, student, expect_ok)
  LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', rec.caller, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.get_course_progress(c, rec.student);
      ok := true;
    EXCEPTION WHEN raise_exception THEN
      ok := false;
    END;
    RESET ROLE;
    IF ok = rec.expect_ok THEN n_pass := n_pass + 1; ELSE n_fail := n_fail + 1; END IF;
    r := r || rec.label || '=' || CASE WHEN ok THEN 'allowed' ELSE 'FORBIDDEN' END
           || CASE WHEN ok = rec.expect_ok THEN ' PASS' ELSE ' FAIL' END || ' | ';
  END LOOP;

  UPDATE public.groups SET deleted_at = now() WHERE id = g;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', tgrp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.get_course_progress(c, s1);
    ok := true;
  EXCEPTION WHEN raise_exception THEN
    ok := false;
  END;
  RESET ROLE;
  IF NOT ok THEN n_pass := n_pass + 1; ELSE n_fail := n_fail + 1; END IF;
  r := r || 'P-10 deleted group=' || CASE WHEN ok THEN 'allowed FAIL' ELSE 'FORBIDDEN PASS' END;

  RAISE EXCEPTION 'CHECK_ROLLED_BACK: pass=% fail=% | %', n_pass, n_fail, r;
END $chk$;
