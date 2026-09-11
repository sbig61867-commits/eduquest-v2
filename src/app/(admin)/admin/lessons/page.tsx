export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { BookOpen, Eye, EyeOff, Users } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { PageTitle } from '@/components/shared/page-title'

// Institution-wide lesson browser for university_admin. The admin is a
// pure administrator: RLS no longer grants them direct row access to
// lessons (that would expose lessons.content). Instead we read the
// get_admin_lessons() SECURITY DEFINER feed, which returns metadata only
// (title / teacher / group / status / date) — never the lesson body.
interface LessonRow {
  id: string
  title: string
  is_published: boolean
  created_at: string
  teacher_name: string | null
  group_name: string | null
}

export default async function AdminLessonsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user?.tenant_id) redirect('/login')

  const { data: raw } = await supabase.rpc('get_admin_lessons')

  const lessons = (raw ?? []) as unknown as LessonRow[]
  const published = lessons.filter(l => l.is_published).length

  return (
    <>
      <PageTitle title={'Lessons'} />
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-fg">Lessons</h2>
          <p className="text-fg-secondary mt-1">
            {lessons.length} lesson{lessons.length === 1 ? '' : 's'} across your institution · {published} published
          </p>
        </div>

        {lessons.length === 0 ? (
          <div className="text-center py-20 bg-surface border border-border rounded-lg">
            <BookOpen className="w-12 h-12 text-fg-muted mx-auto mb-3" />
            <p className="text-fg-secondary">No lessons yet.</p>
            <p className="text-fg-muted text-sm mt-1">Teachers create lessons from their own panel.</p>
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs font-medium text-fg-secondary uppercase tracking-wider px-5 py-3">Lesson</th>
                  <th className="text-left text-xs font-medium text-fg-secondary uppercase tracking-wider px-5 py-3 hidden md:table-cell">Teacher</th>
                  <th className="text-left text-xs font-medium text-fg-secondary uppercase tracking-wider px-5 py-3 hidden lg:table-cell">Group</th>
                  <th className="text-left text-xs font-medium text-fg-secondary uppercase tracking-wider px-5 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-fg-secondary uppercase tracking-wider px-5 py-3 hidden xl:table-cell">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lessons.map(lesson => (
                  <tr key={lesson.id} className="hover:bg-surface/50 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-accent-subtle flex items-center justify-center shrink-0">
                          <BookOpen className="w-4 h-4 text-accent" />
                        </div>
                        <p className="text-fg text-sm font-medium">{lesson.title}</p>
                      </div>
                    </td>
                    <td className="px-5 py-4 hidden md:table-cell text-fg-secondary text-sm">{lesson.teacher_name ?? '·'}</td>
                    <td className="px-5 py-4 hidden lg:table-cell">
                      <span className="text-fg-secondary text-sm flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-fg-muted" />{lesson.group_name ?? '·'}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {lesson.is_published ? (
                        <span className="inline-flex items-center gap-1.5 text-accent text-xs font-medium">
                          <Eye className="w-3.5 h-3.5" />Published
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-fg-muted text-xs font-medium">
                          <EyeOff className="w-3.5 h-3.5" />Draft
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 hidden xl:table-cell text-fg-muted text-sm">{formatDate(lesson.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
