export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { BookOpen } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { LessonTabs } from '@/components/shared/lesson-tabs'

export default async function StudentLessonsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  // Get only the groups this student is enrolled in
  const { data: groupRows } = await supabase
    .from('group_students')
    .select('group_id')
    .eq('student_id', user.id)

  const groupIds = (groupRows ?? []).map(r => r.group_id)

  // groups!inner + is_active filter: lessons of archived groups are hidden.
  const lessons = groupIds.length === 0 ? [] : await supabase
    .from('lessons')
    .select('*, groups!inner(name, is_active)')
    .eq('is_published', true)
    .eq('groups.is_active', true)
    .in('group_id', groupIds)
    .order('created_at', { ascending: false })
    .then(r => r.data ?? [])

  // A student enrolled in several subjects must see each one in its own
  // section — a single merged list blurs two different courses together.
  type StudentLesson = { id: string; title: string; created_at: string; content: string; groups: { name: string } | null }
  const bySubject = new Map<string, StudentLesson[]>()
  for (const lesson of lessons as StudentLesson[]) {
    const subject = lesson.groups?.name ?? 'أخرى'
    const bucket = bySubject.get(subject)
    if (bucket) bucket.push(lesson)
    else bySubject.set(subject, [lesson])
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-fg">My Lessons</h2>
        <p className="text-fg-secondary mt-1">
          {lessons.length} lessons available
          {bySubject.size > 1 && ` · ${bySubject.size} مواد`}
        </p>
      </div>

      {lessons.length === 0 ? (
        <div className="text-center py-20 bg-surface border border-border rounded-lg">
          <BookOpen className="w-12 h-12 text-fg-muted mx-auto mb-3" />
          <p className="text-fg-secondary">No lessons available yet.</p>
          <p className="text-fg-muted text-sm mt-1">Your teacher will publish lessons as the course progresses.</p>
        </div>
      ) : (
        [...bySubject.entries()].map(([subject, subjectLessons]) => (
        <section key={subject} className="border border-border rounded-lg overflow-hidden">
          <header className="flex items-center gap-2.5 px-5 py-3.5 bg-surface/80 border-b border-border" dir="rtl">
            <BookOpen className="w-4 h-4 text-accent shrink-0" />
            <h3 className="text-fg font-semibold truncate">{subject}</h3>
            <span className="text-fg-muted text-xs mr-auto shrink-0">{subjectLessons.length} درس</span>
          </header>
          <div className="p-5 space-y-3">
          {subjectLessons.map((lesson) => (
            <details key={lesson.id} className="group bg-surface border border-border rounded-lg overflow-hidden hover:border-border-strong transition-colors">
              <summary className="flex items-center justify-between p-5 cursor-pointer list-none">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-accent-subtle flex items-center justify-center shrink-0">
                    <BookOpen className="w-4 h-4 text-accent" />
                  </div>
                  <div>
                    <h3 className="text-fg font-semibold">{lesson.title}</h3>
                    {/* subject name lives in the section header now */}
                    <p className="text-fg-secondary text-sm">{formatDate(lesson.created_at)}</p>
                  </div>
                </div>
                <span className="text-fg-muted text-sm group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="px-5 pb-5 border-t border-border pt-4">
                <LessonTabs content={lesson.content ?? ''} />
              </div>
            </details>
          ))}
          </div>
        </section>
        ))
      )}
    </div>
  )
}
