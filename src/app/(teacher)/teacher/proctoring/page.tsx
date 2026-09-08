export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ShieldCheck, AlertTriangle, Eye, Mic, Monitor, Users, Radio } from 'lucide-react'
import { PageTitle } from '@/components/shared/page-title'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/utils'
import type { ProctoringEvent, Question } from '@/types'

type ViolationIconKey = keyof typeof VIOLATION_ICONS

const VIOLATION_ICONS = {
  tab_switch:        Monitor,
  fullscreen_exit:   Monitor,
  face_not_detected: Eye,
  multiple_faces:    Users,
  looking_away:      Eye,
  audio_detected:    Mic,
  suspicious_activity: AlertTriangle,
} as const

const VIOLATION_LABELS: Record<string, string> = {
  tab_switch:          'Tab Switch',
  fullscreen_exit:     'Left Fullscreen',
  face_not_detected:   'Face Not Detected',
  multiple_faces:      'Multiple Faces',
  looking_away:        'Looking Away',
  audio_detected:      'Loud Audio',
  suspicious_activity: 'Suspicious Object',
}

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

  const { data: raw } = await supabase
    .from('exam_submissions')
    .select('id, score, submitted_at, proctoring_events, exams!inner(title, teacher_id, proctoring_enabled, questions), users(full_name, email)')
    .eq('exams.teacher_id', user.id)
    .eq('exams.proctoring_enabled', true)
    .order('submitted_at', { ascending: false })

  const submissions = (raw ?? []) as unknown as SubmissionRow[]

  const flagged = submissions.filter(s => (s.proctoring_events ?? []).length > 0)
  const clean   = submissions.filter(s => (s.proctoring_events ?? []).length === 0)

  // Proctored exams the teacher can watch live right now.
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
    <>
    <PageTitle title="Proctoring" />
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="mb-7">
        <h1 className="text-xl font-semibold text-fg">Proctoring Reports</h1>
        <p className="text-[13px] text-fg-muted mt-1.5">Exam integrity monitoring for all proctored exams</p>
      </div>

      {(liveExams ?? []).length > 0 && (
        <div className="bg-surface border border-red-900/40 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-3">
            <Radio className="w-4 h-4 text-red-400" />
            <p className="text-fg font-semibold">Live Monitoring</p>
            <span className="text-fg-muted text-xs">Watch students in real time during a proctored exam</span>
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
        <div className="bg-surface border border-border rounded-lg p-5">
          <p className="text-fg-secondary text-sm mb-1">Total Submissions</p>
          <p className="text-3xl font-bold text-fg">{submissions.length}</p>
        </div>
        <div className="bg-surface border border-red-900/40 rounded-lg p-5">
          <p className="text-fg-secondary text-sm mb-1">Flagged</p>
          <p className="text-3xl font-bold text-red-400">{flagged.length}</p>
        </div>
        <div className="bg-surface border border-emerald-900/40 rounded-lg p-5">
          <p className="text-fg-secondary text-sm mb-1">Clean</p>
          <p className="text-3xl font-bold text-accent">{clean.length}</p>
        </div>
      </div>

      {!submissions.length ? (
        <div className="text-center py-20 bg-surface border border-border rounded-lg">
          <ShieldCheck className="w-12 h-12 text-fg-muted mx-auto mb-3" />
          <p className="text-fg-secondary">No proctored exam submissions yet.</p>
          <p className="text-fg-muted text-sm mt-1">Enable proctoring when creating an exam to see reports here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {submissions.map(sub => {
            const events: ProctoringEvent[] = sub.proctoring_events ?? []
            const isFlagged = events.length > 0
            const max = sub.exams?.questions?.reduce((a, q) => a + q.points, 0) || 1
            const pct = Math.round(((sub.score ?? 0) / max) * 100)

            return (
              <div key={sub.id} className={`bg-surface border rounded-lg p-5 ${isFlagged ? 'border-red-900/50' : 'border-border'}`}>
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-fg font-semibold">{sub.users?.full_name ?? '—'}</h3>
                      <Badge variant={isFlagged ? 'error' : 'success'}>{isFlagged ? `${events.length} violations` : 'Clean'}</Badge>
                    </div>
                    <p className="text-fg-secondary text-sm">{sub.users?.email} · {sub.exams?.title}</p>
                    <p className="text-fg-muted text-xs mt-0.5">Score: {sub.score}/{max} ({pct}%) · {formatDateTime(sub.submitted_at)}</p>
                  </div>
                </div>

                {events.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-fg-secondary uppercase tracking-wider mb-2">Violations</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {events.map((ev, i) => {
                        const Icon = VIOLATION_ICONS[ev.type as ViolationIconKey] ?? AlertTriangle
                        return (
                          <div key={i} className="flex items-start gap-2 bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                            <Icon className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <p className="text-red-300 text-sm font-medium">{VIOLATION_LABELS[ev.type] ?? ev.type}</p>
                              {ev.details && <p className="text-fg-muted text-xs truncate">{ev.details}</p>}
                              {ev.timestamp && <p className="text-fg-muted text-xs">{formatDateTime(ev.timestamp)}</p>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
    </>
  )
}
