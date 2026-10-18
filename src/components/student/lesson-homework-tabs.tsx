'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { BookOpen, ClipboardList, Clock, Play, RotateCcw } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { toLocale } from '@/i18n/config'
import { isScoreVisible } from '@/lib/score-visibility'

// The lesson's homework inside the lesson (owner, 2026-10-18): the same two
// tabs the teacher has, Content and Homework. Solving still happens on the
// exam screen (/student/exams?open=<id>), which re-checks everything.

export interface LessonHomeworkItem {
  id: string
  title: string
  instructions: string | null
  question_count: number
  duration_minutes: number
  ends_at: string | null
  assigned_to_me: boolean
  has_manual_questions: boolean
  /** null: not submitted yet. */
  submission: { score: number | null; max_score: number | null; grading_status: string } | null
  can_redo: boolean
}

export function LessonHomeworkTabs({ homework, children }: { homework: LessonHomeworkItem[]; children: ReactNode }) {
  const t = useTranslations('student.lessonHomework')
  const te = useTranslations('student.exams')
  const locale = toLocale(useLocale())
  const [tab, setTab] = useState<'content' | 'homework'>('content')
  const open = homework.filter(h => !h.submission || h.can_redo).length

  const tabClass = (on: boolean) =>
    `eq-focus inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-body-sm font-medium sm:px-5 ${on ? 'border-accent text-fg' : 'border-transparent text-fg-3 hover:text-fg'}`

  return (
    <>
      <div role="tablist" aria-label={t('tabsLabel')} className="mb-6 flex overflow-x-auto overflow-y-hidden [scrollbar-width:thin] border-b border-line">
        <button type="button" role="tab" aria-selected={tab === 'content'} onClick={() => setTab('content')} className={tabClass(tab === 'content')}>
          <BookOpen className="h-4 w-4" aria-hidden="true" /> {t('content')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'homework'} onClick={() => setTab('homework')} className={tabClass(tab === 'homework')}>
          <ClipboardList className="h-4 w-4" aria-hidden="true" /> {t('homework')}
          {open > 0 && <span className="rounded-full bg-accent px-1.5 text-label text-on-accent">{open}</span>}
        </button>
      </div>

      {/* The lesson stays mounted, so returning to it keeps the reading position. */}
      <div role="tabpanel" hidden={tab !== 'content'}>{children}</div>

      {tab === 'homework' && (
        <div role="tabpanel" className="space-y-3">
          {homework.length === 0 && <p className="rounded-overlay border border-line bg-surface p-6 text-center text-body-sm text-fg-2">{t('empty')}</p>}
          {homework.map(h => {
            const done = !!h.submission
            const showScore = done && isScoreVisible(h.submission!.grading_status, 'homework', h.has_manual_questions)
            return (
              <article key={h.id} className="rounded-overlay border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start gap-2">
                  <h2 className="min-w-0 flex-1 break-words text-body font-semibold text-fg">{h.title}</h2>
                  {h.assigned_to_me && <span className="rounded-control bg-accent-subtle px-2 py-0.5 text-label text-accent">{te('forYou')}</span>}
                  {done && <span className="rounded-control bg-elevated px-2 py-0.5 text-label text-fg-2">{t('submitted')}</span>}
                </div>
                {h.instructions && <p className="mt-2 line-clamp-3 whitespace-pre-line text-body-sm text-fg-2">{h.instructions}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-fg-3">
                  <span className="inline-flex items-center gap-1"><ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />{te('questionCount', { count: h.question_count })}</span>
                  <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    {h.duration_minutes > 0 && h.duration_minutes < 43200 ? te('minutesShort', { count: h.duration_minutes }) : te('untimed')}
                  </span>
                  {h.ends_at && <span>{t('due', { date: formatDateTime(h.ends_at, locale) })}</span>}
                </div>
                {done && (
                  <p className="mt-3 text-body-sm text-fg">
                    {showScore && h.submission!.score !== null
                      ? t('score', { score: h.submission!.score, max: h.submission!.max_score ?? 0 })
                      : t('awaitingGrade')}
                  </p>
                )}
                {(!done || h.can_redo) && (
                  <Link href={`/student/exams?open=${h.id}`}
                    className="eq-focus mt-4 inline-flex w-full items-center justify-center gap-2 rounded-control bg-accent px-4 py-2 text-body-sm font-medium text-on-accent hover:bg-accent-hover">
                    {done ? <><RotateCcw className="h-4 w-4" aria-hidden="true" /> {te('redoHomework')}</> : <><Play className="h-4 w-4" aria-hidden="true" /> {te('solveHomework')}</>}
                  </Link>
                )}
              </article>
            )
          })}
        </div>
      )}
    </>
  )
}
