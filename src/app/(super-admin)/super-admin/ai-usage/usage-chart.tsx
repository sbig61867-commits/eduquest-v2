'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { daysBetween, type UsageSeriesRow } from '@/lib/ai/usage-report'
import type { UsageFormatters } from '@/lib/ai/usage-format'

type Metric = 'requests' | 'tokens' | 'cost'
const METRICS: Metric[] = ['requests', 'tokens', 'cost']

interface DayBucket {
  day: string
  requests: number
  failed: number
  tokens: number
  cost: number
}

// One series (the day's total), so a single hue carries no identity job and
// needs no legend: the metric toggle names what the bars mean. The per-feature
// split lives in the tooltip and in the "By feature" table, instead of a
// ten-colour stack no one could tell apart.
export function UsageChart({ series, from, to, fmt, featureLabel }: {
  series: UsageSeriesRow[]
  from: string
  to: string
  fmt: UsageFormatters
  featureLabel: (f: string) => string
}) {
  const t = useTranslations('superAdmin.aiUsage.chart')
  const [metric, setMetric] = useState<Metric>('requests')
  const [hover, setHover] = useState<number | null>(null)
  const [asTable, setAsTable] = useState(false)

  const buckets = useMemo<DayBucket[]>(() => {
    const map = new Map<string, DayBucket>()
    for (const day of daysBetween(from, to)) {
      map.set(day, { day, requests: 0, failed: 0, tokens: 0, cost: 0 })
    }
    for (const row of series) {
      const b = map.get(row.day)
      if (!b) continue
      b.requests += Number(row.requests)
      b.failed += Number(row.failed)
      b.tokens += Number(row.tokens)
      b.cost += Number(row.list_cost_usd)
    }
    return [...map.values()]
  }, [series, from, to])

  const valueOf = (b: { requests: number; tokens: number; cost: number }) =>
    metric === 'requests' ? b.requests : metric === 'tokens' ? b.tokens : b.cost
  const format = (v: number) => (metric === 'cost' ? fmt.usd(v) : fmt.compact(v))

  const max = Math.max(0, ...buckets.map(valueOf))
  const hasData = max > 0
  const hovered = hover != null ? buckets[hover] : null

  const featureSplit = (day: string) =>
    series
      .filter(r => r.day === day)
      .map(r => ({ feature: r.feature, value: metric === 'requests' ? Number(r.requests) : metric === 'tokens' ? Number(r.tokens) : Number(r.list_cost_usd) }))
      .filter(x => x.value > 0)
      .sort((a, b) => b.value - a.value)

  const labelIdx = buckets.length <= 1 ? [0] : [0, Math.floor((buckets.length - 1) / 2), buckets.length - 1]

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="text-white font-semibold">{t('title')}</h3>
        <div className="flex items-center gap-2">
          <div role="tablist" className="flex rounded-lg border border-slate-700 overflow-hidden">
            {METRICS.map(m => (
              <button
                key={m}
                role="tab"
                aria-selected={metric === m}
                onClick={() => setMetric(m)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition-colors',
                  metric === m ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
                )}
              >
                {t(`metric.${m}`)}
              </button>
            ))}
          </div>
          <button
            onClick={() => setAsTable(v => !v)}
            className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-700"
          >
            {asTable ? t('hideTable') : t('showTable')}
          </button>
        </div>
      </div>

      {!hasData ? (
        <p className="text-slate-500 text-sm py-10 text-center">{t('empty')}</p>
      ) : asTable ? (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-900">
              <tr className="border-b border-slate-800">
                <th className="text-start py-2 text-xs font-medium text-slate-400">{t('day')}</th>
                <th className="text-end py-2 text-xs font-medium text-slate-400">{t(`metric.${metric}`)}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {buckets.filter(b => valueOf(b) > 0 || b.failed > 0).map(b => (
                <tr key={b.day}>
                  <td className="py-2 text-slate-300">{fmt.day(b.day)}</td>
                  <td className="py-2 text-end text-white tabular-nums">
                    {format(valueOf(b))}
                    {b.failed > 0 && <span className="text-slate-500 text-xs ms-2">{t('failed', { count: fmt.int(b.failed) })}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          {/* Recessive grid: three lines, labelled at the start edge. */}
          <div className="relative h-56" role="img" aria-label={t('ariaLabel')}>
            {[1, 0.5, 0].map(f => (
              <div key={f} className="absolute inset-x-0 border-t border-slate-800" style={{ bottom: `${f * 100}%` }}>
                <span className="absolute -top-2.5 start-0 text-[10px] text-slate-500 bg-slate-900 pe-1 tabular-nums">
                  {format(max * f)}
                </span>
              </div>
            ))}
            <div className="absolute inset-0 ps-12 flex items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
              {buckets.map((b, i) => {
                const v = valueOf(b)
                const h = v > 0 ? Math.max((v / max) * 100, 1.5) : 0
                return (
                  // The hit target is the whole column, wider and taller than the bar.
                  <div
                    key={b.day}
                    className="relative flex-1 h-full flex items-end cursor-default"
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    tabIndex={v > 0 ? 0 : -1}
                    aria-label={`${fmt.day(b.day)}: ${format(v)}`}
                  >
                    <div
                      className={cn('w-full rounded-t-[4px] transition-colors', hover === i ? 'bg-blue-400' : 'bg-blue-500')}
                      style={{ height: `${h}%` }}
                    />
                  </div>
                )
              })}
            </div>
          </div>

          <div className="ps-12 mt-2 flex justify-between text-[10px] text-slate-500 tabular-nums">
            {labelIdx.map(i => <span key={i}>{fmt.day(buckets[i].day)}</span>)}
          </div>

          {hovered && (
            // Anchored over the hovered column's centre, clamped inside the plot.
            // Logical inset, so the same maths holds in RTL, where the columns run
            // from the right.
            <div className="pointer-events-none absolute inset-x-0 top-0 ps-12">
              <div className="relative">
                <div
                  className="absolute top-0 z-10 w-56 bg-slate-950 border border-slate-700 rounded-lg p-3 shadow-xl text-xs"
                  style={{ insetInlineStart: `max(0px, min(calc(${((hover! + 0.5) / buckets.length) * 100}% - 7rem), calc(100% - 14rem)))` }}
                >
                  <p className="text-slate-400">{fmt.day(hovered.day)}</p>
                  <p className="text-white font-semibold text-sm tabular-nums mt-0.5">{format(valueOf(hovered))}</p>
                  {hovered.failed > 0 && <p className="text-slate-400 mt-0.5">{t('failed', { count: fmt.int(hovered.failed) })}</p>}
                  <ul className="mt-2 space-y-1">
                    {featureSplit(hovered.day).slice(0, 5).map(f => (
                      <li key={f.feature} className="flex justify-between gap-3">
                        <span className="text-slate-300 truncate">{featureLabel(f.feature)}</span>
                        <span className="text-slate-400 tabular-nums">{format(f.value)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
