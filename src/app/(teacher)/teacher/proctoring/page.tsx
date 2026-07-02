export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ShieldCheck, AlertTriangle, Eye, Mic, Monitor, Users } from 'lucide-react'
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Proctoring Reports</h2>
        <p className="text-slate-400 mt-1">Exam integrity monitoring for all proctored exams</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <p className="text-slate-400 text-sm mb-1">Total Submissions</p>
          <p className="text-3xl font-bold text-white">{submissions.length}</p>
        </div>
        <div className="bg-slate-900 border border-red-900/40 rounded-xl p-5">
          <p className="text-slate-400 text-sm mb-1">Flagged</p>
          <p className="text-3xl font-bold text-red-400">{flagged.length}</p>
        </div>
        <div className="bg-slate-900 border border-emerald-900/40 rounded-xl p-5">
          <p className="text-slate-400 text-sm mb-1">Clean</p>
          <p className="text-3xl font-bold text-emerald-400">{clean.length}</p>
        </div>
      </div>

      {!submissions.length ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <ShieldCheck className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No proctored exam submissions yet.</p>
          <p className="text-slate-500 text-sm mt-1">Enable proctoring when creating an exam to see reports here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {submissions.map(sub => {
            const events: ProctoringEvent[] = sub.proctoring_events ?? []
            const isFlagged = events.length > 0
            const max = sub.exams?.questions?.reduce((a, q) => a + q.points, 0) || 1
            const pct = Math.round(((sub.score ?? 0) / max) * 100)

            return (
              <div key={sub.id} className={`bg-slate-900 border rounded-xl p-5 ${isFlagged ? 'border-red-900/50' : 'border-slate-800'}`}>
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-white font-semibold">{sub.users?.full_name ?? '—'}</h3>
                      <Badge variant={isFlagged ? 'red' : 'green'}>{isFlagged ? `${events.length} violations` : 'Clean'}</Badge>
                    </div>
                    <p className="text-slate-400 text-sm">{sub.users?.email} · {sub.exams?.title}</p>
                    <p className="text-slate-500 text-xs mt-0.5">Score: {sub.score}/{max} ({pct}%) · {formatDateTime(sub.submitted_at)}</p>
                  </div>
                </div>

                {events.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Violations</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {events.map((ev, i) => {
                        const Icon = VIOLATION_ICONS[ev.type as ViolationIconKey] ?? AlertTriangle
                        return (
                          <div key={i} className="flex items-start gap-2 bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                            <Icon className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <p className="text-red-300 text-sm font-medium">{VIOLATION_LABELS[ev.type] ?? ev.type}</p>
                              {ev.details && <p className="text-slate-500 text-xs truncate">{ev.details}</p>}
                              {ev.timestamp && <p className="text-slate-600 text-xs">{formatDateTime(ev.timestamp)}</p>}
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
  )
}
