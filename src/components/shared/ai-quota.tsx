'use client'

import { useCallback, useEffect, useState } from 'react'
import { Gauge, ChevronDown, RotateCw } from 'lucide-react'
import { useTranslations } from 'next-intl'

export interface AiQuotaRow {
  key: string
  label: string
  limit: number
  used: number
  remaining: number
  /** ISO instant the window resets, or null when nothing is consumed yet. */
  resetAt: string | null
}

/** mm:ss, or h:mm:ss past an hour. Latin digits, to match the rest of the UI. */
function formatLeft(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

function QuotaBar({ row, now }: { row: AiQuotaRow; now: number }) {
  const t = useTranslations('common.quota')
  const exhausted = row.remaining === 0
  const pct = row.limit > 0 ? Math.min(100, (row.used / row.limit) * 100) : 0
  const msLeft = row.resetAt ? new Date(row.resetAt).getTime() - now : 0
  // The window is anchored to the FIRST consumed request and is never
  // extended by later calls, so this counts down to a fixed instant.
  const showTimer = !!row.resetAt && msLeft > 0

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-slate-300 truncate">{row.label}</span>
        <span className={`shrink-0 tabular-nums ${exhausted ? 'text-red-400' : 'text-slate-400'}`}>
          {row.remaining} / {row.limit}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${exhausted ? 'bg-red-500' : pct > 60 ? 'bg-amber-500' : 'bg-emerald-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showTimer && (
        <p className={`text-[11px] tabular-nums ${exhausted ? 'text-red-400' : 'text-slate-500'}`}>
          {exhausted ? t('exhaustedRenewsIn') : t('renewsIn')}{' '}
          {formatLeft(msLeft)}
        </p>
      )}
    </div>
  )
}

/**
 * The teacher's AI allowances and how much is left of each, with a live
 * countdown to the moment the window reopens.
 *
 * Reads /api/ai/quota, which SELECTs the counters rather than calling
 * check_rate_limit() — opening this panel must never itself consume a unit.
 *
 * `refreshToken`: change it after an AI call (success OR a 429) to re-read
 * the counters, so the numbers and the timer are correct immediately instead
 * of after the next mount.
 */
export function AiQuota({
  only,
  refreshToken = 0,
  defaultOpen = false,
}: {
  /** Limit the list to these feature keys; omit to show every feature. */
  only?: string[]
  refreshToken?: number
  defaultOpen?: boolean
}) {
  const t = useTranslations('common.quota')
  const [rows, setRows] = useState<AiQuotaRow[] | null>(null)
  const [open, setOpen] = useState(defaultOpen)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const fetchQuota = useCallback(async (): Promise<AiQuotaRow[]> => {
    const res = await fetch('/api/ai/quota')
    if (!res.ok) throw new Error(String(res.status))
    return (await res.json()).quota ?? []
  }, [])

  // setState lands in the promise callbacks, never synchronously in the
  // effect body, so this does not cascade renders.
  useEffect(() => {
    let cancelled = false
    fetchQuota()
      .then(q => { if (!cancelled) { setRows(q); setFailed(false) } })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [fetchQuota, refreshToken])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await fetchQuota())
      setFailed(false)
    } catch {
      setFailed(true)
    }
    setLoading(false)
  }, [fetchQuota])

  // One shared 1s tick drives every countdown; it only runs while the list
  // is open and something is actually counting down.
  const ticking = open && !!rows?.some(r => r.resetAt && new Date(r.resetAt).getTime() > now)
  useEffect(() => {
    if (!ticking) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [ticking])

  // A quota panel is an aid, never a blocker: if it can't load, show nothing
  // rather than an error the teacher can't act on.
  if (failed) return null

  const shown = only && rows ? rows.filter(r => only.includes(r.key)) : rows
  const exhausted = shown?.filter(r => r.remaining === 0) ?? []

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60">
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setNow(Date.now()) }}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-start"
      >
        <Gauge className="w-4 h-4 shrink-0 text-slate-400" />
        <span className="text-xs font-medium text-slate-300">{t('title')}</span>
        {exhausted.length > 0 && (
          <span className="shrink-0 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] text-red-400">
            {t('exhaustedCount', { count: exhausted.length })}
          </span>
        )}
        <ChevronDown className={`w-4 h-4 shrink-0 text-slate-500 ms-auto transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-800 px-3 py-3">
          {shown === null ? (
            <p className="text-xs text-slate-500">{t('loading')}</p>
          ) : shown.length === 0 ? (
            <p className="text-xs text-slate-500">{t('none')}</p>
          ) : (
            shown.map(row => <QuotaBar key={row.key} row={row} now={now} />)
          )}
          <div className="flex items-center justify-between pt-1">
            <p className="text-[11px] text-slate-500">
              {t('windowHint')}
            </p>
            <button
              type="button"
              onClick={() => void reload()}
              disabled={loading}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition-colors disabled:opacity-50"
            >
              <RotateCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> {t('refresh')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
