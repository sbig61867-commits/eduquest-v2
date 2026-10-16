'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import type { LessonSummary } from '@/lib/assistant/lesson-summary'

// One lesson's structured summary (src/lib/assistant/lesson-summary.ts).
// Plain text only — nothing is rendered as HTML.

export function LessonSummaryView({ lessonId, summary }: { lessonId: string; summary: LessonSummary }) {
  const t = useTranslations('student.assistant.orb.summary')
  const hasOverview = summary.sections.some(s => s.gist || s.title)

  return (
    <article className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h3 className="text-h3 text-fg">{summary.title}</h3>
        <p className="text-meta text-fg-muted">
          {t('reading', { minutes: summary.readingMinutes })} · {t('sections', { count: summary.sectionCount })}
        </p>
      </header>

      {hasOverview && (
        <section className="flex flex-col gap-2">
          <h4 className="text-label text-fg-muted">{t('overview')}</h4>
          <ol className="flex flex-col gap-2">
            {summary.sections.map((s, i) => (
              <li key={i} className="flex gap-2 text-body-sm">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-label text-accent">{i + 1}</span>
                <span className="flex flex-col">
                  {s.title && <span className="font-semibold text-fg">{s.title}</span>}
                  {s.gist && <span className="text-fg-2">{s.gist}</span>}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {summary.keyPoints.length > 0 && (
        <section className="flex flex-col gap-2">
          <h4 className="text-label text-fg-muted">{t('keyPoints')}</h4>
          <ul className="flex flex-col gap-1.5">
            {summary.keyPoints.map((p, i) => (
              <li key={i} className="flex gap-2 text-body-sm text-fg-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                {p}
              </li>
            ))}
          </ul>
        </section>
      )}

      {summary.terms.length > 0 && (
        <section className="flex flex-col gap-2">
          <h4 className="text-label text-fg-muted">{t('terms')}</h4>
          <ul className="flex flex-wrap gap-1.5">
            {summary.terms.map((term, i) => (
              <li key={i} className="rounded-control border border-line bg-elevated px-2 py-0.5 text-meta text-fg">{term}</li>
            ))}
          </ul>
        </section>
      )}

      {summary.concepts && (
        <section className="flex flex-col gap-2">
          <h4 className="text-label text-fg-muted">{t('concepts')}</h4>
          <p className="text-body-sm text-fg">
            <span className="font-semibold">{summary.concepts.root}</span>
            {summary.concepts.branches.length > 0 && <span className="text-fg-2"> — {summary.concepts.branches.join(' · ')}</span>}
          </p>
        </section>
      )}

      {(summary.practice.quizQuestions > 0 || summary.practice.flashcards > 0) && (
        <section className="flex flex-col gap-1">
          <h4 className="text-label text-fg-muted">{t('practice')}</h4>
          {summary.practice.quizQuestions > 0 && <p className="text-body-sm text-fg-2">{t('quiz', { count: summary.practice.quizQuestions })}</p>}
          {summary.practice.flashcards > 0 && <p className="text-body-sm text-fg-2">{t('flashcards', { count: summary.practice.flashcards })}</p>}
        </section>
      )}

      <footer className="flex items-center justify-between gap-2 border-t border-line pt-3">
        <p className="text-label text-fg-muted">{t('note')}</p>
        <Link
          href={`/student/lessons/${lessonId}`}
          className="shrink-0 rounded-control bg-accent px-3 py-1.5 text-body-sm font-semibold text-accent-fg hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-focus"
        >
          {t('openLesson')}
        </Link>
      </footer>
    </article>
  )
}
