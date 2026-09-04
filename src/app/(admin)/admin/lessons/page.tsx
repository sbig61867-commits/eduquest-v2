export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { BookOpen, Eye, EyeOff, Users } from 'lucide-react'
import { formatDate } from '@/lib/utils'

// Institution-wide lesson browser for university_admin. RLS already scopes
// this to the admin's own tenant (lessons_select grants university_admin
// their whole institution), and the explicit tenant_id filter is kept as
// defence in depth.
interface LessonRow {
  id: string
  title: string
  is_published: boolean
  created_at: string
  teacher: { full_name: string | null } | null
  groups: { name: string } | null
}

export default async function AdminLessonsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user?.tenant_id) redirect('/login')

  const { data: raw } = await supabase
    .from('lessons')
    .select('id, title, is_published, created_at, teacher:users!lessons_teacher_id_fkey(full_name), groups(name)')
    .eq('tenant_id', user.tenant_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  const lessons = (raw ?? []) as unknown as LessonRow[]
  const published = lessons.filter(l => l.is_published).length

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Lessons</h2>
        <p className="text-slate-400 mt-1">
          {lessons.length} lesson{lessons.length === 1 ? '' : 's'} across your institution · {published} published
        </p>
      </div>

      {lessons.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <BookOpen className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No lessons yet.</p>
          <p className="text-slate-500 text-sm mt-1">Teachers create lessons from their own panel.</p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">Lesson</th>
                <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden md:table-cell">Teacher</th>
                <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden lg:table-cell">Group</th>
                <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">Status</th>
                <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden xl:table-cell">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {lessons.map(lesson => (
                <tr key={lesson.id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-violet-600/20 flex items-center justify-center shrink-0">
                        <BookOpen className="w-4 h-4 text-violet-400" />
                      </div>
                      <p className="text-white text-sm font-medium">{lesson.title}</p>
                    </div>
                  </td>
                  <td className="px-5 py-4 hidden md:table-cell text-slate-300 text-sm">{lesson.teacher?.full_name ?? '—'}</td>
                  <td className="px-5 py-4 hidden lg:table-cell">
                    <span className="text-slate-300 text-sm flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-slate-500" />{lesson.groups?.name ?? '—'}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    {lesson.is_published ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-400 text-xs font-medium">
                        <Eye className="w-3.5 h-3.5" />Published
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-slate-500 text-xs font-medium">
                        <EyeOff className="w-3.5 h-3.5" />Draft
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 hidden xl:table-cell text-slate-500 text-sm">{formatDate(lesson.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
