'use client'

import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import type { StudentSummary } from '@/lib/teacher-records'

// Building blocks shared by the three levels of the teacher's student records
// (groups → group → student). Text stays in text colours; colour only marks
// state, and every state colour comes with an icon or a word beside it.

export function StatCard({ label, value, sub, icon, alert }: {
  label: string
  value: string
  sub?: string
  icon?: React.ReactNode
  alert?: boolean
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 min-w-0">
      <div className="flex items-start justify-between gap-3">
        <p className="text-slate-300 text-sm font-medium">{label}</p>
        {icon && (
          <span
            aria-hidden
            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${alert ? 'bg-red-500/15 text-red-400' : 'bg-slate-800 text-slate-400'}`}
          >
            {icon}
          </span>
        )}
      </div>
      <p className="text-3xl font-bold text-white mt-3 tabular-nums">{value}</p>
      {sub && <p className="text-slate-500 text-xs mt-1">{sub}</p>}
    </div>
  )
}

/** A percentage bar; renders a dash when there is nothing to measure. */
export function ProgressBar({ pct, label, tone = 'blue' }: { pct: number | null; label?: string; tone?: 'blue' | 'emerald' }) {
  if (pct == null) return <span className="text-slate-600">—</span>
  return (
    <div className="min-w-24" title={label}>
      <div className="flex items-center justify-between gap-2 text-xs mb-1">
        <span className="text-slate-200 tabular-nums">{pct}%</span>
        {label && <span className="text-slate-500 truncate">{label}</span>}
      </div>
      <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div className={`h-full rounded-full ${tone === 'emerald' ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  )
}

export function TrendMark({ trend, labels }: {
  trend: StudentSummary['trend']
  labels: { up: string; down: string; flat: string; none: string }
}) {
  if (trend === 'none') return <span className="text-slate-600" title={labels.none}>—<span className="sr-only">{labels.none}</span></span>
  const map = {
    up: { Icon: TrendingUp, color: 'text-emerald-400', label: labels.up },
    down: { Icon: TrendingDown, color: 'text-red-400', label: labels.down },
    flat: { Icon: Minus, color: 'text-slate-400', label: labels.flat },
  } as const
  const { Icon, color, label } = map[trend]
  return (
    <span className={`inline-flex items-center gap-1.5 ${color}`} title={label}>
      <Icon className="w-4 h-4" aria-hidden />
      <span className="text-xs text-slate-400">{label}</span>
    </span>
  )
}

const TONE = {
  good: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  info: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
  warn: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  bad: 'bg-red-500/10 text-red-300 border-red-500/20',
  muted: 'bg-slate-800 text-slate-300 border-slate-700',
} as const

export function Badge({ tone, children }: { tone: keyof typeof TONE; children: React.ReactNode }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-xs whitespace-nowrap ${TONE[tone]}`}>{children}</span>
}

export const selectClass = 'w-full px-3.5 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
