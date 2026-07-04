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

  const lessons = groupIds.length === 0 ? [] : await supabase
    .from('lessons')
    .select('*, groups(name)')
    .eq('is_published', true)
    .in('group_id', groupIds)
    .order('created_at', { ascending: false })
    .then(r => r.data ?? [])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">My Lessons</h2>
        <p className="text-slate-400 mt-1">{lessons.length} lessons available</p>
      </div>

      {lessons.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <BookOpen className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No lessons available yet.</p>
          <p className="text-slate-500 text-sm mt-1">Your teacher will publish lessons as the course progresses.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(lessons as Array<{ id: string; title: string; created_at: string; content: string; groups: { name: string } | null }>).map((lesson) => (
            <details key={lesson.id} className="group bg-slate-900 border border-slate-800 rounded-xl overflow-hidden hover:border-slate-700 transition-colors">
              <summary className="flex items-center justify-between p-5 cursor-pointer list-none">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-600/20 flex items-center justify-center shrink-0">
                    <BookOpen className="w-4 h-4 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold">{lesson.title}</h3>
                    <p className="text-slate-400 text-sm">{lesson.groups?.name ?? '—'} · {formatDate(lesson.created_at)}</p>
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
      )}
    </div>
  )
}
