-- ============================================================
-- staff_requests_migration.sql — 2026-09-04
-- Idempotent + re-runnable. Apply in the Supabase SQL Editor.
--
-- Phase 1 of the staff-collaboration features: a structured
-- request/inbox channel between teachers and their university_admin
-- (both directions), with an attached message thread per request.
--
-- Use cases (owner's spec): the admin requests a grade sheet / report
-- / a specific in-platform operation FROM a teacher; a teacher requests
-- something FROM the admin. Each request carries a type + status
-- (pending → accepted/rejected → completed, or cancelled) and a
-- conversation thread so the two can coordinate.
--
-- Reads go through the user-session client (RLS); writes go through the
-- service-role client in the API after app-level authorization, matching
-- the rest of the codebase.
-- ============================================================

-- ── Tables ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_requests (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_user_id uuid NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  to_user_id   uuid NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  type         text NOT NULL DEFAULT 'general'
                 CHECK (type IN ('grade_sheet','report','general')),
  subject      text NOT NULL,
  -- optional group the request is about (e.g. "grade sheet for group X")
  group_id     uuid REFERENCES groups(id) ON DELETE SET NULL,
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','accepted','rejected','completed','cancelled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS request_messages (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id uuid NOT NULL REFERENCES staff_requests(id) ON DELETE CASCADE,
  sender_id  uuid NOT NULL REFERENCES users(id)          ON DELETE CASCADE,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes (hot paths: inbox by recipient/sender/tenant) ───
CREATE INDEX IF NOT EXISTS idx_staff_requests_tenant  ON staff_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_staff_requests_to      ON staff_requests(to_user_id);
CREATE INDEX IF NOT EXISTS idx_staff_requests_from    ON staff_requests(from_user_id);
CREATE INDEX IF NOT EXISTS idx_request_messages_req   ON request_messages(request_id, created_at);

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE staff_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_messages ENABLE ROW LEVEL SECURITY;

-- SELECT: super_admin (all); inside the tenant, the university_admin sees
-- every request, and any user sees requests they are party to.
DROP POLICY IF EXISTS "staff_requests_select" ON staff_requests;
CREATE POLICY "staff_requests_select" ON staff_requests FOR SELECT USING (
  (SELECT current_user_role()) = 'super_admin'
  OR (
    tenant_id = (SELECT current_tenant_id())
    AND (
      (SELECT current_user_role()) = 'university_admin'
      OR from_user_id = (SELECT auth.uid())
      OR to_user_id   = (SELECT auth.uid())
    )
  )
);

-- INSERT / UPDATE policies are defence-in-depth (the API writes with the
-- service-role client after authorizing in app code).
DROP POLICY IF EXISTS "staff_requests_insert" ON staff_requests;
CREATE POLICY "staff_requests_insert" ON staff_requests FOR INSERT WITH CHECK (
  tenant_id = (SELECT current_tenant_id())
  AND from_user_id = (SELECT auth.uid())
  AND (SELECT current_user_role()) IN ('teacher','university_admin')
);

DROP POLICY IF EXISTS "staff_requests_update" ON staff_requests;
CREATE POLICY "staff_requests_update" ON staff_requests FOR UPDATE USING (
  (SELECT current_user_role()) = 'super_admin'
  OR (
    tenant_id = (SELECT current_tenant_id())
    AND (
      (SELECT current_user_role()) = 'university_admin'
      OR from_user_id = (SELECT auth.uid())
      OR to_user_id   = (SELECT auth.uid())
    )
  )
);

-- MESSAGES: visible to anyone who can see the parent request.
DROP POLICY IF EXISTS "request_messages_select" ON request_messages;
CREATE POLICY "request_messages_select" ON request_messages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.staff_requests r
    WHERE r.id = request_messages.request_id
      AND (
        (SELECT current_user_role()) = 'super_admin'
        OR (
          r.tenant_id = (SELECT current_tenant_id())
          AND (
            (SELECT current_user_role()) = 'university_admin'
            OR r.from_user_id = (SELECT auth.uid())
            OR r.to_user_id   = (SELECT auth.uid())
          )
        )
      )
  )
);

DROP POLICY IF EXISTS "request_messages_insert" ON request_messages;
CREATE POLICY "request_messages_insert" ON request_messages FOR INSERT WITH CHECK (
  sender_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.staff_requests r
    WHERE r.id = request_messages.request_id
      AND r.tenant_id = (SELECT current_tenant_id())
      AND (
        (SELECT current_user_role()) = 'university_admin'
        OR r.from_user_id = (SELECT auth.uid())
        OR r.to_user_id   = (SELECT auth.uid())
      )
  )
);
