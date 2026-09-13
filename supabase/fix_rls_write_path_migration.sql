-- =============================================================================
-- fix_rls_write_path_migration.sql  —  NOT YET APPLIED (awaiting owner approval)
-- =============================================================================
-- Found 2026-09-13 during the owner-requested re-verification of the audit.
-- The earlier Phase 11 work only exercised SELECT policies. Testing the
-- INSERT/UPDATE path (inside a rolled-back transaction on production, zero
-- residue) showed that a normal session + the public anon key could:
--
--   CRITICAL T01  teacher UPDATEs own invitation to role='university_admin',
--                 is_public=true. accept_invitation() trusts inv.role, so anyone
--                 who opens the link becomes an admin of that university.
--   HIGH     T03  teacher INSERTs an invitation pointing at ANOTHER tenant's
--                 group; accept_invitation() enrols the student cross-tenant.
--   HIGH     T05  teacher moves own lesson into ANOTHER tenant's group; that
--                 tenant's students then see it (lessons_select student branch
--                 had no tenant check).
--   HIGH     T06  teacher INSERTs an exam with a spoofed teacher_id into ANOTHER
--                 tenant's group; that tenant's students see it.
--   HIGH     T07  teacher enrols ANOTHER tenant's student into own group.
--   HIGH     T10  student self-enrols in ANOTHER tenant's course and reads its
--                 exam questions via get_student_exams() (no tenant check).
--   MEDIUM   T04  a request's sender sets status='accepted' directly, bypassing
--                 the state machine in api/requests/route.ts.
--   MEDIUM   T09  student enrols ANY student into ANY course in their tenant.
--   (T03/T05/T06/T07/T10 additionally need a foreign row's UUID.)
--
-- Root cause: these tables kept INSERT/UPDATE/DELETE grants plus permissive
-- write policies with no WITH CHECK pinning role/tenant/group — although every
-- legitimate write already goes through service-role route handlers (grep of
-- src/ on 2026-09-13: no browser-client write touches any table in step 1).
-- Same class as fix_submission_insert_grade_forgery_migration.sql.
--
-- Also: pins `pg_temp` last on the 6 SECURITY DEFINER functions that lacked it
-- (CLAUDE.md rule), and adds tenant defence-in-depth to the two student read
-- paths that relied on enrolment alone.
--
-- Verification: supabase/tests/rls_write_path_check.sql (every attack must
-- report "blocked"; the legitimate course-builder writes must still succeed).
-- Idempotent; safe to re-run.
-- =============================================================================

-- ── 1) Tables written ONLY by service-role code: remove browser write access ──
DROP POLICY IF EXISTS "invitations_insert"        ON public.invitations;
DROP POLICY IF EXISTS "invitations_update"        ON public.invitations;
DROP POLICY IF EXISTS "staff_requests_insert"     ON public.staff_requests;
DROP POLICY IF EXISTS "staff_requests_update"     ON public.staff_requests;
DROP POLICY IF EXISTS "lessons_insert"            ON public.lessons;
DROP POLICY IF EXISTS "lessons_update"            ON public.lessons;
DROP POLICY IF EXISTS "lessons_delete"            ON public.lessons;
DROP POLICY IF EXISTS "exams_insert"              ON public.exams;
DROP POLICY IF EXISTS "exams_update"              ON public.exams;
DROP POLICY IF EXISTS "exams_delete"              ON public.exams;
DROP POLICY IF EXISTS "groups_insert"             ON public.groups;
DROP POLICY IF EXISTS "groups_update"             ON public.groups;
DROP POLICY IF EXISTS "groups_delete"             ON public.groups;
DROP POLICY IF EXISTS "group_students_insert"     ON public.group_students;
DROP POLICY IF EXISTS "group_students_delete"     ON public.group_students;
DROP POLICY IF EXISTS "course_enrollments_insert" ON public.course_enrollments;
DROP POLICY IF EXISTS "course_enrollments_delete" ON public.course_enrollments;
DROP POLICY IF EXISTS "courses_insert"            ON public.courses;
DROP POLICY IF EXISTS "courses_update"            ON public.courses;
DROP POLICY IF EXISTS "courses_delete"            ON public.courses;
DROP POLICY IF EXISTS "surveys_insert"            ON public.surveys;
DROP POLICY IF EXISTS "surveys_update"            ON public.surveys;

REVOKE INSERT, UPDATE, DELETE ON
  public.invitations, public.staff_requests, public.lessons, public.exams,
  public.groups, public.group_students, public.course_enrollments,
  public.courses, public.surveys
