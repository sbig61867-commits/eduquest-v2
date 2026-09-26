'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Download, Info, AlertTriangle, Ban, SlidersHorizontal } from 'lucide-react'
import type { Locale } from '@/i18n/config'
import { cn, formatDate, formatDateTime } from '@/lib/utils'
import type { AiPricing } from '@/lib/ai/pricing'
import { usageFormatters } from '@/lib/ai/usage-format'
import {
  USAGE_RANGES, projectMonthEnd, usageReportCsv, usageShare,
  type AiUsageReport, type UsageRange, type UsageTenantRow,
} from '@/lib/ai/usage-report'
import { UsageChart } from './usage-chart'
import { TenantLimitsModal } from './tenant-limits-modal'
import { PricingEditor } from './pricing-editor'

const n = (v: unknown) => Number(v ?? 0)

function Section({ title, hint, children, className }: { title: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('bg-slate-900 border border-slate-800 rounded-xl overflow-hidden', className)}>
      <div className="px-5 py-4 border-b border-slate-800">
        <h3 className="text-white font-semibold">{title}</h3>
        {hint && <p className="text-slate-500 text-xs mt-1">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Th({ children, end }: { children?: React.ReactNode; end?: boolean }) {
  return <th className={cn('px-5 py-2.5 text-xs font-medium text-slate-400 whitespace-nowrap', end ? 'text-end' : 'text-start')}>{children}</th>
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 min-w-0">
      <p className="text-slate-400 text-xs">{label}</p>
      <p className="text-2xl font-bold text-white mt-2 tabular-nums truncate">{value}</p>
      {hint && <p className="text-slate-500 text-xs mt-1 truncate" title={hint}>{hint}</p>}
    </div>
  )
}

/** Usage against a limit. State is carried by text as well as colour. */
function AllowanceBar({ label, share, threshold }: { label: string; share: number | null; threshold: number }) {
  const pct = share == null ? 0 : Math.min(share, 1) * 100
  const tone = share == null ? 'bg-blue-500'
    : share >= 1 ? 'bg-red-500'
    : share * 100 >= threshold ? 'bg-amber-500'
    : 'bg-blue-500'
  return (
    <div className="min-w-40">
      <p className="text-xs text-slate-300 tabular-nums">{label}</p>
      {share != null && (
        <div className="h-1.5 mt-1 rounded-full bg-slate-800 overflow-hidden">
          <div className={cn('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

export function AiUsageClient({ report, range, pricing, defaultPricing }: {
  report: AiUsageReport
  range: UsageRange
  pricing: AiPricing
  defaultPricing: AiPricing
}) {
  const t = useTranslations('superAdmin.aiUsage')
  const tf = useTranslations('common.aiFeatures')
  const locale = useLocale() as Locale
  const fmt = useMemo(() => usageFormatters(locale), [locale])
  const [editing, setEditing] = useState<UsageTenantRow | null>(null)

  const featureLabel = (f: string) => (tf.has(f) ? tf(f) : f)

  const totals = report.totals
  const requests = n(totals.requests)
  const failed = n(totals.failed)
  const tokens = n(totals.input_tokens) + n(totals.output_tokens)
  const listCost = n(totals.list_cost_usd)
  const attempted = requests + failed
  const projection = projectMonthEnd(n(report.month_totals?.list_cost_usd))
  const platform = report.platform
  const meteringStart = report.metering_started_at

  function exportCsv() {
    const blob = new Blob([usageReportCsv(report)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ai-usage_${report.from}_${report.to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* Filters: one row above everything they control. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={t('period')} className="flex flex-wrap rounded-lg border border-slate-700 overflow-hidden">
          {USAGE_RANGES.map(r => (
            <Link
              key={r}
              href={`?range=${r}`}
              aria-current={r === range ? 'page' : undefined}
              className={cn(
                'px-3 py-1.5 text-sm transition-colors',
                r === range ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
              )}
            >
              {t(`ranges.${r}`)}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <span className="text-slate-500 text-xs">{t('utcNote')}</span>
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-slate-300 border border-slate-700 hover:bg-slate-800 hover:text-white"
          >
            <Download className="w-4 h-4" /> {t('exportCsv')}
          </button>
        </div>
      </div>

      <div className="flex gap-3 bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
        <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="text-white font-medium">{t('freeTier.title')}</p>
          <p className="text-slate-300 mt-1">{t('freeTier.body')}</p>
          {pricing.billedProviders.length > 0 && (
            <p className="text-amber-300 mt-2">{t('freeTier.billed', { providers: pricing.billedProviders.join(', ') })}</p>
          )}
          {meteringStart && meteringStart.slice(0, 10) > report.from && (
            <p className="text-slate-400 text-xs mt-2">{t('legacyNote', { date: formatDate(meteringStart, locale) })}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label={t('kpi.requests')} value={fmt.int(requests)}
          hint={t('kpi.requestsHint', { failed: fmt.int(failed), blocked: fmt.int(n(totals.blocked)) })} />
        <Kpi label={t('kpi.successRate')} value={attempted ? fmt.pct(requests / attempted) : '·'}
          hint={t('kpi.successRateHint', { calls: fmt.int(n(totals.provider_calls)) })} />
        <Kpi label={t('kpi.tokens')} value={fmt.compact(tokens)}
          hint={t('kpi.tokensHint', { input: fmt.compact(n(totals.input_tokens)), output: fmt.compact(n(totals.output_tokens)) })} />
        <Kpi label={t('kpi.listCost')} value={fmt.usd(listCost)} hint={t('kpi.listCostHint')} />
        <Kpi label={t('kpi.billedCost')} value={fmt.usd(n(totals.billed_cost_usd))} hint={t('kpi.billedCostHint')} />
        <Kpi label={t('kpi.projection')} value={fmt.usd(projection)} hint={t('kpi.projectionHint')} />
        <Kpi label={t('kpi.avgCost')} value={requests ? fmt.usd(listCost / requests) : '·'}
          hint={t('kpi.avgCostHint', { tokens: requests ? fmt.int(tokens / requests) : '·' })} />
        <Kpi label={t('kpi.latency')} value={fmt.duration(report.latency?.avg_ms ?? null)}
          hint={report.latency?.p95_ms != null ? t('kpi.latencyHint', { p95: fmt.duration(report.latency.p95_ms) }) : undefined} />
      </div>

      <UsageChart series={report.series} from={report.from} to={report.to} fmt={fmt} featureLabel={featureLabel} />

      <Section title={t('tenants.title')}>
        {report.by_tenant.length === 0 ? (
          <p className="text-slate-500 text-sm p-5">{t('tenants.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <Th>{t('tenants.columns.tenant')}</Th>
                  <Th end>{t('tenants.columns.requests')}</Th>
                  <Th end>{t('tenants.columns.tokens')}</Th>
                  <Th end>{t('tenants.columns.cost')}</Th>
                  <Th>{t('tenants.columns.month')}</Th>
                  <Th end>{t('tenants.columns.lastUsed')}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {report.by_tenant.map(row => {
                  const reqShare = usageShare(n(row.month_requests), row.request_limit)
                  const tokShare = usageShare(n(row.month_tokens), row.token_limit)
                  const unlimited = row.request_limit == null && row.token_limit == null
                  const aiOff = row.request_limit === 0 || row.token_limit === 0
                  const exceeded = row.alerts.some(a => a.level === 'exceeded')
                  const warned = !exceeded && row.alerts.some(a => a.level === 'warning')
                  return (
                    <tr key={row.tenant_id} className="hover:bg-slate-800/40 align-top">
                      <td className="px-5 py-3">
                        <p className="text-white font-medium">{row.tenant_name}</p>
                        {!row.is_active && <p className="text-slate-500 text-xs mt-0.5">{t('tenants.inactive')}</p>}
                      </td>
                      <td className="px-5 py-3 text-end text-white tabular-nums">
                        {fmt.int(n(row.requests))}
                        {n(row.failed) + n(row.blocked) > 0 && (
                          <p className="text-slate-500 text-xs">{t('kpi.requestsHint', { failed: fmt.int(n(row.failed)), blocked: fmt.int(n(row.blocked)) })}</p>
                        )}
                      </td>
                      <td className="px-5 py-3 text-end text-slate-300 tabular-nums">{fmt.compact(n(row.input_tokens) + n(row.output_tokens))}</td>
                      <td className="px-5 py-3 text-end text-slate-300 tabular-nums">{fmt.usd(n(row.list_cost_usd))}</td>
                      <td className="px-5 py-3">
                        {unlimited ? (
                          <div>
                            <p className="text-xs text-slate-300 tabular-nums">{t('tenants.requestsUsed', { used: fmt.int(n(row.month_requests)) })}</p>
                            <p className="text-xs text-slate-500">{t('tenants.unlimited')}</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {row.request_limit != null && (
                              <AllowanceBar share={reqShare} threshold={row.alert_threshold_pct}
                                label={t('tenants.requestsOf', { used: fmt.int(n(row.month_requests)), limit: fmt.int(row.request_limit) })} />
                            )}
                            {row.token_limit != null && (
                              <AllowanceBar share={tokShare} threshold={row.alert_threshold_pct}
                                label={t('tenants.tokensOf', { used: fmt.compact(n(row.month_tokens)), limit: fmt.compact(row.token_limit) })} />
                            )}
                            <div className="flex flex-wrap gap-1.5">
                              {aiOff && <Badge tone="red" icon={<Ban className="w-3 h-3" />}>{t('tenants.aiOff')}</Badge>}
                              {!aiOff && exceeded && <Badge tone="red" icon={<AlertTriangle className="w-3 h-3" />}>{t('tenants.alertExceeded')}</Badge>}
                              {!aiOff && warned && <Badge tone="amber" icon={<AlertTriangle className="w-3 h-3" />}>{t('tenants.alertWarning', { pct: row.alert_threshold_pct })}</Badge>}
                              <Badge tone="slate">{row.limit_action === 'warn' ? t('tenants.modeWarn') : t('tenants.modeBlock')}</Badge>
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-end text-slate-400 whitespace-nowrap">{row.last_used_at ? formatDate(row.last_used_at, locale) : '·'}</td>
                      <td className="px-5 py-3 text-end">
                        <button
                          onClick={() => setEditing(row)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-blue-400 hover:text-blue-300 hover:bg-slate-800 whitespace-nowrap"
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5" /> {t('tenants.edit')}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {n(platform?.requests) > 0 && (
          <p className="px-5 py-3 border-t border-slate-800 text-slate-500 text-xs">
            {t('platformUsage', { requests: fmt.int(n(platform.requests)), cost: fmt.usd(n(platform.list_cost_usd)) })}
          </p>
        )}
      </Section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Section title={t('features.title')}>
          {report.by_feature.length === 0 ? (
            <p className="text-slate-500 text-sm p-5">{t('features.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <Th>{t('features.columns.feature')}</Th>
                    <Th end>{t('features.columns.requests')}</Th>
                    <Th end>{t('features.columns.avgTokens')}</Th>
                    <Th end>{t('features.columns.cost')}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {report.by_feature.map(f => {
                    const fReq = n(f.requests)
                    const fTok = n(f.input_tokens) + n(f.output_tokens)
                    const share = requests ? fReq / requests : 0
                    return (
                      <tr key={f.feature}>
                        <td className="px-5 py-3">
                          <p className="text-slate-200">{featureLabel(f.feature)}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="h-1 w-24 rounded-full bg-slate-800 overflow-hidden">
                              <div className="h-full rounded-full bg-blue-500" style={{ width: `${share * 100}%` }} />
                            </div>
                            <span className="text-slate-500 text-xs tabular-nums">{fmt.pct(share)}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-end text-white tabular-nums">
                          {fmt.int(fReq)}
                          {n(f.failed) > 0 && <p className="text-slate-500 text-xs">{t('chart.failed', { count: fmt.int(n(f.failed)) })}</p>}
                        </td>
                        <td className="px-5 py-3 text-end text-slate-300 tabular-nums">{fReq ? fmt.int(fTok / fReq) : '·'}</td>
                        <td className="px-5 py-3 text-end text-slate-300 tabular-nums">{fmt.usd(n(f.list_cost_usd))}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title={t('providers.title')} hint={t('providers.hint')}>
          {report.providers.length === 0 ? (
            <p className="text-slate-500 text-sm p-5">{t('providers.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <Th>{t('providers.columns.provider')}</Th>
                    <Th end>{t('providers.columns.attempts')}</Th>
                    <Th end>{t('providers.columns.failureRate')}</Th>
                    <Th end>{t('providers.columns.avgMs')}</Th>
                    <Th end>{t('providers.columns.cost')}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {report.providers.map(p => {
                    const attempts = n(p.attempts)
                    const failRate = attempts ? n(p.failures) / attempts : 0
                    return (
                      <tr key={`${p.provider}:${p.model}`}>
                        <td className="px-5 py-3">
                          <p className="text-slate-200 capitalize">{p.provider}</p>
                          <p className="text-slate-500 text-xs font-mono" dir="ltr">{p.model ?? '·'}</p>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {p.estimated && <Badge tone="slate">{t('providers.estimated')}</Badge>}
                            {p.unpriced && <span title={t('providers.unpricedHint')}><Badge tone="amber">{t('providers.unpriced')}</Badge></span>}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-end text-white tabular-nums">{fmt.int(attempts)}</td>
                        <td className={cn('px-5 py-3 text-end tabular-nums', failRate >= 0.2 ? 'text-amber-300' : 'text-slate-300')}>{fmt.pct(failRate)}</td>
                        <td className="px-5 py-3 text-end text-slate-300 tabular-nums whitespace-nowrap">{fmt.duration(p.avg_ms)}</td>
                        <td className="px-5 py-3 text-end text-slate-300 tabular-nums">
                          {fmt.usd(n(p.list_cost_usd))}
                          <p className="text-slate-500 text-xs">{fmt.compact(n(p.input_tokens) + n(p.output_tokens))}</p>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Section title={t('users.title')}>
          {report.top_users.length === 0 ? (
            <p className="text-slate-500 text-sm p-5">{t('users.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <Th>{t('users.columns.user')}</Th>
                    <Th end>{t('users.columns.requests')}</Th>
                    <Th end>{t('users.columns.tokens')}</Th>
                    <Th end>{t('users.columns.cost')}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {report.top_users.map(u => (
                    <tr key={u.user_id}>
                      <td className="px-5 py-3 min-w-0">
                        <p className="text-slate-200 truncate">{u.full_name || u.email}</p>
                        <p className="text-slate-500 text-xs truncate">{u.tenant_name ?? t('users.platform')}</p>
                      </td>
                      <td className="px-5 py-3 text-end text-white tabular-nums">{fmt.int(n(u.requests))}</td>
                      <td className="px-5 py-3 text-end text-slate-300 tabular-nums">{fmt.compact(n(u.tokens))}</td>
                      <td className="px-5 py-3 text-end text-slate-300 tabular-nums">{fmt.usd(n(u.list_cost_usd))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title={t('failures.title')}>
          {report.recent_failures.length === 0 ? (
            <p className="text-slate-500 text-sm p-5">{t('failures.empty')}</p>
          ) : (
            <ul className="divide-y divide-slate-800 max-h-96 overflow-y-auto">
              {report.recent_failures.map((f, i) => (
                <li key={`${f.created_at}-${i}`} className="px-5 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-slate-200 text-sm">{featureLabel(f.feature)}</p>
                    <p className="text-slate-500 text-xs mt-0.5">
                      {[f.tenant_name ?? t('users.platform'), f.errors.length ? t('failures.codes', { codes: f.errors.join(', ') }) : null].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="text-end shrink-0">
                    {f.status === 'blocked'
                      ? <Badge tone="amber" icon={<Ban className="w-3 h-3" />}>{t('failures.blocked')}</Badge>
                      : <Badge tone="red" icon={<AlertTriangle className="w-3 h-3" />}>{t('failures.failed')}</Badge>}
                    <p className="text-slate-500 text-xs mt-1 whitespace-nowrap">{formatDateTime(f.created_at, locale)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <PricingEditor pricing={pricing} defaults={defaultPricing} />

      {editing && <TenantLimitsModal tenant={editing} fmt={fmt} onClose={() => setEditing(null)} />}
    </div>
  )
}

function Badge({ tone, icon, children }: { tone: 'red' | 'amber' | 'slate'; icon?: React.ReactNode; children: React.ReactNode }) {
  const tones = {
    red: 'text-red-300 bg-red-500/10 border-red-500/30',
    amber: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
    slate: 'text-slate-400 bg-slate-800 border-slate-700',
  }
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap', tones[tone])}>
      {icon}{children}
    </span>
  )
}
