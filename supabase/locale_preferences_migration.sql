-- ============================================================
-- EduQuest — locale preferences (i18n Phase 0b)
-- ============================================================
-- STATUS: NOT APPLIED. Written for review, per the project's manual
-- SQL-Editor workflow. The application code shipped alongside it tolerates
-- both columns being absent (src/proxy.ts ensureLocaleCookie swallows the
-- PostgREST error and falls back to the platform default), so the app works
-- before AND after this runs. Re-runnable / idempotent.
--
-- Adds the two DB levels of the locale chain:
--
--   explicit  (caller-supplied, e.g. an email rendered in the recipient's
--              language)              — not stored, passed at call time
--   user      users.locale            — THIS FILE
--   tenant    tenants.default_locale  — THIS FILE
--   platform  DEFAULT_LOCALE          — src/i18n/config.ts, static, not a
--                                       DB lookup by design
--
-- Neither column is read on a steady-state request. They are collapsed into
-- the `eq_locale` cookie once per session by the proxy.
-- ============================================================

BEGIN;

-- ── 1. tenants.default_locale ───────────────────────────────
-- NOT NULL with a default, so every existing tenant gets the platform default
-- and nothing changes behaviourally on the day this is applied.
-- Keep the default in step with DEFAULT_LOCALE in src/i18n/config.ts.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS default_locale TEXT NOT NULL DEFAULT 'ar';

ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_default_locale_check;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_default_locale_check
  CHECK (default_locale IN ('ar', 'en'));

COMMENT ON COLUMN public.tenants.default_locale IS
  'UI language for this institution when the user has no preference of their own. Supported set mirrors LOCALES in src/i18n/config.ts.';

-- ── 2. users.locale ─────────────────────────────────────────
-- NULLABLE on purpose: NULL means "inherit from my tenant", which is a
-- different state from "I explicitly chose Arabic". Defaulting it would erase
-- that distinction and freeze every existing user against a later change to
-- their institution's default.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS locale TEXT;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_locale_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_locale_check
  CHECK (locale IS NULL OR locale IN ('ar', 'en'));

COMMENT ON COLUMN public.users.locale IS
  'Per-user UI language. NULL = inherit tenants.default_locale. Self-updatable: deliberately NOT pinned in users_update.';

-- ── 3. RLS — deliberately NO policy change ──────────────────
--
-- `users_update` (current definition: student_affiliation_announcements_migration.sql)
-- protects columns by ENUMERATION, not by allow-list:
--
--     id = auth.uid()
--     AND role = current_user_role()
--     AND NOT (tenant_id             IS DISTINCT FROM current_tenant_id())
--     AND NOT (is_active             IS DISTINCT FROM current_is_active())
--     AND NOT (permissions           IS DISTINCT FROM current_permissions())
--     AND NOT (can_create_courses    IS DISTINCT FROM current_can_create_courses())
--     AND NOT (is_university_student IS DISTINCT FROM current_is_university_student())
--
-- Two consequences, both of them the behaviour we want, and both of them the
-- reason this file rewrites nothing:
--
--   (a) `locale` is not named, so a self-UPDATE that changes only `locale`
--       still satisfies every pinned predicate → a user MAY set their own
--       language. No new grant, no new policy.
--
--   (b) The pinned columns are pinned regardless of what else is in the same
--       statement. `UPDATE users SET locale='en', role='super_admin'` fails
--       the `role = current_user_role()` term and is rejected whole — the new
--       column is not a crack to lever the old ones open through.
--
-- Rewriting the policy to "add" locale would risk dropping one of those
-- enumerated terms during the edit, which is the exact class of regression
-- that produced the 2026-09-13 privilege-escalation findings. Verified rather
-- than rewritten: supabase/tests/locale_rls_check.sql.
--
-- No change to grants either: `authenticated` already holds UPDATE on
-- public.users, gated by the policy above.

COMMIT;

-- ── Verification (run after COMMIT) ─────────────────────────
-- SELECT column_name, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_schema='public'
--    AND ((table_name='users' AND column_name='locale')
--      OR (table_name='tenants' AND column_name='default_locale'));
--
-- Expect:
--   tenants.default_locale | NO  | 'ar'::text
--   users.locale           | YES | NULL
--
-- Then run supabase/tests/locale_rls_check.sql.
