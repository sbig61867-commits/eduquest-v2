// Shapes + pure helpers for the super_admin AI usage dashboard. The report
// itself is one JSONB value from get_ai_usage_report() — see
// supabase/ai_usage_metering_migration.sql. Kept free of React/Supabase so the
// date and projection maths can be unit-tested.

export const USAGE_RANGES = ['7', '30', '90', 'month', 'prev'] as const
export type UsageRange = (typeof USAGE_RANGES)[number]

export function toUsageRange(v: string | undefined): UsageRange {
  return (USAGE_RANGES as readonly string[]).includes(v ?? '') ? (v as UsageRange) : '30'
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** Inclusive UTC date range for a period key. */
export function resolveUsageRange(range: UsageRange, now: Date = new Date()): { from: string; to: string } {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  if (range === 'month') {
    return { from: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), to: iso(today) }
  }
  if (range === 'prev') {
    const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))
    const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0))
    return { from: iso(first), to: iso(last) }
  }
  const days = Number(range)
  const from = new Date(today)
  from.setUTCDate(from.getUTCDate() - (days - 1))
  return { from: iso(from), to: iso(today) }
}

/** Every day in [from, to] as YYYY-MM-DD — the chart shows empty days as 0, not gaps. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  const d = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (d <= end && out.length < 500) {
    out.push(iso(d))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

/**
 * Straight-line month-end estimate from the month so far. At least one full
 * day is assumed elapsed, so a busy first hour of the month does not project
 * to an absurd figure.
 */
export function projectMonthEnd(monthToDate: number, now: Date = new Date()): number {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
  const elapsedDays = Math.max((now.getTime() - start) / 86_400_000, 1)
  return (monthToDate / elapsedDays) * daysInMonth
}

export interface UsageTotals {
  requests: number
  failed: number
  blocked: number
  provider_calls: number
  input_tokens: number
  output_tokens: number
  list_cost_usd: number
  billed_cost_usd: number
}

export interface UsageSeriesRow {
  day: string
  feature: string
  requests: number
  failed: number
  tokens: number
  list_cost_usd: number
}

export interface UsageFeatureRow {
  feature: string
  requests: number
  failed: number
  blocked: number
  input_tokens: number
  output_tokens: number
  list_cost_usd: number
}

export interface UsageAlert {
  metric: 'requests' | 'tokens'
  level: 'warning' | 'exceeded'
  created_at: string
}

export interface UsageTenantRow {
  tenant_id: string
  tenant_name: string
  is_active: boolean
  requests: number
  failed: number
  blocked: number
  input_tokens: number
  output_tokens: number
  list_cost_usd: number
  billed_cost_usd: number
  last_used_at: string | null
  month_requests: number
  month_tokens: number
  month_list_cost_usd: number
  request_limit: number | null
  token_limit: number | null
  limit_action: 'block' | 'warn'
  alert_threshold_pct: number
  alerts: UsageAlert[]
}

export interface UsageProviderRow {
  provider: string
  model: string | null
  attempts: number
  failures: number
  input_tokens: number
  output_tokens: number
  list_cost_usd: number
  avg_ms: number | null
  estimated: boolean
  unpriced: boolean
}

export interface UsageUserRow {
  user_id: string
  full_name: string | null
  email: string | null
  role: string
  tenant_name: string | null
  requests: number
  tokens: number
  list_cost_usd: number
}

export interface UsageFailureRow {
  created_at: string
  feature: string
  status: 'failed' | 'blocked'
  tenant_name: string | null
  errors: string[]
}

export interface AiUsageReport {
  from: string
  to: string
  month: string
  metering_started_at: string | null
  totals: UsageTotals
  month_totals: { requests: number; tokens: number; list_cost_usd: number; billed_cost_usd: number }
  latency: { avg_ms: number | null; p95_ms: number | null }
  series: UsageSeriesRow[]
  by_feature: UsageFeatureRow[]
  by_tenant: UsageTenantRow[]
  platform: { requests: number; input_tokens: number; output_tokens: number; list_cost_usd: number }
  providers: UsageProviderRow[]
  top_users: UsageUserRow[]
  recent_failures: UsageFailureRow[]
}

/** Share of a limit, 0..∞ (null when there is no limit; 0 limit = AI off). */
export function usageShare(used: number, limit: number | null): number | null {
  if (limit == null) return null
  if (limit === 0) return used > 0 ? Infinity : 1
  return used / limit
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** A spreadsheet-friendly export: one section per table, UTF-8 with BOM for Excel. */
export function usageReportCsv(r: AiUsageReport): string {
  const rows: unknown[][] = []
  rows.push(['period', r.from, r.to])
  rows.push([])
  rows.push(['day', 'feature', 'requests', 'failed', 'tokens', 'equivalent_cost_usd'])
  for (const s of r.series) rows.push([s.day, s.feature, s.requests, s.failed, s.tokens, s.list_cost_usd])
  rows.push([])
  rows.push(['institution', 'requests', 'failed', 'blocked', 'input_tokens', 'output_tokens', 'equivalent_cost_usd', 'billed_cost_usd', 'month_requests', 'month_tokens', 'request_limit', 'token_limit', 'limit_action'])
  for (const t of r.by_tenant) {
    rows.push([t.tenant_name, t.requests, t.failed, t.blocked, t.input_tokens, t.output_tokens, t.list_cost_usd, t.billed_cost_usd, t.month_requests, t.month_tokens, t.request_limit ?? '', t.token_limit ?? '', t.limit_action])
  }
  rows.push([])
  rows.push(['feature', 'requests', 'failed', 'blocked', 'input_tokens', 'output_tokens', 'equivalent_cost_usd'])
  for (const f of r.by_feature) rows.push([f.feature, f.requests, f.failed, f.blocked, f.input_tokens, f.output_tokens, f.list_cost_usd])
  rows.push([])
  rows.push(['provider', 'model', 'attempts', 'failures', 'input_tokens', 'output_tokens', 'equivalent_cost_usd', 'avg_ms'])
  for (const p of r.providers) rows.push([p.provider, p.model, p.attempts, p.failures, p.input_tokens, p.output_tokens, p.list_cost_usd, p.avg_ms ?? ''])
  return '﻿' + rows.map(row => row.map(csvCell).join(',')).join('\n') + '\n'
}
