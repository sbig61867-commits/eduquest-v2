'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ClipboardList, ShieldCheck, Clock, Play, CheckCircle2, RotateCcw, BookOpen } from 'lucide-react'
import { ExamTaker } from './exam-taker'
import type { Exam } from '@/types'

type ExamWithContext = Exam & {
  groups?: { name: string } | null
  courses?: { title: string } | null
}

interface Submission {
  exam_id: string
  score: number | null
  grading_status: string
}

interface Props {
  availableExams: ExamWithContext[]
  completedExams:  ExamWithContext[]
  submissions: Submission[]
  userId: string
}

export function StudentExamsClient({ availableExams, completedExams, submissions, userId }: Props) {
  const [activeExam, setActiveExam] = useState<Exam | null>(null)

  if (activeExam) {
    return <ExamTaker exam={activeExam} userId={userId} tenantId="" onFinish={() => setActiveExam(null)} />
  }

  const submissionMap = Object.fromEntries(submissions.map(s => [s.exam_id, s]))

  function contextLabel(exam: ExamWithContext) {
    if (exam.groups?.name) return exam.groups.name
    if (exam.courses?.title) return exam.courses.title
    return '—'
  }

  function contextIcon(exam: ExamWithContext) {
    return exam.courses?.title
      ? <BookOpen className="w-3 h-3" />
      : <ClipboardList className="w-3 h-3" />
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-white">My Exams</h2>
        <p className="text-slate-400 mt-1">
          {availableExams.length} available · {completedExams.length} completed
        </p>
      </div>

      {/* Available Exams */}
      {availableExams.length === 0 && completedExams.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <ClipboardList className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No exams available yet.</p>
        </div>
      ) : (
        <>
          {availableExams.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Available</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {availableExams.map(exam => {
                  const isRetake = !!submissionMap[exam.id]
                  return (
                    <div key={exam.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-white font-semibold mb-1">{exam.title}</h3>
                          <p className="text-slate-400 text-sm flex items-center gap-1.5">
                            {contextIcon(exam)} {contextLabel(exam)}
                          </p>
                        </div>
                        {isRetake && <Badge variant="yellow">Retake</Badge>}
                      </div>
                      <div className="flex items-center gap-4 mb-4 text-sm text-slate-500">
                        <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{exam.duration_minutes} min</span>
                        <span className="flex items-center gap-1"><ClipboardList className="w-3.5 h-3.5" />{exam.questions.length} questions</span>
                        {exam.proctoring_enabled && (
                          <span className="flex items-center gap-1 text-blue-400"><ShieldCheck className="w-3.5 h-3.5" />Proctored</span>
                        )}
                      </div>
                      <Button className="w-full" onClick={() => setActiveExam(exam)}>
                        {isRetake ? <><RotateCcw className="w-4 h-4" /> Retake Exam</> : <><Play className="w-4 h-4" /> Start Exam</>}
                      </Button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Completed Exams */}
          {completedExams.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Completed</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {completedExams.map(exam => {
                  const sub = submissionMap[exam.id]
                  const published = sub?.grading_status === 'published'
                  return (
                    <div key={exam.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 opacity-75">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-white font-semibold mb-1">{exam.title}</h3>
                          <p className="text-slate-400 text-sm flex items-center gap-1.5">
                            {contextIcon(exam)} {contextLabel(exam)}
                          </p>
                        </div>
                        <Badge variant="green"><CheckCircle2 className="w-3 h-3" /> Submitted</Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-slate-500">
                        <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{exam.duration_minutes} min</span>
                        {published && sub?.score != null ? (
                          <span className="text-emerald-400 font-medium">Score: {sub.score}</span>
                        ) : (
                          <span className="text-amber-400 text-xs">Results pending</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
