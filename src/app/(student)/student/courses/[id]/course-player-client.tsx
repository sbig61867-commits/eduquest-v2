'use client'

import { useTranslations, useLocale } from 'next-intl'
import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown,
  FileText, GraduationCap, ListChecks, PlayCircle, Sparkles, Video,
  ClipboardList, ShieldCheck, Clock, Hourglass,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { LessonView } from '@/components/lesson/lesson-view'
import { toast } from '@/components/ui/toast'
import { cn, formatDateTime } from '@/lib/utils'
import { parseVideoUrl } from '@/lib/video-embed'
import type { StudentExam } from '@/lib/data/student-exams'
import type { Locale } from '@/i18n/config'

// The exam screen carries LiveKit and the proctoring detectors; load it only
// when the student actually starts a quiz or task.
const ExamTaker = dynamic(() => import('../../exams/exam-taker').then(m => m.ExamTaker), {
  ssr: false,
  loading: () => <div className="h-64 rounded-xl bg-slate-800 animate-pulse" />,
})

export interface PlayerItem {
  id: string
  type: string
  title: string
  body: string
  /** quiz / task items: the exam row they run on (unit_items.content.exam_id). */
  examId?: string | null
  /** video items: the link the teacher pasted (unit_items.content.video_url). */
  videoUrl?: string | null
}

/** A linked quiz or task as the student exam list serves it (no questions), plus this student's attempt. */
export interface PlayerAssessment {
  exam: StudentExam
  submission: { status: string; score: number | null; maxScore: number | null; gradingStatus: string } | null
}

export interface PlayerUnit {
  id: string
  title: string
  items: PlayerItem[]
}

export interface PlayerLevel {
  id: string
  title: string
  units: PlayerUnit[]
}

interface Props {
  course: {
    id: string
    title: string
    description: string | null
    language: string | null
    teacherName: string | null
  }
  levels: PlayerLevel[]
  completedIds: string[]
  /** Quiz / task items handed in but without a student_progress row yet. */
  unsyncedIds?: string[]
  /** Keyed by exam id; a linked exam missing here is not available to the student. */
  assessments?: Record<string, PlayerAssessment>
  violationWarningThreshold?: number
  /** Read from the session on the server; RLS re-checks it against current_tenant_id(). */
  studentId: string
  tenantId: string
}

const TYPE_ICON: Record<string, typeof FileText> = {
  text: FileText,
  grammar: BookOpen,
  idioms: Sparkles,
  rules: ListChecks,
  task: ListChecks,
  quiz: ListChecks,
  video: Video,
}

// Item-type labels come from the message layer, looked up at render. As a
// module constant this froze one locale for the whole process — and half of
// it was still English while the rest of the screen was Arabic.
const ITEM_TYPES = ['text', 'grammar', 'idioms', 'rules', 'task', 'quiz', 'video'] as const

