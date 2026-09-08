export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { BookOpen } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { LessonTabs } from '@/components/shared/lesson-tabs'
import { PageTitle } from '@/components/shared/page-title'
import { EmptyState } from '@/components/ui/empty-state'

type StudentLesson = { id: string; title: string; created_at: string; content: string; groups: { name: string } | null }

export default async function StudentLessonsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const { data: groupRows } = await supabase
    .from('group_students')
    .select('group_id')
    .eq('student_id', user.id)

  const groupIds = (groupRows ?? []).map(r => r.group_id)

  const lessons: StudentLesson[] = groupIds.length === 0 ? [] : await supabase
    .from('lessons')
    .select('*, groups!inner(name, is_active)')
    .eq('is_published', true)
    .eq('groups.is_active', true)
    .in('group_id', groupIds)
    .order('created_at', { ascending: false })
    .then(r => (r.data ?? []) as StudentLesson[])

  const bySubject = new Map<string, StudentLesson[]>()
  for (const lesson of lessons) {
    const subject = lesson.groups?.name ?? 'Other'
    const bucket = bySubject.get(subject)
    if (bucket) bucket.push(lesson)
    else bySubject.set(subject, [lesson])
  }

  return (
    <>
      <PageTitle title="Lessons" />

      <div className="max-w-3xl mx-auto">
        {/* Page header */}
        <div className="mb-7">
          <h1 className="text-xl font-semibold text-fg">Lessons</h1>
          <p className="text-[13px] text-fg-muted mt-1.5">
            {lessons.length} {lessons.length === 1 ? 'lesson' : 'lessons'} available
            {bySubject.size > 1 && ` · ${bySubject.size} subjects`}
          </p>
        </div>

        {lessons.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No lessons yet"
            description="Your teacher will publish lessons as the course progresses."
          />
        ) : (
          <div className="space-y-8">
            {[...bySubject.entries()].map(([subject, subjectLessons]) => (
              <section key={subject}>
                {/* Subject header — only shown when there are multiple subjects */}
                {bySubject.size > 1 && (
                  <div className="flex items-center gap-2 mb-3">
                    <h2 className="text-[13px] font-semibold text-fg">{subject}</h2>
                    <span className="text-[11px] text-fg-muted">
                      {subjectLessons.length} {subjectLessons.length === 1 ? 'lesson' : 'lessons'}
                    </span>
                  </div>
                )}

                {/* Lesson list */}
                <div className="bg-surface border border-border rounded-lg overflow-hidden divide-y divide-border">
                  {subjectLessons.map((lesson) => (
                    <details key={lesson.id} className="group">
                      <summary className="flex items-center gap-4 px-5 py-4 cursor-pointer list-none hover:bg-canvas transition-colors">
                        <div className="w-8 h-8 rounded-lg bg-accent-subtle flex items-center justify-center shrink-0">
                          <BookOpen className="w-[15px] h-[15px] text-accent" aria-hidden="true" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-medium text-fg leading-snug truncate">
                            {lesson.title}
                          </p>
                          <p className="text-[11px] text-fg-muted mt-0.5">
                            {formatDate(lesson.created_at)}
                          </p>
                        </div>
                        <svg
                          className="w-3.5 h-3.5 text-fg-muted shrink-0 transition-transform duration-150 group-open:rotate-180"
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                          aria-hidden="true"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </summary>
                      <div className="px-5 pb-5 pt-4 border-t border-border bg-canvas">
                        <LessonTabs content={lesson.content ?? ''} />
                      </div>
                    </details>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
