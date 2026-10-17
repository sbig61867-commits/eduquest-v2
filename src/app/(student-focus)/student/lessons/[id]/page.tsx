export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { ChevronRight } from 'lucide-react'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { LessonView } from '@/components/lesson/lesson-view'
import { AskAiMenu } from '@/components/student/ask-ai-menu'
import { activeExamSince } from '@/lib/ask-ai'

// One lesson, full width, nothing else on screen. Read through the student's
// own session: RLS (published lessons of their own groups) decides, and an
// archived group's lesson stays hidden exactly as on the list.
export default async function StudentLessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const t = await getTranslations('common.lessonView')
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  // The lesson, and whether the student is in the middle of an exam: the
  // "Ask an AI" menu is never offered while an attempt is running.
  const since = activeExamSince()
  const [{ data: lesson }, { count: runningExams }] = await Promise.all([
    supabase
      .from('lessons').select('id, title, content, groups!inner(name, is_active)')
      .eq('id', id).eq('groups.is_active', true).maybeSingle(),
    supabase
      .from('exam_submissions').select('id', { count: 'exact', head: true })
      .eq('student_id', user.id).eq('status', 'in_progress').gte('started_at', since),
  ])
  if (!lesson) notFound()
  const group = lesson.groups as unknown as { name: string } | null

  return (
    <>
      <header className="sticky top-0 z-20 bg-surface border-b border-line">
        <div className="max-w-6xl mx-auto flex items-center gap-3 px-4 h-14">
          <Link href="/student/lessons" className="eq-focus inline-flex items-center gap-1 rounded-control px-2 py-1 text-body-sm text-fg-2 hover:text-fg hover:bg-elevated shrink-0">
            <ChevronRight className="w-4 h-4 ltr:rotate-180" /> {t('back')}
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-h3 text-fg truncate">{lesson.title}</h1>
            {group?.name && <p className="text-label text-fg-3 truncate">{group.name}</p>}
          </div>
          {!runningExams && <AskAiMenu lessonTitle={lesson.title} groupName={group?.name} />}
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6 lg:py-8" style={{ ['--eq-sticky-offset' as string]: '3.5rem' }}>
        <LessonView content={lesson.content as string | null} title={lesson.title} lessonId={lesson.id} />
      </main>
    </>
  )
}
