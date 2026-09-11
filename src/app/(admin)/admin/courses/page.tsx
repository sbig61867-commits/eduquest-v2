export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { GraduationCap, Layers, Eye, EyeOff, BookOpen } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { PageTitle } from '@/components/shared/page-title'

// Structured courses (levels → units → items), which is a different thing
// from a teaching group — /admin/groups already lists groups, and this page
// used to list them again, leaving the actual `courses` table with no admin
// view at all.
interface CourseRow {
  id: string
  title: string
  description: string | null
  language: string | null
  has_levels: boolean
  is_published: boolean
  created_at: string
  teacher: { full_name: string | null } | null
  course_levels: { count: number }[]
  course_units: { count: number }[]
  course_enrollments: { count: number }[]
}

export default async function AdminCoursesPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user?.tenant_id) redirect('/login')

  const { data: raw } = await supabase
    .from('courses')
    .select(`
      id, title, description, language, has_levels, is_published, created_at,
      teacher:users!courses_teacher_id_fkey(full_name),
      course_levels(count),
      course_units(count),
      course_enrollments(count)
    `)
    .eq('tenant_id', user.tenant_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  const courses = (raw ?? []) as unknown as CourseRow[]
  const count = (rows: { count: number }[] | undefined) => rows?.[0]?.count ?? 0

  const stats = [
    { label: 'Courses',     value: courses.length,                                   icon: BookOpen,      color: 'text-accent',  bg: 'bg-accent-subtle' },
    { label: 'Published',   value: courses.filter(c => c.is_published).length,        icon: Eye,           color: 'text-accent', bg: 'bg-accent-subtle' },
    { label: 'Units',       value: courses.reduce((s, c) => s + count(c.course_units), 0),       icon: Layers,        color: 'text-accent',    bg: 'bg-accent-subtle' },
    { label: 'Enrolments',  value: courses.reduce((s, c) => s + count(c.course_enrollments), 0), icon: GraduationCap, color: 'text-accent',   bg: 'bg-accent-subtle' },
  ]

  return (
    <>
      <PageTitle title={'Courses'} />
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-fg">Courses</h2>
          <p className="text-fg-secondary mt-1">Structured courses built by teachers in your institution</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map(s => (
            <div key={s.label} className="bg-surface border border-border rounded-lg p-4">
              <div className={`w-10 h-10 rounded-lg ${s.bg} flex items-center justify-center mb-3`}>
                <s.icon className={`w-5 h-5 ${s.color}`} />
              </div>
              <p className="text-xl font-semibold text-fg">{s.value}</p>
              <p className="text-fg-secondary text-sm mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {courses.length === 0 ? (
          <div className="text-center py-20 bg-surface border border-border rounded-lg">
            <BookOpen className="w-12 h-12 text-fg-muted mx-auto mb-3" />
            <p className="text-fg-secondary">No courses yet.</p>
            <p className="text-fg-muted text-sm mt-1">
              Teachers you have granted course-creation access build these from their panel.
            </p>
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs font-medium text-fg-secondary uppercase tracking-wider px-5 py-3">Course</th>
                  <th className="text-left text-xs font-medium text-fg-secondary uppercase tracking-wider px-5 py-3 hidden md:table-cell">Teacher</th>
                  <th className="text-left text-xs font-medium text-fg-secondary uppercase tracking-wider px-5 py-3 hidden lg:table-cell">Structure</th>
                  <th className="text-left text-xs font-medium text-fg-secondary uppercase tracking-wider px-5 py-3">Students</th>
                  <th className="text-left text-xs font-medium text-fg-secondary uppercase tracking-wider px-5 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-fg-secondary uppercase tracking-wider px-5 py-3 hidden xl:table-cell">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {courses.map(course => (
                  <tr key={course.id} className="hover:bg-surface/50 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-accent-subtle flex items-center justify-center shrink-0">
                          <BookOpen className="w-4 h-4 text-accent" />
                        </div>
                        <div>
                          <p className="text-fg text-sm font-medium">{course.title}</p>
                          {course.description && (
                            <p className="text-fg-muted text-xs mt-0.5 line-clamp-1">{course.description}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 hidden md:table-cell text-fg-secondary text-sm">{course.teacher?.full_name ?? '·'}</td>
                    <td className="px-5 py-4 hidden lg:table-cell text-fg-secondary text-sm">
                      {course.has_levels ? `${count(course.course_levels)} levels · ` : ''}{count(course.course_units)} units
                    </td>
                    <td className="px-5 py-4 text-fg-secondary text-sm">{count(course.course_enrollments)}</td>
                    <td className="px-5 py-4">
                      {course.is_published ? (
                        <span className="inline-flex items-center gap-1.5 text-accent text-xs font-medium">
                          <Eye className="w-3.5 h-3.5" />Published
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-fg-muted text-xs font-medium">
                          <EyeOff className="w-3.5 h-3.5" />Draft
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 hidden xl:table-cell text-fg-muted text-sm">{formatDate(course.created_at)}</td>
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