export function CoursePlayerClient({
  course, levels, completedIds, unsyncedIds = [], assessments = {}, violationWarningThreshold, studentId, tenantId,
}: Props) {
  const t = useTranslations('student.player')
  const supabase = createClient()
  const router = useRouter()
  // Server truth (progress rows + handed-in quizzes) plus what was marked here.
  const [markedHere, setMarkedHere] = useState<Set<string>>(() => new Set())
  const completed = useMemo(() => new Set([...completedIds, ...markedHere]), [completedIds, markedHere])
  const setCompleted = (next: (prev: Set<string>) => Set<string>) => setMarkedHere(prev => next(prev))
  const [taking, setTaking] = useState<string | null>(null)

  // Record progress for quizzes/tasks handed in without a progress row
  // (e.g. from the exams page), so the course percentage everywhere agrees.
  const unsyncedKey = unsyncedIds.join(',')
  useEffect(() => {
    if (!unsyncedKey) return
    void supabase.from('student_progress').upsert(
      unsyncedKey.split(',').map(id => ({ student_id: studentId, unit_item_id: id, tenant_id: tenantId })),
      { onConflict: 'student_id,unit_item_id', ignoreDuplicates: true },
    )
  }, [unsyncedKey, studentId, tenantId, supabase])
  const [saving, setSaving] = useState(false)
  const [openLevels, setOpenLevels] = useState<Record<string, boolean>>(
    () => Object.fromEntries(levels.map((l, i) => [l.id, i === 0]))
  )

  // A flat reading order across every level and unit — drives prev/next.
  const flat = useMemo(
    () =>
      levels.flatMap(level =>
        level.units.flatMap(unit =>
          unit.items.map(item => ({ item, unitTitle: unit.title, levelTitle: level.title }))
        )
      ),
    [levels]
  )

  // Resume where the student left off: first item they have not finished.
  const [activeIndex, setActiveIndex] = useState(() => {
    const done = new Set(completedIds)
    const next = flat.findIndex(entry => !done.has(entry.item.id))
    return next === -1 ? 0 : next
  })

  const total = flat.length
  const doneCount = flat.filter(entry => completed.has(entry.item.id)).length
  const percent = total === 0 ? 0 : Math.round((doneCount / total) * 100)
  const current = flat[activeIndex]

  async function markComplete() {
    if (!current || completed.has(current.item.id)) return
    setSaving(true)
    // student_progress RLS pins student_id = auth.uid() and tenant_id =
    // current_tenant_id(), so neither value can be forged from the client.
    const { error } = await supabase
      .from('student_progress')
      .upsert(
        { student_id: studentId, unit_item_id: current.item.id, tenant_id: tenantId },
        { onConflict: 'student_id,unit_item_id', ignoreDuplicates: true }
      )
    setSaving(false)

    if (error) {
      toast.error(t('saveFailed'))
      return
    }

    setCompleted(prev => new Set(prev).add(current.item.id))
    if (activeIndex < total - 1) setActiveIndex(activeIndex + 1)
    else toast.success(t('completed'))
  }

  if (total === 0) {
    return (
      <div className="max-w-3xl mx-auto">
        <BackLink />
        <div className="mb-7">
          <h1 className="text-xl font-semibold text-fg">{course.title}</h1>
        </div>
        <EmptyState
          icon={GraduationCap}
          title={t('nothingPublished')}
          description={t('nothingPublishedHint')}
        />
      </div>
    )
  }

  const Icon = TYPE_ICON[current.item.type] ?? FileText
  const linked = current.item.examId ? assessments[current.item.examId] : undefined
  const isAssessment = !!current.item.examId
  const videoSource = current.item.type === 'video' ? parseVideoUrl(current.item.videoUrl) : null

  if (taking && assessments[taking]) {
    return (
      <div className="max-w-4xl mx-auto">
        <ExamTaker
          exam={assessments[taking].exam}
          userId={studentId}
          tenantId={tenantId}
          violationWarningThreshold={violationWarningThreshold}
          finishLabel={t('backToCourse')}
          onFinish={() => { setTaking(null); router.refresh() }}
        />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      <BackLink />

      {/* Course header + overall progress */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-fg">{course.title}</h1>
        <p className="text-[13px] text-fg-muted mt-1.5">
          {course.teacherName && <>{course.teacherName} · </>}
          {t('sectionsDone', { done: doneCount, total })}
        </p>
        <div className="mt-3 w-full bg-border rounded-full h-1.5">
          <div
            className="bg-accent h-1.5 rounded-full transition-all"
            style={{ width: `${percent}%` }}
            role="progressbar"
            aria-label={t('progress')}
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 items-start">
        {/* Outline */}
        <nav aria-label={t('contents')} className="bg-surface border border-border rounded-lg p-2 lg:sticky lg:top-4">
          {levels.map(level => {
            const isOpen = level.title === '' ? true : openLevels[level.id] !== false
            return (
              <div key={level.id} className="mb-1 last:mb-0">
                {level.title !== '' && (
                  <button
                    type="button"
                    onClick={() => setOpenLevels(p => ({ ...p, [level.id]: !isOpen }))}
                    aria-expanded={isOpen}
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-[13px] font-medium text-fg hover:bg-canvas transition-colors"
                  >
                    <span className="truncate text-start">{level.title}</span>
                    <ChevronDown
                      className={cn('w-4 h-4 shrink-0 text-fg-muted transition-transform', !isOpen && '-rotate-90 rtl:rotate-90')}
                      aria-hidden="true"
                    />
                  </button>
                )}

                {isOpen && level.units.map(unit => (
                  <div key={unit.id} className="mt-1">
                    <p className="px-2.5 py-1 text-[11px] uppercase tracking-wide text-fg-muted truncate">
                      {unit.title}
                    </p>
                    <ul>
                      {unit.items.map(item => {
                        const index = flat.findIndex(entry => entry.item.id === item.id)
                        const isActive = index === activeIndex
                        const isDone = completed.has(item.id)
                        return (
                          <li key={item.id}>
                            <button
                              type="button"
                              onClick={() => setActiveIndex(index)}
                              aria-current={isActive ? 'true' : undefined}
                              className={cn(
                                'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-start transition-colors',
                                isActive ? 'bg-accent-subtle text-accent font-medium' : 'text-fg-secondary hover:bg-canvas hover:text-fg'
                              )}
                            >
                              {isDone
                                ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-success" aria-hidden="true" />
                                : <PlayCircle className="w-3.5 h-3.5 shrink-0 text-fg-muted" aria-hidden="true" />}
                              <span className="truncate">{item.title}</span>
                              {isDone && <span className="sr-only">{t('completedSr')}</span>}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )
          })}
        </nav>

        {/* Reader */}
        <article className="bg-surface border border-border rounded-lg p-6 min-w-0">
          <div className="flex items-start gap-3 pb-4 mb-5 border-b border-border">
            <div className="w-9 h-9 rounded-lg bg-accent-subtle flex items-center justify-center shrink-0">
              <Icon className="w-[17px] h-[17px] text-accent" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] uppercase tracking-wide text-fg-muted">
                {(ITEM_TYPES as readonly string[]).includes(current.item.type) ? t(`itemType.${current.item.type}`) : current.item.type}
                {current.unitTitle && <> · {current.unitTitle}</>}
              </p>
              <h2 className="text-[15px] font-semibold text-fg leading-snug mt-0.5">{current.item.title}</h2>
            </div>
            {completed.has(current.item.id) && (
              <span className="flex items-center gap-1.5 text-[12px] text-success shrink-0">
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                {t('done')}
              </span>
            )}
          </div>

          {current.item.type === 'video' && (
            videoSource
              ? <VideoPlayer source={videoSource} title={current.item.title} />
              : <p className="text-[13px] text-fg-muted mb-4">{t('videoUnavailable')}</p>
          )}

          {isAssessment && (
            <AssessmentPanel
              kind={current.item.type === 'task' ? 'task' : 'quiz'}
              assessment={linked}
              onStart={() => setTaking(current.item.examId!)}
            />
          )}

          {current.item.body.trim()
            ? <LessonView key={current.item.id} content={current.item.body} title={current.item.title} itemId={current.item.id} />
            : !isAssessment && current.item.type !== 'video' && <p className="text-[13px] text-fg-muted">{t('noContent')}</p>}

          {/* Section navigation */}
          <div className="flex flex-wrap items-center gap-3 mt-8 pt-5 border-t border-border">
            <Button
              variant="secondary"
              size="sm"
              disabled={activeIndex === 0}
              onClick={() => setActiveIndex(i => Math.max(0, i - 1))}
            >
              <ArrowLeft className="w-4 h-4 rtl:hidden" aria-hidden="true" />
              <ArrowRight className="w-4 h-4 hidden rtl:inline" aria-hidden="true" />
              {t('prev')}
            </Button>

            {!isAssessment && !completed.has(current.item.id) ? (
              <Button size="sm" loading={saving} onClick={markComplete}>
                {t('markComplete')}
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={activeIndex >= total - 1}
                onClick={() => setActiveIndex(i => Math.min(total - 1, i + 1))}
              >
                {t('next')}
                <ArrowRight className="w-4 h-4 rtl:hidden" aria-hidden="true" />
                <ArrowLeft className="w-4 h-4 hidden rtl:inline" aria-hidden="true" />
              </Button>
            )}

            <span className="text-[12px] text-fg-muted ms-auto">
              {t('sectionOf', { n: activeIndex + 1, total })}
            </span>
          </div>
        </article>
      </div>
    </div>
  )
}

function BackLink() {
  const t = useTranslations('student')
  return (
    <Link
      href="/student/courses"
      className="inline-flex items-center gap-1.5 text-[13px] text-fg-muted hover:text-fg transition-colors mb-4"
    >
      <ArrowLeft className="w-3.5 h-3.5 rtl:hidden" aria-hidden="true" />
      <ArrowRight className="w-3.5 h-3.5 hidden rtl:inline" aria-hidden="true" />
      {t('player.allCourses')}
    </Link>
  )
}

function VideoPlayer({ source, title }: { source: NonNullable<ReturnType<typeof parseVideoUrl>>; title: string }) {
  return (
    <div className="mb-5 rounded-lg overflow-hidden bg-black aspect-video">
      {source.kind === 'file' ? (
        <video src={source.url} controls preload="metadata" className="w-full h-full">
          <track kind="captions" />
        </video>
      ) : (
        <iframe
          src={source.embedUrl}
          title={title}
          className="w-full h-full"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
        />
      )}
    </div>
  )
}

/**
 * A quiz or task item: what it is, where the student stands, and the one
 * action that makes sense next. Grades appear only once the teacher's
 * grading is published, exactly as on the exams and grades pages.
 */
function AssessmentPanel({ kind, assessment, onStart }: {
  kind: 'quiz' | 'task'
  assessment: PlayerAssessment | undefined
  onStart: () => void
}) {
  const t = useTranslations('student.player.assessment')
  const locale = useLocale() as Locale
  // Captured once per mount: the purity lint forbids Date.now() during render.
  const [now] = useState(() => Date.now())

  if (!assessment) {
    return (
      <div className="mb-5 rounded-lg border border-border bg-canvas p-4 text-[13px] text-fg-muted flex items-center gap-2">
        <Hourglass className="w-4 h-4 shrink-0" aria-hidden="true" />
        {kind === 'quiz' ? t('quizNotAvailable') : t('taskNotAvailable')}
      </div>
    )
  }

  const { exam, submission } = assessment
  const isTask = exam.type === 'homework'
  const questions = exam.question_count
  const closed = !!exam.ends_at && new Date(exam.ends_at).getTime() < now
  const handedIn = submission?.status === 'submitted'
  const inProgress = submission?.status === 'in_progress'
  const graded = handedIn && submission.gradingStatus === 'published' && submission.score != null

  return (
    <div className="mb-5 rounded-lg border border-border bg-canvas p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-accent-subtle flex items-center justify-center shrink-0">
          <ClipboardList className="w-[17px] h-[17px] text-accent" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-fg">{exam.title}</p>
          <p className="text-[12px] text-fg-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{t('questions', { count: questions })}</span>
            {isTask ? (
              <span>· {exam.ends_at ? t('due', { date: formatDateTime(exam.ends_at, locale) }) : t('noDue')}</span>
            ) : (
              <span className="inline-flex items-center gap-1">· <Clock className="w-3 h-3" aria-hidden="true" />{t('minutes', { count: exam.duration_minutes })}</span>
            )}
            {exam.proctoring_enabled && (
              <span className="inline-flex items-center gap-1">· <ShieldCheck className="w-3 h-3" aria-hidden="true" />{t('proctored')}</span>
            )}
          </p>
        </div>
      </div>

      {handedIn ? (
        graded ? (
          <p className="text-[13px] text-success flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
            {t('score', {
              score: submission.score!,
              max: submission.maxScore ?? 0,
              pct: submission.maxScore ? Math.round((submission.score! / submission.maxScore) * 100) : 0,
            })}
          </p>
        ) : (
          <p className="text-[13px] text-fg-secondary flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-success" aria-hidden="true" />
            {t('awaitingGrade')}
          </p>
        )
      ) : closed ? (
        <p className="text-[13px] text-fg-muted">{t('closed')}</p>
      ) : (
        <Button size="sm" onClick={onStart}>
          <PlayCircle className="w-4 h-4" aria-hidden="true" />
          {inProgress ? t('resume') : isTask ? t('startTask') : t('startQuiz')}
        </Button>
      )}
    </div>
  )
}
