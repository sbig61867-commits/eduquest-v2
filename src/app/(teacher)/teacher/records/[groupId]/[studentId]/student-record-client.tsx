'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowLeft, BarChart3, BookOpen, CalendarCheck, ClipboardCheck, ClipboardList, ShieldAlert } from 'lucide-react'
import type { Locale } from '@/i18n/config'
import { formatDate } from '@/lib/utils'
import { itemDate, type AttendanceMark, type GroupInfo, type GroupMember, type RecordItem, type StudentSummary } from '@/lib/teacher-records'
import { Badge, ProgressBar, StatCard, TrendMark, selectClass } from '@/components/teacher/records/ui'

type KindFilter = 'all' | 'exam' | 'homework'
type StatusFilter = 'all' | 'graded' | 'awaiting' | 'notSubmitted'

const STATE_TONE = { graded: 'good', awaiting: 'info', inProgress: 'warn', missed: 'bad', open: 'muted' } as const
const ATT_TONE = { present: 'good', late: 'warn', absent: 'bad', excused: 'info', unmarked: 'muted' } as const

export function StudentRecordClient({ group, member, items, marks, summary }: {
  group: GroupInfo
  member: GroupMember
  items: RecordItem[]
  marks: AttendanceMark[]
  summary: StudentSummary
}) {
  const t = useTranslations('teacher.records')
  const locale = useLocale() as Locale
  const [kind, setKind] = useState<KindFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')

  const shown = useMemo(() => items.filter(i => {
    if (kind !== 'all' && i.assessment.kind !== kind) return false
    if (status === 'graded') return i.status === 'graded'
    if (status === 'awaiting') return i.status === 'awaiting'
    if (status === 'notSubmitted') return i.status === 'missed' || i.status === 'open' || i.status === 'inProgress'
    return true
  }), [items, kind, status])

  const { present, late, absent, excused } = summary.attendance
  const attendanceCounts = { present, late, absent, excused }
  const pct = (x: number | null) => (x == null ? '—' : `${x}%`)
  const date = (iso: string) => formatDate(iso, locale)

  function explain(i: RecordItem): string {
    const s = i.submission
    switch (i.status) {
      case 'graded': return t('student.items.explain.graded', { date: date(s!.submittedAt!), score: i.score!, max: i.max ?? '—' })
      case 'awaiting': return t('student.items.explain.awaiting', { date: date(s!.submittedAt!) })
      case 'inProgress': return t('student.items.explain.inProgress')
      case 'missed': return t('student.items.explain.missed', { date: date(i.assessment.endsAt!) })
      default: return i.assessment.endsAt
        ? t('student.items.explain.openDue', { date: date(i.assessment.endsAt) })
        : t('student.items.explain.openNoDue')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/teacher/records/${group.id}`} className="inline-flex items-center gap-1.5 text-slate-400 hover:text-white text-sm mb-3 transition-colors">
          <ArrowLeft className="w-4 h-4 rtl:rotate-180" aria-hidden /> {t('student.back', { group: group.name })}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-bold text-white">{member.name || '—'}</h2>
          {!member.isActive && <Badge tone="muted">{t('student.inactive')}</Badge>}
          {summary.atRisk && <Badge tone="bad">{t('student.summary.atRisk')}</Badge>}
          <TrendMark
            trend={summary.trend}
            labels={{ up: t('group.table.trendUp'), down: t('group.table.trendDown'), flat: t('group.table.trendFlat'), none: t('group.table.trendNone') }}
          />
        </div>
        <p className="text-slate-400 mt-1">
          {member.email}
          {member.joinedAt && <> · {t('student.joined', { date: date(member.joinedAt) })}</>}
          {summary.lastActivity && <> · {t('student.summary.lastActivity')} {date(summary.lastActivity)}</>}
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        <StatCard label={t('student.summary.overall')} value={pct(summary.overallAvg)} icon={<BarChart3 className="w-5 h-5" />} alert={summary.atRisk} />
        <StatCard
          label={t('student.summary.exams')}
          value={pct(summary.exams.avg)}
          sub={t('student.summary.submittedOf', { submitted: summary.exams.submitted, assigned: summary.exams.assigned })}
          icon={<ClipboardList className="w-5 h-5" />}
        />
        <StatCard
          label={t('student.summary.homework')}
          value={pct(summary.homework.avg)}
          sub={t('student.summary.submittedOf', { submitted: summary.homework.submitted, assigned: summary.homework.assigned })}
          icon={<ClipboardCheck className="w-5 h-5" />}
        />
        <StatCard
          label={t('student.summary.attendance')}
          value={pct(summary.attendance.rate)}
          sub={t('student.attendance.counts', attendanceCounts)}
          icon={<CalendarCheck className="w-5 h-5" />}
        />
        <StatCard
          label={t('student.summary.progress')}
          value={summary.progress ? pct(summary.progress.pct) : '—'}
          sub={summary.progress ? `${summary.progress.done}/${summary.progress.total}` : undefined}
          icon={<BookOpen className="w-5 h-5" />}
        />
      </div>

      {/* Exams and homework */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className="text-white font-semibold">{t('student.items.title')}</h3>
          <div className="grid grid-cols-2 gap-3 sm:w-96">
            <label>
              <span className="sr-only">{t('student.items.kind')}</span>
              <select value={kind} onChange={e => setKind(e.target.value as KindFilter)} className={selectClass}>
                <option value="all">{t('student.items.kindAll')}</option>
                <option value="exam">{t('student.items.kindExam')}</option>
                <option value="homework">{t('student.items.kindHomework')}</option>
              </select>
            </label>
            <label>
              <span className="sr-only">{t('student.items.status')}</span>
              <select value={status} onChange={e => setStatus(e.target.value as StatusFilter)} className={selectClass}>
                <option value="all">{t('student.items.statusAll')}</option>
                <option value="graded">{t('student.items.statusGraded')}</option>
                <option value="awaiting">{t('student.items.statusAwaiting')}</option>
                <option value="notSubmitted">{t('student.items.statusNotSubmitted')}</option>
              </select>
            </label>
          </div>
        </div>

        {items.length === 0 ? (
          <p className="text-slate-400 text-sm text-center py-12">{t('student.items.empty')}</p>
        ) : shown.length === 0 ? (
          <p className="text-slate-400 text-sm text-center py-12">{t('student.items.noMatches')}</p>
        ) : (
          <>
          {/* Phones: one card per item, so the explanation is never off-screen. */}
          <ul className="md:hidden divide-y divide-slate-800">
            {shown.map(i => (
              <li key={i.assessment.id} className="px-5 py-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-white font-medium">{i.assessment.title}</p>
                  {i.pct != null && <span className="text-white font-semibold tabular-nums shrink-0">{i.pct}%</span>}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={i.assessment.kind === 'exam' ? 'info' : 'muted'}>
                    {i.assessment.kind === 'exam' ? t('student.items.exam') : t('student.items.homework')}
                  </Badge>
                  <Badge tone={STATE_TONE[i.status]}>{t(`student.items.state.${i.status}`)}</Badge>
                  <span className="text-slate-500 text-xs">{date(itemDate(i))}</span>
                </div>
                <p className="text-slate-300 text-sm">{explain(i)}</p>
                {i.submission && i.status !== 'inProgress' && (
                  <p className="text-slate-500 text-xs">{t(`student.items.grading.${i.submission.gradingStatus}`)}</p>
                )}
                {i.submission?.flagged && (
                  <p className="flex items-center gap-1.5 text-amber-300 text-xs">
                    <ShieldAlert className="w-3.5 h-3.5" aria-hidden /> {t('student.items.flagged')}
                  </p>
                )}
                {i.assessment.lessonId && i.assessment.lessonTitle && (
                  <Link href={`/teacher/lessons/${i.assessment.lessonId}`} className="inline-block text-xs text-blue-400 hover:text-blue-300">
                    {t('student.items.lesson', { title: i.assessment.lessonTitle })}
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <div className="relative overflow-x-auto hidden md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800/40 text-slate-400 text-xs">
                  <th className="text-start font-medium px-5 py-3">{t('student.items.colItem')}</th>
                  <th className="text-start font-medium px-5 py-3">{t('student.items.colDate')}</th>
                  <th className="text-start font-medium px-5 py-3">{t('student.items.colStatus')}</th>
                  <th className="text-start font-medium px-5 py-3">{t('student.items.colScore')}</th>
                  <th className="text-start font-medium px-5 py-3">{t('student.items.colDetails')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {shown.map(i => (
                  <tr key={i.assessment.id} className="align-top hover:bg-slate-800/30 transition-colors">
                    <td className="px-5 py-3.5 min-w-48">
                      <p className="text-white font-medium">{i.assessment.title}</p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <Badge tone={i.assessment.kind === 'exam' ? 'info' : 'muted'}>
                          {i.assessment.kind === 'exam' ? t('student.items.exam') : t('student.items.homework')}
                        </Badge>
                        {i.assessment.source === 'course' && <Badge tone="muted">{t('student.items.fromCourse')}</Badge>}
                        {i.assessment.lessonId && i.assessment.lessonTitle && (
                          <Link href={`/teacher/lessons/${i.assessment.lessonId}`} className="text-xs text-blue-400 hover:text-blue-300">
                            {t('student.items.lesson', { title: i.assessment.lessonTitle })}
                          </Link>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-slate-300 whitespace-nowrap">{date(itemDate(i))}</td>
                    <td className="px-5 py-3.5"><Badge tone={STATE_TONE[i.status]}>{t(`student.items.state.${i.status}`)}</Badge></td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      {i.pct == null ? (
                        <span className="text-slate-600">—</span>
                      ) : (
                        <>
                          <span className="text-white font-semibold tabular-nums">{i.pct}%</span>
                          <p className="text-slate-500 text-xs mt-0.5 tabular-nums">{i.score} / {i.max}</p>
                        </>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-slate-300 min-w-64">
                      <p>{explain(i)}</p>
                      {i.submission && i.status !== 'inProgress' && (
                        <p className="text-slate-500 text-xs mt-1">{t(`student.items.grading.${i.submission.gradingStatus}`)}</p>
                      )}
                      {i.submission?.flagged && (
                        <p className="flex items-center gap-1.5 text-amber-300 text-xs mt-1">
                          <ShieldAlert className="w-3.5 h-3.5" aria-hidden /> {t('student.items.flagged')}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
        {/* Attendance */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3">
            <h3 className="text-white font-semibold">{t('student.attendance.title')}</h3>
            {marks.length > 0 && <span className="text-slate-500 text-xs">{t('student.attendance.counts', attendanceCounts)}</span>}
          </div>
          {marks.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-10">{t('student.attendance.empty')}</p>
          ) : (
            <div className="relative overflow-x-auto max-h-96">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-900">
                  <tr className="text-slate-400 text-xs">
                    <th className="text-start font-medium px-5 py-3">{t('student.attendance.colDate')}</th>
                    <th className="text-start font-medium px-5 py-3">{t('student.attendance.colSession')}</th>
                    <th className="text-start font-medium px-5 py-3">{t('student.attendance.colStatus')}</th>
                    <th className="text-start font-medium px-5 py-3">{t('student.attendance.colNote')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {marks.map(m => {
                    const st = m.status ?? 'unmarked'
                    return (
                      <tr key={m.sessionId}>
                        <td className="px-5 py-3 text-slate-300 whitespace-nowrap">{date(m.date)}</td>
                        <td className="px-5 py-3 text-slate-300">{m.title || t('student.attendance.untitled')}</td>
                        <td className="px-5 py-3"><Badge tone={ATT_TONE[st]}>{t(`student.attendance.state.${st}`)}</Badge></td>
                        <td className="px-5 py-3 text-slate-400">{m.note || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Course progress */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 self-start">
          <h3 className="text-white font-semibold mb-4">{t('student.progress.title')}</h3>
          {summary.progress && group.courseTitle ? (
            <>
              <ProgressBar pct={summary.progress.pct} />
              <p className="text-slate-400 text-sm mt-3">
                {t('student.progress.of', { done: summary.progress.done, total: summary.progress.total, course: group.courseTitle })}
              </p>
            </>
          ) : (
            <p className="text-slate-400 text-sm">{t('student.progress.none')}</p>
          )}
        </section>
      </div>
    </div>
  )
}
