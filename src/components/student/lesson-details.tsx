'use client'

import { useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { LessonTabs } from '@/components/shared/lesson-tabs'

/**
 * One lesson on /student/lessons (Batch 3 / P-05). The page sends only the
 * title row (`summary`) and the lesson's homework (`children`); the body is
 * read the first time the student opens the lesson — through the student's own
 * session, so RLS (published lessons of their own groups) and the page's
 * active-group filter decide exactly as for the list.
 */
export function LessonDetails({ lessonId, summary, children }: { lessonId: string; summary: ReactNode; children?: ReactNode }) {
  const t = useTranslations('student.lessons')
  const [content, setContent] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const requested = useRef(false)

  async function load() {
    if (requested.current) return
    requested.current = true
    const { data, error } = await createClient()
      .from('lessons').select('content, groups!inner(is_active)')
      .eq('id', lessonId).eq('groups.is_active', true).single()
    if (error || !data) { setFailed(true); requested.current = false; return }
    setContent((data.content as string | null) ?? '')
  }

  return (
    <details
      className="group bg-slate-900 border border-slate-800 rounded-xl overflow-hidden hover:border-slate-700 transition-colors"
      onToggle={e => { if ((e.currentTarget as HTMLDetailsElement).open) void load() }}
    >
      {summary}
      <div className="px-5 pb-5 border-t border-slate-800 pt-4 space-y-4">
        {content !== null
          ? <LessonTabs content={content} />
          : <p className="text-slate-500 text-sm">{failed ? t('loadFailed') : t('loading')}</p>}
        {children}
      </div>
    </details>
  )
}
