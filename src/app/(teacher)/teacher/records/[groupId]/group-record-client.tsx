'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowLeft, BarChart3, CalendarCheck, ClipboardCheck, Search, TriangleAlert, Users } from 'lucide-react'
import type { Locale } from '@/i18n/config'
import type { GroupInfo, GroupMember, StudentSummary } from '@/lib/teacher-records'
import { Badge, ProgressBar, StatCard, TrendMark, selectClass } from '@/components/teacher/records/ui'

export interface AssessmentBar {
  id: string
  title: string
  kind: 'exam' | 'homework'
  createdAt: string
  avg: number | null
  count: number
}

type Status = 'all' | 'atRisk' | 'missing' | 'top' | 'inactive'
type Sort = 'name' | 'avgDesc' | 'avgAsc' | 'attendance' | 'completion'

const TOP_FROM = 85
// Categorical slots 1 and 2 of the reference data-viz palette, dark steps,
// validated on the panel surface #0f172a. Colour = assessment type.
const KIND_COLOR = { exam: '#3987e5', homework: '#d95926' } as const
const SHORT_DATE: Record<Locale, string> = { ar: 'ar-u-ca-gregory-nu-latn', en: 'en-GB' }

export function GroupRecordClient({ group, rows, bars, stats, hasCourseProgress }: {
  group: GroupInfo
  rows: { member: GroupMember; summary: StudentSummary }[]
  bars: AssessmentBar[]
  stats: { students: number; avg: number | null; completion: number | null; attendance: number | null; atRisk: number }
  hasCourseProgress: boolean
}) {
  const t = useTranslations('teacher.records')
  const locale = useLocale() as Locale
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<Status>('all')
  const [sort, setSort] = useState<Sort>('name')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = rows.filter(({ member: m, summary: s }) => {
      if (q && !m.name.toLowerCase().includes(q) && !m.email.toLowerCase().includes(q)) return false
      if (status === 'atRisk') return s.atRisk
      if (status === 'missing') return s.exams.submitted < s.exams.assigned || s.homework.submitted < s.homework.assigned
      if (status === 'top') return s.overallAvg != null && s.overallAvg >= TOP_FROM
      if (status === 'inactive') return !m.isActive
      return true
    })
    const num = (x: number | null, empty: number) => (x == null ? empty : x)
    const by: Record<Sort, (a: typeof list[number], b: typeof list[number]) => number> = {
      name: (a, b) => a.member.name.localeCompare(b.member.name, locale),
      avgDesc: (a, b) => num(b.summary.overallAvg, -1) - num(a.summary.overallAvg, -1),
      avgAsc: (a, b) => num(a.summary.overallAvg, 101) - num(b.summary.overallAvg, 101),
      attendance: (a, b) => num(a.summary.attendance.rate, 101) - num(b.summary.attendance.rate, 101),
      completion: (a, b) => num(a.summary.completion, 101) - num(b.summary.completion, 101),
    }
    return [...list].sort(by[sort])
  }, [rows, query, status, sort, locale])

  const pct = (x: number | null) => (x == null ? '—' : `${x}%`)
  const trendLabels = {
    up: t('group.table.trendUp'), down: t('group.table.trendDown'), flat: t('group.table.trendFlat'), none: t('group.table.trendNone'),
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/teacher/records" className="inline-flex items-center gap-1.5 text-slate-400 hover:text-white text-sm mb-3 transition-colors">
          <ArrowLeft className="w-4 h-4 rtl:rotate-180" aria-hidden /> {t('group.back')}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-bold text-white">{group.name}</h2>
          {!group.isActive && <Badge tone="muted">{t('index.inactive')}</Badge>}
        </div>
        {group.courseTitle && <p className="text-slate-400 mt-1">{t('index.course')} {group.courseTitle}</p>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        <StatCard label={t('group.stats.students')} value={String(stats.students)} icon={<Users className="w-5 h-5" />} />
        <StatCard label={t('group.stats.avg')} value={pct(stats.avg)} icon={<BarChart3 className="w-5 h-5" />} />
        <StatCard label={t('group.stats.completion')} value={pct(stats.completion)} icon={<ClipboardCheck className="w-5 h-5" />} />
        <StatCard label={t('group.stats.attendance')} value={pct(stats.attendance)} icon={<CalendarCheck className="w-5 h-5" />} />
        <StatCard
          label={t('group.stats.atRisk')}
          sub={t('group.stats.atRiskHint')}
          value={String(stats.atRisk)}
          icon={<TriangleAlert className="w-5 h-5" />}
          alert={stats.atRisk > 0}
        />
      </div>

      <AssessmentChart bars={bars} locale={locale} />

      <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-white font-semibold">{t('group.table.title')}</h3>
            <span className="text-slate-500 text-sm">{t('group.table.count', { count: shown.length })}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="relative">
              <span className="sr-only">{t('group.filters.search')}</span>
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={t('group.filters.search')}
                className="w-full ps-9 pe-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <label>
              <span className="sr-only">{t('group.filters.status')}</span>
              <select value={status} onChange={e => setStatus(e.target.value as Status)} className={selectClass}>
                <option value="all">{t('group.filters.statusAll')}</option>
                <option value="atRisk">{t('group.filters.statusAtRisk')}</option>
                <option value="missing">{t('group.filters.statusMissing')}</option>
                <option value="top">{t('group.filters.statusTop')}</option>
                <option value="inactive">{t('group.filters.statusInactive')}</option>
              </select>
            </label>
            <label>
              <span className="sr-only">{t('group.filters.sort')}</span>
              <select value={sort} onChange={e => setSort(e.target.value as Sort)} className={selectClass}>
                <option value="name">{t('group.filters.sortName')}</option>
                <option value="avgDesc">{t('group.filters.sortAvgDesc')}</option>
                <option value="avgAsc">{t('group.filters.sortAvgAsc')}</option>
                <option value="attendance">{t('group.filters.sortAttendance')}</option>
                <option value="completion">{t('group.filters.sortCompletion')}</option>
              </select>
            </label>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="text-slate-400 text-sm text-center py-12">{t('group.table.noStudents')}</p>
        ) : shown.length === 0 ? (
          <p className="text-slate-400 text-sm text-center py-12">{t('group.table.noMatches')}</p>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800/40 text-slate-400 text-xs">
                  <th className="text-start font-medium px-5 py-3">{t('group.table.student')}</th>
                  <th className="text-start font-medium px-5 py-3">{t('group.table.exams')}</th>
                  <th className="text-start font-medium px-5 py-3">{t('group.table.homework')}</th>
                  <th className="text-start font-medium px-5 py-3">{t('group.table.attendance')}</th>
                  {hasCourseProgress && <th className="text-start font-medium px-5 py-3">{t('group.table.progress')}</th>}
                  <th className="text-start font-medium px-5 py-3">{t('group.table.average')}</th>
                  <th className="text-start font-medium px-5 py-3">{t('group.table.trend')}</th>
                  <th className="px-5 py-3"><span className="sr-only">{t('group.table.open')}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {shown.map(({ member: m, summary: s }) => (
                  <tr key={m.studentId} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-medium whitespace-nowrap">{m.name || '—'}</span>
                        {!m.isActive && <Badge tone="muted">{t('group.table.inactive')}</Badge>}
                        {s.atRisk && <Badge tone="bad">{t('student.summary.atRisk')}</Badge>}
                      </div>
                      <p className="text-slate-500 text-xs mt-0.5">{m.email}</p>
                    </td>
                    <KindCell k={s.exams} label={t('group.table.submittedOf', { submitted: s.exams.submitted, assigned: s.exams.assigned })} />
                    <KindCell k={s.homework} label={t('group.table.submittedOf', { submitted: s.homework.submitted, assigned: s.homework.assigned })} />
                    <td className="px-5 py-3.5"><ProgressBar pct={s.attendance.rate} tone="emerald" /></td>
                    {hasCourseProgress && <td className="px-5 py-3.5"><ProgressBar pct={s.progress?.pct ?? null} /></td>}
                    <td className="px-5 py-3.5 text-white font-semibold tabular-nums">{pct(s.overallAvg)}</td>
                    <td className="px-5 py-3.5"><TrendMark trend={s.trend} labels={trendLabels} /></td>
                    <td className="px-5 py-3.5 text-end">
                      <Link
                        href={`/teacher/records/${group.id}/${m.studentId}`}
                        className="inline-block px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 text-xs whitespace-nowrap transition-colors"
                      >
                        {t('group.table.open')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function KindCell({ k, label }: { k: StudentSummary['exams']; label: string }) {
  return (
    <td className="px-5 py-3.5 whitespace-nowrap">
      {k.assigned === 0 ? (
        <span className="text-slate-600">—</span>
      ) : (
        <>
          <span className="text-white font-semibold tabular-nums">{k.avg == null ? '—' : `${k.avg}%`}</span>
          <p className="text-slate-500 text-xs mt-0.5">{label}</p>
        </>
      )}
    </td>
  )
}

// ── Per-assessment chart ─────────────────────────────────────────────
// One bar per assessment (oldest → newest), height = the group's average on
// it, colour = exam or homework. Plain SVG at the measured width.

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

function barPath(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`
}

function AssessmentChart({ bars, locale }: { bars: AssessmentBar[]; locale: Locale }) {
  const t = useTranslations('teacher.records.group.chart')
  const [boxRef, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const graded = bars.some(b => b.avg != null)
  const kinds = [...new Set(bars.map(b => b.kind))]

  const H = 240
  const M = { top: 12, right: 12, bottom: 32, left: 40 }
  const plotW = Math.max(0, width - M.left - M.right)
  const plotH = H - M.top - M.bottom
  const slot = bars.length ? plotW / bars.length : 0
  const barW = Math.max(6, Math.min(36, slot * 0.6))
  const yOf = (p: number) => M.top + plotH - (p / 100) * plotH
  const fmt = (iso: string) => new Intl.DateTimeFormat(SHORT_DATE[locale], { day: 'numeric', month: 'short' }).format(new Date(iso))
  const labelEvery = slot >= 56 ? 1 : slot >= 30 ? 2 : 3
  const active = hover == null ? null : bars[hover]

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-white font-semibold">{t('title')}</h3>
          <p className="text-slate-500 text-xs mt-0.5">{t('subtitle')}</p>
        </div>
        {kinds.length > 1 && (
          <ul className="flex items-center gap-4">
            {kinds.map(k => (
              <li key={k} className="flex items-center gap-1.5 text-xs text-slate-300">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: KIND_COLOR[k] }} aria-hidden />
                {t(k)}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div ref={boxRef} className="relative" dir="ltr" onMouseLeave={() => setHover(null)}>
        {!graded ? (
          <p className="text-slate-500 text-sm text-center py-14" dir="auto">{t('empty')}</p>
        ) : width > 0 && (
          <svg width={width} height={H} role="img" aria-label={t('subtitle')}>
            {[0, 25, 50, 75, 100].map(v => (
              <g key={v}>
                <line x1={M.left} x2={M.left + plotW} y1={yOf(v)} y2={yOf(v)} stroke="#1e293b" />
                <text x={M.left - 8} y={yOf(v)} dy="0.32em" textAnchor="end" className="fill-slate-500" fontSize={11}>{v}%</text>
              </g>
            ))}
            {bars.map((b, i) => {
              const x = M.left + i * slot + (slot - barW) / 2
              return (
                <g key={b.id}>
                  {b.avg != null && (
                    <path
                      d={barPath(x, yOf(b.avg), barW, Math.max(yOf(0) - yOf(b.avg), 1), 4)}
                      fill={KIND_COLOR[b.kind]}
                      opacity={hover != null && hover !== i ? 0.45 : 1}
                    />
                  )}
                  <rect x={M.left + i * slot} y={M.top} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
                  {i % labelEvery === 0 && (
                    <text x={M.left + i * slot + slot / 2} y={yOf(0) + 18} textAnchor="middle" className="fill-slate-500" fontSize={11}>{fmt(b.createdAt)}</text>
                  )}
                </g>
              )
            })}
            <line x1={M.left} x2={M.left + plotW} y1={yOf(0)} y2={yOf(0)} stroke="#334155" />
          </svg>
        )}
        {graded && active && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-slate-700 bg-slate-950/95 px-3 py-2 text-xs shadow-xl max-w-64"
            style={{ left: M.left + (hover! + 0.5) * slot, top: (active.avg != null ? yOf(active.avg) : yOf(0)) - 8 }}
          >
            <p className="flex items-center gap-1.5 text-slate-100 font-medium" dir="auto">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: KIND_COLOR[active.kind] }} aria-hidden />
              {active.title}
            </p>
            <p className="text-slate-400 mt-1" dir="auto">
              {t(active.kind)} · {fmt(active.createdAt)} · {active.avg == null ? t('noGrades') : t('tooltip', { pct: active.avg, count: active.count })}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
