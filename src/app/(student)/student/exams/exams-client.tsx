'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ClipboardList, ShieldCheck, Clock, Play, CheckCircle2, RotateCcw, BookOpen, GraduationCap } from 'lucide-react'
import { ExamTaker } from './exam-taker'
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
  completedExams:  ExamWithContext[]
  submissions: Submission[]
  userId: string
  violationWarningThreshold?: number
}

// Homework is stored in the exams table with a sentinel duration (43200 =
// untimed; legacy rows 0) — it is split from formal timed exams so students
// don't mistake lesson homework for an exam.
const isHomework = (e: ExamWithContext) => e.duration_minutes <= 0 || e.duration_minutes >= 43200
const untimedLabel = (e: ExamWithContext) => isHomework(e) ? 'بدون مؤقت' : `${e.duration_minutes} min`

// A student enrolled in several subjects (e.g. an English course AND a
// trainer-preparation course) must see each one in its own section, never a
// single merged list — an exam belongs to either a course or a group, and
// that is what identifies the subject it came from.
const subjectOf = (e: ExamWithContext) => e.courses?.title ?? e.groups?.name ?? 'أخرى'
const isCourse  = (e: ExamWithContext) => !!e.courses?.title

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

  // Group everything by subject, preserving the order each subject first
  // appears in (the server already sorts newest-first).
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
      <div className="bg-surface border border-border rounded-lg p-5 hover:border-border-strong transition-colors">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-fg font-semibold flex-1 min-w-0">{exam.title}</h3>
          {isRetake && <Badge variant="warning">Retake</Badge>}
        </div>
        <div className="flex items-center gap-4 mb-4 text-sm text-fg-muted">
          <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{untimedLabel(exam)}</span>
          <span className="flex items-center gap-1"><ClipboardList className="w-3.5 h-3.5" />{exam.questions.length} questions</span>
          {exam.proctoring_enabled && (
            <span className="flex items-center gap-1 text-accent"><ShieldCheck className="w-3.5 h-3.5" />Proctored</span>
          )}
        </div>
        <Button className="w-full" onClick={() => setActiveExam(exam)}>
          {isRetake
            ? <><RotateCcw className="w-4 h-4" /> {homework ? 'إعادة حل الواجب' : 'Retake Exam'}</>
            : <><Play className="w-4 h-4" /> {homework ? 'حل الواجب' : 'Start Exam'}</>}
        </Button>
      </div>
    )
  }

  function CompletedCard({ exam }: { exam: ExamWithContext }) {
    const sub = submissionMap[exam.id]
    const published = sub?.grading_status === 'published'
    return (
      <div className="bg-surface border border-border rounded-lg p-5 opacity-75">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-fg font-semibold flex-1 min-w-0">{exam.title}</h3>
          <Badge variant="success"><CheckCircle2 className="w-3 h-3" /> Submitted</Badge>
        </div>
        <div className="flex items-center gap-4 text-sm text-fg-muted">
          <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{untimedLabel(exam)}</span>
          {published && sub?.score != null ? (
            <span className="text-accent font-medium">
              العلامة: {sub.score}{sub.max_score ? ` / ${sub.max_score} (${Math.round(((sub.score ?? 0) / sub.max_score) * 100)}%)` : ''}
            </span>
          ) : (
            <span className="text-accent text-xs">Results pending</span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-fg">My Exams</h2>
        <p className="text-fg-secondary mt-1">
          {availableExams.length} available · {completedExams.length} completed
          {subjects.size > 1 && ` · ${subjects.size} مواد`}
        </p>
      </div>

      {nothingAtAll ? (
        <div className="text-center py-20 bg-surface border border-border rounded-lg">
          <ClipboardList className="w-12 h-12 text-fg-muted mx-auto mb-3" />
          <p className="text-fg-secondary">No exams available yet.</p>
        </div>
      ) : (
        [...subjects.values()].map(subject => {
          const pending = subject.homework.length + subject.exams.length
          return (
            <section key={subject.name} className="border border-border rounded-lg overflow-hidden">
              {/* One clearly-separated block per subject, so two courses never blur together */}
              <header className="flex items-center gap-2.5 px-5 py-3.5 bg-surface/80 border-b border-border" dir="rtl">
                {subject.fromCourse
                  ? <BookOpen className="w-4 h-4 text-accent shrink-0" />
                  : <GraduationCap className="w-4 h-4 text-accent shrink-0" />}
                <h3 className="text-fg font-semibold truncate">{subject.name}</h3>
                <span className="text-fg-muted text-xs mr-auto shrink-0">
                  {pending > 0 ? `${pending} بانتظارك` : 'مكتملة'}
                  {subject.completed.length > 0 && ` · ${subject.completed.length} مُسلَّمة`}
                </span>
              </header>

              <div className="p-5 space-y-5">
                {[
                  { label: '📋 الواجبات', list: subject.homework, homework: true },
                  { label: '🕒 الاختبارات', list: subject.exams, homework: false },
                ].filter(s => s.list.length > 0).map(section => (
                  <div key={section.label} className="space-y-3">
                    <h4 className="text-xs font-semibold text-fg-secondary uppercase tracking-wider">{section.label}</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {section.list.map(exam => (
                        <ActiveCard key={exam.id} exam={exam} homework={section.homework} />
                      ))}
                    </div>
                  </div>
                ))}

                {subject.completed.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold text-fg-secondary uppercase tracking-wider">✅ مكتملة</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {subject.completed.map(exam => <CompletedCard key={exam.id} exam={exam} />)}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}
