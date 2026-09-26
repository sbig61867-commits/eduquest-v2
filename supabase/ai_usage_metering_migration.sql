-- ============================================================
-- AI usage metering — tokens, cost, monthly institution allowance, alerts
-- ============================================================
-- Apply AFTER ai_usage_log_migration.sql. Idempotent — safe to re-run.
--
-- Until now ai_usage_log held one row per successful generation with only
-- (tenant, user, feature, provider): a count, with no idea how big each call
-- was, what it would cost, or whether it failed. This migration turns it into
-- a metering ledger:
--
--  1. ai_usage_log gains per-request metering: model, status (success / failed
--     / blocked), provider calls and fallback failures, input/output tokens,
--     list cost (what the same tokens cost at the provider's PAID price) and
--     billed cost (what was actually charged — 0 while every provider is on its
--     free tier), latency, and a per-call detail array. Old rows keep
--     metered = FALSE so the dashboard can say "no token data before metering".
--  2. ai_usage_daily — a rollup keyed by (tenant, day, feature, provider),
--     incremented in the same statement as the log insert. The monthly
--     allowance check and the dashboard's totals/series read it instead of
--     scanning the raw log.
--  3. tenants gains an optional monthly allowance (requests and/or tokens,
--     NULL = unlimited), an action (block | warn) and an alert threshold (%).
--     NULL everywhere by default ⇒ no behaviour change until a limit is set.
--     Only super_admin can write tenants (tenants_manage), so an institution
--     cannot raise its own allowance.
--  4. ai_usage_alerts — one row per (tenant, month, metric, level) the first
--     time usage crosses the threshold ('warning') or the limit ('exceeded').
--     Written only by record_ai_usage(); read by super_admin and that
--     institution's own university_admin.
--  5. RPCs:
--     record_ai_usage()      service_role only — writes log + rollup + alerts,
--                            re-derives the tenant from the user (never trusts
--                            a caller-supplied tenant). No auth.uid(): it runs
--                            under the service-role client, where auth.uid()
--                            is NULL (see fix_start_exam_attempt_migration.sql).
--     check_ai_allowance()   service_role only — may this user's institution
--                            still use AI this month?
--     get_ai_usage_report()  super_admin only — the whole dashboard in one call.
--     get_my_ai_allowance()  university_admin / center_manager — own
--                            institution's month: counts only, no cost.
--
-- Month and day boundaries are UTC.

-- ── 1. ai_usage_log: metering columns ─────────────────────────────

ALTER TABLE public.ai_usage_log
  ADD COLUMN IF NOT EXISTS model            TEXT,
  ADD COLUMN IF NOT EXISTS status           TEXT NOT NULL DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS provider_calls   INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS failed_calls     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS input_tokens     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_estimated BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS list_cost_usd    NUMERIC(14,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billed_cost_usd  NUMERIC(14,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS latency_ms       INTEGER,
  ADD COLUMN IF NOT EXISTS detail           JSONB,
  -- FALSE for rows written before this migration (count only, no tokens).
  ADD COLUMN IF NOT EXISTS metered          BOOLEAN NOT NULL DEFAULT FALSE;

DO $$ BEGIN
  ALTER TABLE public.ai_usage_log
    ADD CONSTRAINT ai_usage_log_status_check CHECK (status IN ('success', 'failed', 'blocked'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_created ON public.ai_usage_log (created_at DESC);
-- Covers the user_id FK and the dashboard's top-users query.
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_user_created ON public.ai_usage_log (user_id, created_at DESC);

-- ── 2. ai_usage_daily rollup ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_usage_daily (
  tenant_id       UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  day             DATE NOT NULL,
  feature         TEXT NOT NULL,
  provider        TEXT NOT NULL,
  requests        INTEGER NOT NULL DEFAULT 0,  -- successful generations
  failed          INTEGER NOT NULL DEFAULT 0,  -- the user got an error
  blocked         INTEGER NOT NULL DEFAULT 0,  -- refused by the monthly allowance
  provider_calls  INTEGER NOT NULL DEFAULT 0,
  input_tokens    BIGINT NOT NULL DEFAULT 0,
  output_tokens   BIGINT NOT NULL DEFAULT 0,
  list_cost_usd   NUMERIC(14,6) NOT NULL DEFAULT 0,
  billed_cost_usd NUMERIC(14,6) NOT NULL DEFAULT 0,
  -- super_admin has no tenant: NULLS NOT DISTINCT keeps its usage in one row
  -- per day/feature/provider instead of one row per request.
  CONSTRAINT ai_usage_daily_key UNIQUE NULLS NOT DISTINCT (tenant_id, day, feature, provider)
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_daily_day ON public.ai_usage_daily (day);

ALTER TABLE public.ai_usage_daily ENABLE ROW LEVEL SECURITY;
-- No policies: read only through the SECURITY DEFINER feeds below.
REVOKE ALL ON public.ai_usage_daily FROM anon, authenticated;

-- Backfill the rollup from the rows logged before metering existed (count
-- only). Guarded so a re-run never double-counts.
INSERT INTO public.ai_usage_daily (tenant_id, day, feature, provider, requests, provider_calls)
SELECT tenant_id, (created_at AT TIME ZONE 'UTC')::date, feature, provider, COUNT(*), COUNT(*)
FROM public.ai_usage_log
WHERE metered = FALSE
  AND NOT EXISTS (SELECT 1 FROM public.ai_usage_daily)
GROUP BY 1, 2, 3, 4;

-- ── 3. tenants: monthly allowance ─────────────────────────────────

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS ai_monthly_request_limit INTEGER,
  ADD COLUMN IF NOT EXISTS ai_monthly_token_limit   BIGINT,
  ADD COLUMN IF NOT EXISTS ai_limit_action          TEXT NOT NULL DEFAULT 'block',
  ADD COLUMN IF NOT EXISTS ai_alert_threshold_pct   SMALLINT NOT NULL DEFAULT 80;

DO $$ BEGIN
  ALTER TABLE public.tenants ADD CONSTRAINT tenants_ai_request_limit_check CHECK (ai_monthly_request_limit IS NULL OR ai_monthly_request_limit >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.tenants ADD CONSTRAINT tenants_ai_token_limit_check CHECK (ai_monthly_token_limit IS NULL OR ai_monthly_token_limit >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.tenants ADD CONSTRAINT tenants_ai_limit_action_check CHECK (ai_limit_action IN ('block', 'warn'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.tenants ADD CONSTRAINT tenants_ai_alert_threshold_check CHECK (ai_alert_threshold_pct BETWEEN 1 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 4. ai_usage_alerts ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_usage_alerts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  month       DATE NOT NULL,
  metric      TEXT NOT NULL CHECK (metric IN ('requests', 'tokens')),
  level       TEXT NOT NULL CHECK (level IN ('warning', 'exceeded')),
  used        BIGINT NOT NULL,
  limit_value BIGINT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_usage_alerts_once UNIQUE (tenant_id, month, metric, level)
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_alerts_created ON public.ai_usage_alerts (created_at DESC);

ALTER TABLE public.ai_usage_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_usage_alerts_select ON public.ai_usage_alerts;
CREATE POLICY ai_usage_alerts_select ON public.ai_usage_alerts FOR SELECT TO authenticated USING (
  (SELECT public.current_user_role()) = 'super_admin'
  OR ((SELECT public.current_user_role()) = 'university_admin' AND tenant_id = (SELECT public.current_tenant_id()))
);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ai_usage_alerts FROM anon, authenticated;
REVOKE ALL ON public.ai_usage_alerts FROM anon;

-- ── 5a. record_ai_usage (service_role only) ───────────────────────

CREATE OR REPLACE FUNCTION public.record_ai_usage(
  p_user            UUID,
  p_feature         TEXT,
  p_provider        TEXT,
  p_model           TEXT,
  p_status          TEXT,
  p_provider_calls  INTEGER,
  p_failed_calls    INTEGER,
  p_input_tokens    BIGINT,
  p_output_tokens   BIGINT,
  p_estimated       BOOLEAN,
  p_list_cost_usd   NUMERIC,
  p_billed_cost_usd NUMERIC,
  p_latency_ms      INTEGER,
  p_detail          JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant    UUID;
  v_day       DATE := (NOW() AT TIME ZONE 'UTC')::date;
  v_month     DATE := date_trunc('month', NOW() AT TIME ZONE 'UTC')::date;
  v_req_limit INTEGER;
  v_tok_limit BIGINT;
  v_pct       SMALLINT;
  v_requests  BIGINT;
  v_tokens    BIGINT;
BEGIN
  IF p_status NOT IN ('success', 'failed', 'blocked') THEN
    RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = '22023';
  END IF;
  IF p_feature IS NULL OR length(p_feature) > 64 OR p_provider IS NULL OR length(p_provider) > 64 THEN
    RAISE EXCEPTION 'INVALID_FEATURE' USING ERRCODE = '22023';
  END IF;

  -- The tenant is re-derived from the user row, never taken from the caller.
  SELECT u.tenant_id INTO v_tenant FROM public.users u WHERE u.id = p_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNKNOWN_USER' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.ai_usage_log (
    tenant_id, user_id, feature, provider, model, status, provider_calls, failed_calls,
    input_tokens, output_tokens, tokens_estimated, list_cost_usd, billed_cost_usd,
    latency_ms, detail, metered
  ) VALUES (
    v_tenant, p_user, p_feature, p_provider, p_model, p_status,
    GREATEST(COALESCE(p_provider_calls, 0), 0), GREATEST(COALESCE(p_failed_calls, 0), 0),
    GREATEST(COALESCE(p_input_tokens, 0), 0), GREATEST(COALESCE(p_output_tokens, 0), 0),
    COALESCE(p_estimated, FALSE),
    GREATEST(COALESCE(p_list_cost_usd, 0), 0), GREATEST(COALESCE(p_billed_cost_usd, 0), 0),
    p_latency_ms, p_detail, TRUE
  );

  INSERT INTO public.ai_usage_daily AS d (
    tenant_id, day, feature, provider, requests, failed, blocked, provider_calls,
    input_tokens, output_tokens, list_cost_usd, billed_cost_usd
  ) VALUES (
    v_tenant, v_day, p_feature, p_provider,
    (p_status = 'success')::int, (p_status = 'failed')::int, (p_status = 'blocked')::int,
    GREATEST(COALESCE(p_provider_calls, 0), 0),
    GREATEST(COALESCE(p_input_tokens, 0), 0), GREATEST(COALESCE(p_output_tokens, 0), 0),
    GREATEST(COALESCE(p_list_cost_usd, 0), 0), GREATEST(COALESCE(p_billed_cost_usd, 0), 0)
  )
  ON CONFLICT ON CONSTRAINT ai_usage_daily_key DO UPDATE SET
    requests        = d.requests        + EXCLUDED.requests,
    failed          = d.failed          + EXCLUDED.failed,
    blocked         = d.blocked         + EXCLUDED.blocked,
    provider_calls  = d.provider_calls  + EXCLUDED.provider_calls,
    input_tokens    = d.input_tokens    + EXCLUDED.input_tokens,
    output_tokens   = d.output_tokens   + EXCLUDED.output_tokens,
    list_cost_usd   = d.list_cost_usd   + EXCLUDED.list_cost_usd,
    billed_cost_usd = d.billed_cost_usd + EXCLUDED.billed_cost_usd;

  -- Threshold alerts: raised once per (tenant, month, metric, level).
  IF v_tenant IS NULL OR p_status = 'blocked' THEN RETURN; END IF;

  SELECT t.ai_monthly_request_limit, t.ai_monthly_token_limit, t.ai_alert_threshold_pct
    INTO v_req_limit, v_tok_limit, v_pct
  FROM public.tenants t WHERE t.id = v_tenant;

  -- A limit of 0 means "AI switched off for this institution" — nothing to warn about.
  IF COALESCE(v_req_limit, 0) = 0 AND COALESCE(v_tok_limit, 0) = 0 THEN RETURN; END IF;

  SELECT COALESCE(SUM(requests), 0), COALESCE(SUM(input_tokens + output_tokens), 0)
    INTO v_requests, v_tokens
  FROM public.ai_usage_daily
  WHERE tenant_id = v_tenant AND day >= v_month;

  IF COALESCE(v_req_limit, 0) > 0 THEN
    IF v_requests >= v_req_limit THEN
      INSERT INTO public.ai_usage_alerts (tenant_id, month, metric, level, used, limit_value)
      VALUES (v_tenant, v_month, 'requests', 'exceeded', v_requests, v_req_limit)
      ON CONFLICT ON CONSTRAINT ai_usage_alerts_once DO NOTHING;
    END IF;
    IF v_requests * 100 >= v_req_limit::bigint * v_pct THEN
      INSERT INTO public.ai_usage_alerts (tenant_id, month, metric, level, used, limit_value)
      VALUES (v_tenant, v_month, 'requests', 'warning', v_requests, v_req_limit)
      ON CONFLICT ON CONSTRAINT ai_usage_alerts_once DO NOTHING;
    END IF;
  END IF;

  IF COALESCE(v_tok_limit, 0) > 0 THEN
    IF v_tokens >= v_tok_limit THEN
      INSERT INTO public.ai_usage_alerts (tenant_id, month, metric, level, used, limit_value)
      VALUES (v_tenant, v_month, 'tokens', 'exceeded', v_tokens, v_tok_limit)
      ON CONFLICT ON CONSTRAINT ai_usage_alerts_once DO NOTHING;
    END IF;
    IF v_tokens * 100 >= v_tok_limit * v_pct THEN
      INSERT INTO public.ai_usage_alerts (tenant_id, month, metric, level, used, limit_value)
      VALUES (v_tenant, v_month, 'tokens', 'warning', v_tokens, v_tok_limit)
      ON CONFLICT ON CONSTRAINT ai_usage_alerts_once DO NOTHING;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_ai_usage(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BIGINT, BIGINT, BOOLEAN, NUMERIC, NUMERIC, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_usage(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BIGINT, BIGINT, BOOLEAN, NUMERIC, NUMERIC, INTEGER, JSONB) TO service_role;

-- ── 5b. check_ai_allowance (service_role only) ────────────────────
-- Soft limit: two requests racing at the boundary can both pass. That is an
-- overshoot of at most a few requests, which is acceptable for an allowance.

CREATE OR REPLACE FUNCTION public.check_ai_allowance(p_user UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant    UUID;
  v_month     DATE := date_trunc('month', NOW() AT TIME ZONE 'UTC')::date;
  v_req_limit INTEGER;
  v_tok_limit BIGINT;
  v_action    TEXT;
  v_requests  BIGINT := 0;
  v_tokens    BIGINT := 0;
  v_over      BOOLEAN;
BEGIN
  SELECT u.tenant_id INTO v_tenant FROM public.users u WHERE u.id = p_user;
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('allowed', TRUE, 'limited', FALSE);
  END IF;

  SELECT t.ai_monthly_request_limit, t.ai_monthly_token_limit, t.ai_limit_action
    INTO v_req_limit, v_tok_limit, v_action
  FROM public.tenants t WHERE t.id = v_tenant;

  IF v_req_limit IS NULL AND v_tok_limit IS NULL THEN
    RETURN jsonb_build_object('allowed', TRUE, 'limited', FALSE, 'tenant_id', v_tenant);
  END IF;

  SELECT COALESCE(SUM(requests), 0), COALESCE(SUM(input_tokens + output_tokens), 0)
    INTO v_requests, v_tokens
  FROM public.ai_usage_daily
  WHERE tenant_id = v_tenant AND day >= v_month;

  v_over := (v_req_limit IS NOT NULL AND v_requests >= v_req_limit)
         OR (v_tok_limit IS NOT NULL AND v_tokens >= v_tok_limit);

  RETURN jsonb_build_object(
    'allowed',       NOT v_over OR v_action = 'warn',
    'limited',       TRUE,
    'over',          v_over,
    'action',        v_action,
    'tenant_id',     v_tenant,
    'requests_used', v_requests,
    'request_limit', v_req_limit,
    'tokens_used',   v_tokens,
    'token_limit',   v_tok_limit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_ai_allowance(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_ai_allowance(UUID) TO service_role;

-- ── 5c. get_ai_usage_report (super_admin) ─────────────────────────

CREATE OR REPLACE FUNCTION public.get_ai_usage_report(p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from  TIMESTAMPTZ;
  v_to    TIMESTAMPTZ;
  v_month DATE := date_trunc('month', NOW() AT TIME ZONE 'UTC')::date;
  v_out   JSONB;
BEGIN
  IF (SELECT public.current_user_role()) IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 400 THEN
    RAISE EXCEPTION 'INVALID_RANGE' USING ERRCODE = '22023';
  END IF;
  v_from := p_from::timestamp AT TIME ZONE 'UTC';
  v_to   := (p_to + 1)::timestamp AT TIME ZONE 'UTC';

  WITH
  rng AS (
    SELECT * FROM public.ai_usage_daily WHERE day BETWEEN p_from AND p_to
  ),
  logs AS (
    SELECT * FROM public.ai_usage_log WHERE created_at >= v_from AND created_at < v_to
  ),
  calls AS (
    -- One row per provider attempt, fallback failures included.
    SELECT c.value AS call
    FROM logs l, jsonb_array_elements(COALESCE(l.detail -> 'calls', '[]'::jsonb)) c
    WHERE l.metered
  ),
  month_usage AS (
    SELECT tenant_id,
           SUM(requests) AS requests,
           SUM(input_tokens + output_tokens) AS tokens,
           SUM(list_cost_usd) AS list_cost
    FROM public.ai_usage_daily WHERE day >= v_month
    GROUP BY tenant_id
  )
  SELECT jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'month', v_month,
    'metering_started_at', (SELECT MIN(created_at) FROM public.ai_usage_log WHERE metered),

    'totals', (
      SELECT jsonb_build_object(
        'requests',        COALESCE(SUM(requests), 0),
        'failed',          COALESCE(SUM(failed), 0),
        'blocked',         COALESCE(SUM(blocked), 0),
        'provider_calls',  COALESCE(SUM(provider_calls), 0),
        'input_tokens',    COALESCE(SUM(input_tokens), 0),
        'output_tokens',   COALESCE(SUM(output_tokens), 0),
        'list_cost_usd',   COALESCE(SUM(list_cost_usd), 0),
        'billed_cost_usd', COALESCE(SUM(billed_cost_usd), 0)
      ) FROM rng
    ),

    -- Current month to date, whatever the selected range (month-end estimate).
    'month_totals', (
      SELECT jsonb_build_object(
        'requests',        COALESCE(SUM(requests), 0),
        'tokens',          COALESCE(SUM(input_tokens + output_tokens), 0),
        'list_cost_usd',   COALESCE(SUM(list_cost_usd), 0),
        'billed_cost_usd', COALESCE(SUM(billed_cost_usd), 0)
      ) FROM public.ai_usage_daily WHERE day >= v_month
    ),

    'latency', (
      SELECT jsonb_build_object(
        'avg_ms', ROUND(AVG(latency_ms)),
        'p95_ms', ROUND((percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms))::numeric)
      )
      FROM logs WHERE status = 'success' AND latency_ms IS NOT NULL
    ),

    'series', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'day', day, 'feature', feature, 'requests', r, 'failed', f,
        'tokens', tk, 'list_cost_usd', c) ORDER BY day, feature)
      FROM (
        SELECT day, feature, SUM(requests) r, SUM(failed) f,
               SUM(input_tokens + output_tokens) tk, SUM(list_cost_usd) c
        FROM rng GROUP BY day, feature
      ) s
    ), '[]'::jsonb),

    'by_feature', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'feature', feature, 'requests', r, 'failed', f, 'blocked', b,
        'input_tokens', i, 'output_tokens', o, 'list_cost_usd', c) ORDER BY r DESC, feature)
      FROM (
        SELECT feature, SUM(requests) r, SUM(failed) f, SUM(blocked) b,
               SUM(input_tokens) i, SUM(output_tokens) o, SUM(list_cost_usd) c
        FROM rng GROUP BY feature
      ) s
    ), '[]'::jsonb),

    'by_tenant', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'tenant_id', t.id,
        'tenant_name', t.name,
        'is_active', t.is_active,
        'requests', COALESCE(r.requests, 0),
        'failed', COALESCE(r.failed, 0),
        'blocked', COALESCE(r.blocked, 0),
        'input_tokens', COALESCE(r.i, 0),
        'output_tokens', COALESCE(r.o, 0),
        'list_cost_usd', COALESCE(r.c, 0),
        'billed_cost_usd', COALESCE(r.bc, 0),
        'last_used_at', (SELECT MAX(created_at) FROM public.ai_usage_log x WHERE x.tenant_id = t.id),
        'month_requests', COALESCE(m.requests, 0),
        'month_tokens', COALESCE(m.tokens, 0),
        'month_list_cost_usd', COALESCE(m.list_cost, 0),
        'request_limit', t.ai_monthly_request_limit,
        'token_limit', t.ai_monthly_token_limit,
        'limit_action', t.ai_limit_action,
        'alert_threshold_pct', t.ai_alert_threshold_pct,
        'alerts', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('metric', a.metric, 'level', a.level, 'created_at', a.created_at) ORDER BY a.created_at)
          FROM public.ai_usage_alerts a WHERE a.tenant_id = t.id AND a.month = v_month
        ), '[]'::jsonb)
      ) ORDER BY COALESCE(r.requests, 0) DESC, t.name)
      FROM public.tenants t
      LEFT JOIN (
        SELECT tenant_id, SUM(requests) requests, SUM(failed) failed, SUM(blocked) blocked,
               SUM(input_tokens) i, SUM(output_tokens) o, SUM(list_cost_usd) c, SUM(billed_cost_usd) bc
        FROM rng GROUP BY tenant_id
      ) r ON r.tenant_id = t.id
      LEFT JOIN month_usage m ON m.tenant_id = t.id
    ), '[]'::jsonb),

    -- Usage by the platform owner's own account (no tenant).
    'platform', (
      SELECT jsonb_build_object(
        'requests', COALESCE(SUM(requests), 0),
        'input_tokens', COALESCE(SUM(input_tokens), 0),
        'output_tokens', COALESCE(SUM(output_tokens), 0),
        'list_cost_usd', COALESCE(SUM(list_cost_usd), 0)
      ) FROM rng WHERE tenant_id IS NULL
    ),

    'providers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'provider', p, 'model', m, 'attempts', n, 'failures', nf,
        'input_tokens', i, 'output_tokens', o, 'list_cost_usd', c,
        'avg_ms', ms, 'estimated', est, 'unpriced', np) ORDER BY n DESC, p)
      FROM (
        SELECT call ->> 'p' AS p,
               call ->> 'm' AS m,
               COUNT(*) AS n,
               COUNT(*) FILTER (WHERE NOT COALESCE((call ->> 'ok')::boolean, FALSE)) AS nf,
               COALESCE(SUM((call ->> 'in')::bigint), 0) AS i,
               COALESCE(SUM((call ->> 'out')::bigint), 0) AS o,
               COALESCE(SUM((call ->> 'cost')::numeric), 0) AS c,
               ROUND(AVG((call ->> 'ms')::numeric) FILTER (WHERE COALESCE((call ->> 'ok')::boolean, FALSE))) AS ms,
               BOOL_OR(COALESCE((call ->> 'est')::boolean, FALSE)) AS est,
               BOOL_OR(COALESCE((call ->> 'np')::boolean, FALSE)) AS np
        FROM calls
        GROUP BY 1, 2
      ) s
    ), '[]'::jsonb),

    'top_users', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', s.user_id, 'full_name', u.full_name, 'email', u.email, 'role', u.role,
        'tenant_name', tn.name, 'requests', s.r, 'tokens', s.tk, 'list_cost_usd', s.c) ORDER BY s.r DESC, s.tk DESC)
      FROM (
        SELECT user_id,
               COUNT(*) FILTER (WHERE status = 'success') r,
               SUM(input_tokens + output_tokens) tk,
               SUM(list_cost_usd) c
        FROM logs WHERE user_id IS NOT NULL
        GROUP BY user_id
        ORDER BY COUNT(*) FILTER (WHERE status = 'success') DESC, SUM(input_tokens + output_tokens) DESC
        LIMIT 10
      ) s
      JOIN public.users u ON u.id = s.user_id
      LEFT JOIN public.tenants tn ON tn.id = u.tenant_id
    ), '[]'::jsonb),

    'recent_failures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'created_at', f.created_at, 'feature', f.feature, 'status', f.status,
        'tenant_name', tn.name, 'errors', COALESCE((
          SELECT jsonb_agg(DISTINCT c ->> 'err') FROM jsonb_array_elements(COALESCE(f.detail -> 'calls', '[]'::jsonb)) c
          WHERE c ->> 'err' IS NOT NULL
        ), '[]'::jsonb)) ORDER BY f.created_at DESC)
      FROM (
        SELECT * FROM logs WHERE status IN ('failed', 'blocked') ORDER BY created_at DESC LIMIT 20
      ) f
      LEFT JOIN public.tenants tn ON tn.id = f.tenant_id
    ), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.get_ai_usage_report(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ai_usage_report(DATE, DATE) TO authenticated;

-- ── 5d. get_my_ai_allowance (institution staff) ───────────────────
-- The institution's own month: counts and limits only — never cost, never
-- other institutions, never who asked what.

CREATE OR REPLACE FUNCTION public.get_my_ai_allowance()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role   TEXT := (SELECT public.current_user_role());
  v_tenant UUID := (SELECT public.current_tenant_id());
  v_month  DATE := date_trunc('month', NOW() AT TIME ZONE 'UTC')::date;
  v_out    JSONB;
BEGIN
  IF COALESCE(v_role, '') NOT IN ('university_admin', 'center_manager') OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'month', v_month,
    'request_limit', t.ai_monthly_request_limit,
    'token_limit', t.ai_monthly_token_limit,
    'limit_action', t.ai_limit_action,
    'alert_threshold_pct', t.ai_alert_threshold_pct,
    'requests_used', COALESCE((SELECT SUM(requests) FROM public.ai_usage_daily d WHERE d.tenant_id = v_tenant AND d.day >= v_month), 0),
    'tokens_used', COALESCE((SELECT SUM(input_tokens + output_tokens) FROM public.ai_usage_daily d WHERE d.tenant_id = v_tenant AND d.day >= v_month), 0),
    'by_feature', COALESCE((
      SELECT jsonb_object_agg(feature, r) FROM (
        SELECT feature, SUM(requests) r FROM public.ai_usage_daily d
        WHERE d.tenant_id = v_tenant AND d.day >= v_month GROUP BY feature
      ) s
    ), '{}'::jsonb)
  ) INTO v_out
  FROM public.tenants t WHERE t.id = v_tenant;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_ai_allowance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_ai_allowance() TO authenticated;

-- Verify (as super_admin):   SELECT get_ai_usage_report(CURRENT_DATE - 29, CURRENT_DATE);
-- Verify (as uni admin):     SELECT get_my_ai_allowance();
-- Grant matrix:
--   SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') auth
--   FROM pg_proc p WHERE p.proname IN ('record_ai_usage','check_ai_allowance','get_ai_usage_report','get_my_ai_allowance');
