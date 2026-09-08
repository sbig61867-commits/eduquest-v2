'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ClipboardList, ShieldCheck, Clock, Play, CheckCircle2, RotateCcw, BookOpen, GraduationCap } from 'lucide-react'
import { ExamTaker } from './exam-taker'
import { PageTitle } from '@/components/shared/page-title'
import { EmptyState } from '@/components/ui/empty-state'
import type { Exam } from '@/types'

type ExamWithContext = Exam & {
  groups?: { name: string } | null
  courses?: { title: string } | null
}

interface Submission {
  exam_id: string
  score: number | null
  max_score: number | null
  grading_status: string
}

interface Props {
  availableExams: ExamWithContext[]
  completedExams: ExamWithContext[]
  submissions: Submission[]
  userId: string
  violationWarningThreshold?: number
}

const isHomework = (e: ExamWithContext) => e.duration_minutes <= 0 || e.duration_minutes >= 43200
const untimedLabel = (e: ExamWithContext) => isHomework(e) ? 'Untimed' : `${e.duration_minutes} min`
const subjectOf = (e: ExamWithContext) => e.courses?.title ?? e.groups?.name ?? 'Other'
const isCourse = (e: ExamWithContext) => !!e.courses?.title

interface SubjectBucket {
  name: string
  fromCourse: boolean
  homework: ExamWithContext[]
  exams: ExamWithContext[]
  completed: ExamWithContext[]
}

export function StudentExamsClient({ availableExams, completedExams, submissions, userId, violationWarningThreshold = 5 }: Props) {
  const [activeExam, setActiveExam] = useState<Exam | null>(null)

  if (activeExam) {
    return <ExamTaker exam={activeExam} userId={userId} tenantId="" violationWarningThreshold={violationWarningThreshold} onFinish={() => setActiveExam(null)} />
  }

  const submissionMap = Object.fromEntries(submissions.map(s => [s.exam_id, s]))

  const subjects = new Map<string, SubjectBucket>()
  const bucketFor = (e: ExamWithContext): SubjectBucket => {
    const name = subjectOf(e)
    let b = subjects.get(name)
    if (!b) {
      b = { name, fromCourse: isCourse(e), homework: [], exams: [], completed: [] }
      subjects.set(name, b)
    }
    return b
  }
  for (const e of availableExams) {
    const b = bucketFor(e)
    ;(isHomework(e) ? b.homework : b.exams).push(e)
  }
  for (const e of completedExams) bucketFor(e).completed.push(e)

  const nothingAtAll = availableExams.length === 0 && completedExams.length === 0

  function ActiveCard({ exam, homework }: { exam: ExamWithContext; homework: boolean }) {
    const isRetake = !!submissionMap[exam.id]
    return (
      <div className="bg-surface border border-border rounded-lg p-4 hover:border-border-strong transition-colors">
        <div className="flex items-start justify-between gap-3 mb-3">
          <p className="text-[14px] font-medium text-fg leading-snug flex-1 min-w-0">{exam.title}</p>
          {isRetake && <Badge variant="warning" className="shrink-0">Retake</Badge>}
        </div>
        <div className="flex items-center gap-3 flex-wrap mb-4">
          <span className="flex items-center gap-1.5 text-[12px] text-fg-muted">
            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            {untimedLabel(exam)}
          </span>
          <span className="flex items-center gap-1.5 text-[12px] text-fg-muted">
            <ClipboardList className="w-3.5 h-3.5" aria-hidden="true" />
            {exam.questions.length} questions
          </span>
          {exam.proctoring_enabled && (
            <span className="flex items-center gap-1.5 text-[12px] text-accent">
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
              Proctored
            </span>
          )}
        </div>
        <Button className="w-full" onClick={() => setActiveExam(exam)}>
          {isRetake
            ? <><RotateCcw className="w-3.5 h-3.5" /> {homework ? 'Redo Homework' : 'Retake Exam'}</>
            : <><Play className="w-3.5 h-3.5" /> {homework ? 'Start Homework' : 'Start Exam'}</>}
        </Button>
      </div>
    )
  }

  function CompletedCard({ exam }: { exam: ExamWithContext }) {
    const sub = submissionMap[exam.id]
    const published = sub?.grading_status === 'published'
    return (
      <div className="flex items-center gap-3 px-4 py-3.5 hover:bg-canvas transition-colors">
        <CheckCircle2 className="w-4 h-4 text-success shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-fg-secondary truncate">{exam.title}</p>
          <p className="text-[11px] text-fg-muted mt-0.5">{untimedLabel(exam)}</p>
        </div>
        {published && sub?.score != null ? (
          <span className={`text-[13px] font-semibold shrink-0 ${Math.round(((sub.score ?? 0) / (sub.max_score ?? 1)) * 100) >= 60 ? 'text-accent' : 'text-error'}`}>
            {sub.score}{sub.max_score ? `/${sub.max_score}` : ''}
          </span>
        ) : (
          <span className="text-[11px] text-fg-muted shrink-0">Pending</span>
        )}
      </div>
    )
  }

  return (
    <>
      <PageTitle title="Exams" />

      <div className="max-w-3xl mx-auto">
        {/* Page header */}
        <div className="mb-7">
          <h1 className="text-xl font-semibold text-fg">Exams</h1>
          <p className="text-[13px] text-fg-muted mt-1.5">
            {availableExams.length} available · {completedExams.length} completed
          </p>
        </div>

        {nothingAtAll ? (
          <EmptyState
            icon={ClipboardList}
            title="No exams yet"
            description="Your teacher will assign exams as the course progresses."
          />
        ) : (
          <div className="space-y-8">
            {[...subjects.values()].map(subject => {
              const pending = subject.homework.length + subject.exams.length
              return (
                <section key={subject.name}>
                  {/* Subject heading — only when there are multiple subjects */}
                  {subjects.size > 1 && (
                    <div className="flex items-center gap-2 mb-3">
                      {subject.fromCourse
                        ? <BookOpen className="w-3.5 h-3.5 text-fg-muted" aria-hidden="true" />
                        : <GraduationCap className="w-3.5 h-3.5 text-fg-muted" aria-hidden="true" />}
                      <h2 className="text-[13px] font-semibold text-fg">{subject.name}</h2>
                      <span className="text-[11px] text-fg-muted">
                        {pending > 0 ? `${pending} pending` : 'all done'}
                        {subject.completed.length > 0 && ` · ${subject.completed.length} submitted`}
                      </span>
                    </div>
                  )}

                  {/* Available — grid of action cards */}
                  {(subject.homework.length > 0 || subject.exams.length > 0) && (
                    <div className="space-y-4 mb-4">
                      {[
                        { label: 'Homework', list: subject.homework, homework: true },
                        { label: 'Timed Exams', list: subject.exams, homework: false },
                      ].filter(s => s.list.length > 0).map(section => (
                        <div key={section.label}>
                          {(subject.homework.length > 0 && subject.exams.length > 0) && (
                            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted mb-2">
                              {section.label}
                            </p>
                          )}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {section.list.map(exam => (
                              <ActiveCard key={exam.id} exam={exam} homework={section.homework} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Completed — compact list */}
                  {subject.completed.length > 0 && (
                    <div className="bg-surface border border-border rounded-lg overflow-hidden">
                      <div className="px-4 py-3 border-b border-border">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted">
                          Submitted · {subject.completed.length}
                        </p>
                      </div>
                      <div className="divide-y divide-border">
                        {subject.completed.map(exam => (
                          <CompletedCard key={exam.id} exam={exam} />
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
