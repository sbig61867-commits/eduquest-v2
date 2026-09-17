-- =============================================================================
-- Institutional mailbox linking (Google now, Microsoft later)
-- =============================================================================
-- A staff member (centre manager / university admin) links THEIR OWN mailbox
-- through Google's own OAuth popup; the platform never sees the password. Only
-- the `gmail.send` scope is requested (plus openid/email to learn the address):
-- the app can send as the user, never read their mail.
--
-- mail_connections — one row per user+provider. Tokens are AES-256-GCM
--   encrypted by the app (MAIL_TOKEN_ENCRYPTION_KEY) before they reach the DB.
--   NO policies at all and every grant revoked: not even the owner can read
--   the row through PostgREST. Status is served by /api/mail/connection.
-- mail_messages — send log (who sent what to whom, result). Tenant staff and
--   the sender may read it; writes are service-role only.
--
-- Idempotent — safe to re-run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.mail_connections (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tenant_id          UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider           TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  email              TEXT NOT NULL,
  refresh_token_enc  TEXT NOT NULL,
  access_token_enc   TEXT,
  access_expires_at  TIMESTAMPTZ,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'error')),
  last_error         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_mail_connections_tenant ON public.mail_connections (tenant_id);

ALTER TABLE public.mail_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mail_connections FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.mail_messages (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sender_id      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  connection_id  UUID REFERENCES public.mail_connections(id) ON DELETE SET NULL,
  from_email     TEXT NOT NULL,
  recipient_id   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  to_email       TEXT NOT NULL,
  subject        TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_messages_tenant     ON public.mail_messages (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_messages_sender     ON public.mail_messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_mail_messages_connection ON public.mail_messages (connection_id);
CREATE INDEX IF NOT EXISTS idx_mail_messages_recipient  ON public.mail_messages (recipient_id);

ALTER TABLE public.mail_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mail_messages_select ON public.mail_messages;
CREATE POLICY mail_messages_select ON public.mail_messages FOR SELECT USING (
  sender_id = (SELECT auth.uid())
  OR (SELECT current_user_role()) = 'super_admin'
  OR ( (SELECT current_user_role()) IN ('university_admin', 'center_manager')
       AND tenant_id = (SELECT current_tenant_id()) )
);

REVOKE ALL ON public.mail_messages FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.mail_messages FROM authenticated;
GRANT SELECT ON public.mail_messages TO authenticated;