FROM anon, authenticated;

-- ── 2) Course builder tables ARE written from the browser
--       (teacher/courses/[id]/course-build-client.tsx) — keep write access but
--       scope it to the course's owner (or a university_admin of the same
--       tenant), and pin the row's tenant_id to the course's tenant. ─────────
CREATE OR REPLACE FUNCTION public.can_edit_course(p_course_id uuid, p_row_tenant uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.courses c
    WHERE c.id = p_course_id
      AND c.tenant_id = p_row_tenant
      AND (
        public.current_user_role() = 'super_admin'
        OR (c.tenant_id = public.current_tenant_id()
            AND (c.teacher_id = auth.uid() OR public.current_user_role() = 'university_admin'))
      )
  );
$$;
REVOKE EXECUTE ON FUNCTION public.can_edit_course(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_edit_course(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "course_levels_insert" ON public.course_levels;
DROP POLICY IF EXISTS "course_levels_update" ON public.course_levels;
DROP POLICY IF EXISTS "course_levels_delete" ON public.course_levels;
CREATE POLICY "course_levels_insert" ON public.course_levels FOR INSERT
  WITH CHECK (public.can_edit_course(course_id, tenant_id));
CREATE POLICY "course_levels_update" ON public.course_levels FOR UPDATE
  USING (public.can_edit_course(course_id, tenant_id))
  WITH CHECK (public.can_edit_course(course_id, tenant_id));
CREATE POLICY "course_levels_delete" ON public.course_levels FOR DELETE
  USING (public.can_edit_course(course_id, tenant_id));

DROP POLICY IF EXISTS "course_units_insert" ON public.course_units;
DROP POLICY IF EXISTS "course_units_update" ON public.course_units;
DROP POLICY IF EXISTS "course_units_delete" ON public.course_units;
CREATE POLICY "course_units_insert" ON public.course_units FOR INSERT
  WITH CHECK (public.can_edit_course(course_id, tenant_id));
CREATE POLICY "course_units_update" ON public.course_units FOR UPDATE
  USING (public.can_edit_course(course_id, tenant_id))
  WITH CHECK (public.can_edit_course(course_id, tenant_id));
CREATE POLICY "course_units_delete" ON public.course_units FOR DELETE
  USING (public.can_edit_course(course_id, tenant_id));

DROP POLICY IF EXISTS "unit_items_insert" ON public.unit_items;
DROP POLICY IF EXISTS "unit_items_update" ON public.unit_items;
DROP POLICY IF EXISTS "unit_items_delete" ON public.unit_items;
CREATE POLICY "unit_items_insert" ON public.unit_items FOR INSERT
  WITH CHECK (public.can_edit_course(course_id, tenant_id));
CREATE POLICY "unit_items_update" ON public.unit_items FOR UPDATE
  USING (public.can_edit_course(course_id, tenant_id))
  WITH CHECK (public.can_edit_course(course_id, tenant_id));
CREATE POLICY "unit_items_delete" ON public.unit_items FOR DELETE
  USING (public.can_edit_course(course_id, tenant_id));

-- ── 3) Student read paths: add tenant defence-in-depth ─────────────────────
DROP POLICY IF EXISTS "lessons_select" ON public.lessons;
CREATE POLICY "lessons_select" ON public.lessons FOR SELECT USING (
  deleted_at IS NULL AND (
    (SELECT public.current_user_role()) = 'super_admin'
    OR (
      (SELECT public.current_user_role()) = 'teacher'
      AND tenant_id = (SELECT public.current_tenant_id())
      AND (teacher_id = (SELECT auth.uid())
           OR group_id IN (SELECT g.id FROM public.groups g WHERE g.teacher_id = (SELECT auth.uid())))
    )
    OR (
      (SELECT public.current_user_role()) = 'student'
      AND is_published = true
      AND tenant_id = (SELECT public.current_tenant_id())
      AND group_id IN (SELECT gs.group_id FROM public.group_students gs WHERE gs.student_id = (SELECT auth.uid()))
    )
  )
);

CREATE OR REPLACE FUNCTION public.get_student_exams()
RETURNS TABLE(id uuid, tenant_id uuid, group_id uuid, course_id uuid, teacher_id uuid, title text,
              duration_minutes integer, is_published boolean, proctoring_enabled boolean,
              starts_at timestamptz, ends_at timestamptz, created_at timestamptz,
              questions jsonb, group_name text, course_title text)
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    e.id, e.tenant_id, e.group_id, e.course_id, e.teacher_id,
    e.title, e.duration_minutes, e.is_published, e.proctoring_enabled,
    e.starts_at, e.ends_at, e.created_at,
    COALESCE(
      (SELECT jsonb_agg(q - 'correct_answer') FROM jsonb_array_elements(e.questions) AS q),
      '[]'::jsonb
    ) AS questions,
    g.name  AS group_name,
    c.title AS course_title
  FROM public.exams e
  LEFT JOIN public.groups  g ON g.id = e.group_id
  LEFT JOIN public.courses c ON c.id = e.course_id
  WHERE e.is_published = true
    AND e.deleted_at IS NULL
    -- Added 2026-09-13: an injected enrolment must never surface another
    -- tenant's exam (finding T10).
    AND e.tenant_id = public.current_tenant_id()
    AND (e.group_id IS NULL OR (g.is_active = true AND g.deleted_at IS NULL))
    AND (
      e.group_id IN (SELECT gs.group_id FROM public.group_students gs WHERE gs.student_id = auth.uid())
      OR e.course_id IN (SELECT ce.course_id FROM public.course_enrollments ce WHERE ce.student_id = auth.uid())
    )
  ORDER BY e.created_at DESC;
$$;

-- ── 4) accept_invitation: never enrol outside the invitation's tenant ──────
CREATE OR REPLACE FUNCTION public.accept_invitation(p_token text, p_user_id uuid, p_full_name text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  inv          RECORD;
  _user_exists BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) INTO _user_exists;
  IF NOT _user_exists THEN
    RAISE EXCEPTION 'USER_PROFILE_NOT_FOUND';
  END IF;

  SELECT * INTO inv
  FROM public.invitations
  WHERE token     = p_token
    AND status    = 'pending'
    AND expires_at > NOW()
    AND (max_uses IS NULL OR use_count < max_uses)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_INVALID_OR_EXPIRED';
  END IF;

  -- Added 2026-09-13 (finding T03): a group/course on the invitation must
  -- belong to the invitation's own tenant. Reuses the existing error code so
  -- both callers (api/auth/accept-invitation, auth/callback) already map it.
  IF inv.group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.groups g WHERE g.id = inv.group_id AND g.tenant_id = inv.tenant_id
  ) THEN
    RAISE EXCEPTION 'INVITATION_INVALID_OR_EXPIRED';
  END IF;
  IF inv.course_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.courses c WHERE c.id = inv.course_id AND c.tenant_id = inv.tenant_id
  ) THEN
    RAISE EXCEPTION 'INVITATION_INVALID_OR_EXPIRED';
  END IF;

  IF inv.is_public THEN
    UPDATE public.invitations
    SET use_count = use_count + 1,
        status    = CASE
                      WHEN max_uses IS NOT NULL AND (use_count + 1) >= max_uses THEN 'revoked'
                      ELSE 'pending'
                    END
    WHERE id = inv.id;
  ELSE
    UPDATE public.invitations
    SET status = 'accepted', accepted_at = NOW(), accepted_by = p_user_id
    WHERE id = inv.id;
  END IF;

  UPDATE public.users
  SET role = inv.role, tenant_id = inv.tenant_id, full_name = p_full_name
  WHERE id = p_user_id;

  IF inv.group_id IS NOT NULL AND inv.role = 'student' THEN
    INSERT INTO public.group_students (group_id, student_id)
    VALUES (inv.group_id, p_user_id)
    ON CONFLICT DO NOTHING;
  END IF;

  IF inv.course_id IS NOT NULL AND inv.role = 'student' THEN
    INSERT INTO public.course_enrollments (course_id, student_id, tenant_id)
    VALUES (inv.course_id, p_user_id, inv.tenant_id)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN json_build_object('role', inv.role, 'tenant_id', inv.tenant_id,
                           'group_id', inv.group_id, 'course_id', inv.course_id);
END;
$function$;

-- ── 5) pg_temp last on every remaining SECURITY DEFINER function ───────────
ALTER FUNCTION public.cascade_tenant_active_status()      SET search_path = public, pg_temp;
ALTER FUNCTION public.deactivate_users_on_tenant_delete() SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_new_user()                   SET search_path = public, pg_temp;
ALTER FUNCTION public.sync_user_claims()                  SET search_path = public, pg_temp;
ALTER FUNCTION public.check_email_in_auth(text)           SET search_path = auth, public, pg_temp;
