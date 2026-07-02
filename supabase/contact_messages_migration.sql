-- Migration: contact_messages — messages from the public landing-page contact form.
-- Inserts happen ONLY via the service-role client in /api/contact (the sender is
-- anonymous, no session). No INSERT policy on purpose.
-- Safe to run multiple times. Apply in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.contact_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  message    TEXT NOT NULL,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

-- Only the platform owner can read / mark as read / delete.
DROP POLICY IF EXISTS "contact_messages_super_admin" ON public.contact_messages;
CREATE POLICY "contact_messages_super_admin" ON public.contact_messages
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'super_admin')
  WITH CHECK (public.current_user_role() = 'super_admin');
