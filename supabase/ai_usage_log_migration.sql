-- ============================================================
-- AI Usage Log — per-tenant AI consumption for the super_admin dashboard
-- ============================================================
-- Adds ai_usage_log (one row per successful AI generation call: lesson,
-- exam, course-pptx, homework-from-file, lesson-from-file) and a
-- SECURITY DEFINER aggregate feed, get_tenant_ai_usage(), that the
-- super_admin dashboard reads to see how much each tenant is consuming.
--
-- Write path: routes under src/app/api/ai/* call logAiUsage()
-- (src/lib/ai/usage.ts) with the service-role client after a successful
-- generation — this table intentionally has NO insert policy, same
-- write-only-via-service-role pattern as staff_requests/announcements.
-- Read path: only get_tenant_ai_usage() below, gated to super_admin.
--
-- Run this once in the Supabase SQL Editor. Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS ai_usage_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  feature     TEXT NOT NULL, -- 'lesson' | 'exam' | 'course-pptx' | 'homework-from-file' | 'lesson-from-file'
  provider    TEXT NOT NULL, -- 'groq' | 'xkiro' | 'cohere' | 'gemini' | 'openrouter' | ...
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_tenant_created ON ai_usage_log (tenant_id, created_at DESC);

ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;

-- No SELECT policy for regular sessions — reads only via get_tenant_ai_usage()
-- below (SECURITY DEFINER, gated to super_admin). No INSERT/UPDATE/DELETE
-- policy at all — writes go through the service-role client, which bypasses
-- RLS entirely.

CREATE OR REPLACE FUNCTION get_tenant_ai_usage()
RETURNS TABLE (
  tenant_id    UUID,
  tenant_name  TEXT,
  total_calls  BIGINT,
  last_used_at TIMESTAMPTZ,
  by_feature   JSONB
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    t.id,
    t.name,
    COUNT(l.id)::bigint,
    MAX(l.created_at),
    COALESCE(
      jsonb_object_agg(l.feature, l.feature_count) FILTER (WHERE l.feature IS NOT NULL),
      '{}'::jsonb
    )
  FROM tenants t
  LEFT JOIN (
    SELECT id, tenant_id, feature, created_at, COUNT(*) OVER (PARTITION BY tenant_id, feature) AS feature_count
    FROM ai_usage_log
  ) l ON l.tenant_id = t.id
  WHERE (SELECT current_user_role()) = 'super_admin'
  GROUP BY t.id, t.name
  ORDER BY COUNT(l.id) DESC, t.name;
$$;
GRANT EXECUTE ON FUNCTION get_tenant_ai_usage() TO authenticated;
REVOKE EXECUTE ON FUNCTION get_tenant_ai_usage() FROM anon;

-- Verify (run as an actual super_admin session):
--   SELECT * FROM get_tenant_ai_usage();
