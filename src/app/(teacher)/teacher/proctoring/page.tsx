export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ShieldCheck, AlertTriangle, Eye, Mic, Monitor, Users, Radio, ClipboardPaste, Cpu, Gauge } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/utils'
import type { ProctoringEvent, Question } from '@/types'
import { AppealReviewList, type AppealRow } from '@/components/teacher/appeal-review-list'
import { getTranslations, getLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/config'
import { coveragePercent, eventKind, parseMonitoringSummary } from '@/lib/proctoring-events'

type ViolationIconKey = keyof typeof VIOLATION_ICONS

const VIOLATION_ICONS = {
  tab_switch:        Monitor,
  fullscreen_exit:   Monitor,
  face_not_detected: Eye,
  multiple_faces:    Users,
  looking_away:      Eye,
  audio_detected:    Mic,
  speech_detected:   Mic,
  suspicious_activity: AlertTriangle,
  camera_stopped:    Eye,
  face_mismatch:     Users,
  spoof_detected:    Eye,
  paste_detected:    ClipboardPaste,
  bulk_insert:       ClipboardPaste,
} as const

// Low coverage worth a warning: the detectors watched less than this share.
const LOW_COVERAGE_PCT = 80

interface ExamRow { title: string; teacher_id: string; proctoring_enabled: boolean; questions: Question[] }
interface UserRow  { full_name: string; email: string }
interface SubmissionRow {
  id: string
  score: number
  submitted_at: string
  proctoring_events: ProctoringEvent[]
  exams: ExamRow | null
  users: UserRow | null
}

export default async function ProctoringReportsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')
  const t = await getTranslations('teacher')
  const locale = (await getLocale()) as Locale

  const { data: raw } = await supabase
    .from('exam_submissions')
    .select('id, score, submitted_at, proctoring_events, exams!inner(title, teacher_id, proctoring_enabled, questions), users(full_name, email)')
    .eq('exams.teacher_id', user.id)
    .eq('exams.proctoring_enabled', true)
    .order('submitted_at', { ascending: false })

  const submissions = (raw ?? []) as unknown as SubmissionRow[]

  const { data: pendingAppeals } = await supabase
    .from('exam_appeals')
    .select('id, student_name, exam_title, group_name, violation_type, student_message, created_at')
    .eq('teacher_id', user.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  const violationCount = (s: SubmissionRow) => (s.proctoring_events ?? []).filter(e => eventKind(e.type) === 'violation').length
  const flagged = submissions.filter(s => violationCount(s) > 0)
  const clean   = submissions.filter(s => violationCount(s) === 0)

  const { data: liveExams } = await supabase
    .from('exams')
    .select('id, title')
    .eq('teacher_id', user.id)
    .eq('type', 'exam')
    .eq('proctoring_enabled', true)
    .eq('is_published', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">{t('proctoring.title')}</h2>
        <p className="text-slate-400 mt-1">{t('proctoring.subtitle')}</p>
      </div>

      <AppealReviewList appeals={(pendingAppeals ?? []) as AppealRow[]} />

      {(liveExams ?? []).length > 0 && (
        <div className="bg-slate-900 border border-red-900/40 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Radio className="w-4 h-4 text-red-400" />
            <p className="text-white font-semibold">{t('proctoring.liveMonitoring')}</p>
            <span className="text-slate-500 text-xs">{t('proctoring.liveSubtitle')}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {(liveExams ?? []).map(e => (
              <Link key={e.id} href={`/teacher/proctoring/live/${e.id}`}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600/15 border border-red-600/40 text-red-300 hover:bg-red-600/25 text-sm font-medium transition-colors">
                <Radio className="w-3.5 h-3.5" /> {e.title}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <p className="text-slate-400 text-sm mb-1">{t('proctoring.totalSubmissions')}</p>
          <p className="text-3xl font-bold text-white">{submissions.length}</p>
        </div>
        <div className="bg-slate-900 border border-red-900/40 rounded-xl p-5">
          <p className="text-slate-400 text-sm mb-1">{t('proctoring.flagged')}</p>
          <p className="text-3xl font-bold text-red-400">{flagged.length}</p>
        </div>
        <div className="bg-slate-900 border border-emerald-900/40 rounded-xl p-5">
          <p className="text-slate-400 text-sm mb-1">{t('proctoring.clean')}</p>
          <p className="text-3xl font-bold text-emerald-400">{clean.length}</p>
        </div>
      </div>

      {!submissions.length ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <ShieldCheck className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">{t('proctoring.noSubmissions')}</p>
          <p className="text-slate-500 text-sm mt-1">{t('proctoring.noSubmissionsHint')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {submissions.map(sub => {
            const allEvents: ProctoringEvent[] = sub.proctoring_events ?? []
            const events = allEvents.filter(e => eventKind(e.type) === 'violation')
            const signals = allEvents.filter(e => eventKind(e.type) === 'signal')
            const gaps = allEvents.filter(e => e.type === 'detector_unavailable' || e.type === 'monitoring_gap')
            const environment = allEvents.filter(e => e.type === 'environment_flag')
            const summary = parseMonitoringSummary(allEvents.find(e => e.type === 'monitoring_summary')?.details)
            const coverage = summary ? coveragePercent(summary) : null
            const isFlagged = events.length > 0
            const label = (type: string) => (t.has(`proctoring.eventTypes.${type}`) ? t(`proctoring.eventTypes.${type}`) : type)
            const max = sub.exams?.questions?.reduce((a, q) => a + q.points, 0) || 1
            const pct = Math.round(((sub.score ?? 0) / max) * 100)

            return (
              <div key={sub.id} className={`bg-slate-900 border rounded-xl p-5 ${isFlagged ? 'border-red-900/50' : 'border-slate-800'}`}>
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-white font-semibold">{sub.users?.full_name ?? '—'}</h3>
                      <Badge variant={isFlagged ? 'red' : 'green'}>{isFlagged ? t('proctoring.violations', { count: events.length }) : t('proctoring.clean')}</Badge>
                    </div>
                    <p className="text-slate-400 text-sm">{sub.users?.email} · {sub.exams?.title}</p>
                    <p className="text-slate-500 text-xs mt-0.5">{t('proctoring.scoreLine', { score: sub.score ?? 0, max, pct, at: formatDateTime(sub.submitted_at, locale) })}</p>
                  </div>
                </div>

                {coverage !== null && (
                  <div className={`flex items-start gap-2 rounded-lg p-3 mb-3 border ${coverage < LOW_COVERAGE_PCT ? 'bg-amber-500/5 border-amber-500/20' : 'bg-slate-800/40 border-slate-700/60'}`}>
                    <Gauge className={`w-4 h-4 shrink-0 mt-0.5 ${coverage < LOW_COVERAGE_PCT ? 'text-amber-400' : 'text-emerald-400'}`} />
                    <p className={`text-sm ${coverage < LOW_COVERAGE_PCT ? 'text-amber-300' : 'text-slate-300'}`}>
                      {coverage < LOW_COVERAGE_PCT ? t('proctoring.coverageLow', { pct: coverage }) : t('proctoring.coverage', { pct: coverage })}
                    </p>
                  </div>
                )}

                {gaps.length > 0 && (
                  <div className="flex items-start gap-2 bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 mb-3">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-amber-300 text-sm font-medium">{t('proctoring.incompleteMonitoring')}</p>
                      <p className="text-slate-400 text-xs">
                        {t('proctoring.detectorNote', { detectors: gaps.map(g => g.details?.split(':')[0]).filter(Boolean).join(', ') || t('proctoring.unknownDetector') })}
                      </p>
                    </div>
                  </div>
                )}

                {environment.length > 0 && (
                  <div className="flex items-start gap-2 bg-slate-800/40 border border-slate-700/60 rounded-lg p-3 mb-3">
                    <Cpu className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-slate-300 text-sm font-medium">{t('proctoring.environment')}</p>
                      {environment.map((e, i) => <p key={i} className="text-slate-400 text-xs truncate">{e.details}</p>)}
                    </div>
                  </div>
                )}

                {events.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">{t('proctoring.violationsHeading')}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {events.map((ev, i) => {
                        const Icon = VIOLATION_ICONS[ev.type as ViolationIconKey] ?? AlertTriangle
                        return (
                          <div key={i} className="flex items-start gap-2 bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                            <Icon className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <p className="text-red-300 text-sm font-medium">{label(ev.type)}</p>
                              {ev.details && <p className="text-slate-500 text-xs truncate">{ev.details}</p>}
                              {ev.timestamp && <p className="text-slate-600 text-xs">{formatDateTime(ev.timestamp, locale)}</p>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {signals.length > 0 && (
                  <div className="space-y-2 mt-3">
                    <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">{t('proctoring.signalsHeading')}</p>
                    <p className="text-slate-500 text-xs">{t('proctoring.signalsNote')}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {signals.map((ev, i) => (
                        <div key={i} className="flex items-start gap-2 bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
                          <ClipboardPaste className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <p className="text-amber-300 text-sm font-medium">{label(ev.type)}</p>
                            {ev.details && <p className="text-slate-500 text-xs truncate">{ev.details}</p>}
                            {ev.timestamp && <p className="text-slate-600 text-xs">{formatDateTime(ev.timestamp, locale)}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
