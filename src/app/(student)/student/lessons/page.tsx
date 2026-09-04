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
        <h2 className="text-2xl font-bold text-white">My Lessons</h2>
        <p className="text-slate-400 mt-1">
          {lessons.length} lessons available
          {bySubject.size > 1 && ` · ${bySubject.size} مواد`}
        </p>
      </div>

      {lessons.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <BookOpen className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No lessons available yet.</p>
          <p className="text-slate-500 text-sm mt-1">Your teacher will publish lessons as the course progresses.</p>
        </div>
      ) : (
        [...bySubject.entries()].map(([subject, subjectLessons]) => (
        <section key={subject} className="border border-slate-800 rounded-2xl overflow-hidden">
          <header className="flex items-center gap-2.5 px-5 py-3.5 bg-slate-900/80 border-b border-slate-800" dir="rtl">
            <BookOpen className="w-4 h-4 text-blue-400 shrink-0" />
            <h3 className="text-white font-semibold truncate">{subject}</h3>
            <span className="text-slate-500 text-xs mr-auto shrink-0">{subjectLessons.length} درس</span>
          </header>
          <div className="p-5 space-y-3">
          {subjectLessons.map((lesson) => (
            <details key={lesson.id} className="group bg-slate-900 border border-slate-800 rounded-xl overflow-hidden hover:border-slate-700 transition-colors">
              <summary className="flex items-center justify-between p-5 cursor-pointer list-none">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-600/20 flex items-center justify-center shrink-0">
                    <BookOpen className="w-4 h-4 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold">{lesson.title}</h3>
                    {/* subject name lives in the section header now */}
                    <p className="text-slate-400 text-sm">{formatDate(lesson.created_at)}</p>
                  </div>
                </div>
                <span className="text-slate-500 text-sm group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="px-5 pb-5 border-t border-slate-800 pt-4">
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
