export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { getTranslations, getLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/config'
import { redirect } from 'next/navigation'
import { GraduationCap, Layers, Eye, EyeOff, BookOpen } from 'lucide-react'
import { formatDate } from '@/lib/utils'

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
  const t = await getTranslations('admin.content')
  const locale = (await getLocale()) as Locale
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
    { label: t('courses.cards.courses'),     value: courses.length,                                   icon: BookOpen,      color: 'text-violet-400',  bg: 'bg-violet-600/20' },
    { label: t('courses.cards.published'),   value: courses.filter(c => c.is_published).length,        icon: Eye,           color: 'text-emerald-400', bg: 'bg-emerald-600/20' },
    { label: t('courses.cards.units'),       value: courses.reduce((s, c) => s + count(c.course_units), 0),       icon: Layers,        color: 'text-blue-400',    bg: 'bg-blue-600/20' },
    { label: t('courses.cards.enrollments'),  value: courses.reduce((s, c) => s + count(c.course_enrollments), 0), icon: GraduationCap, color: 'text-amber-400',   bg: 'bg-amber-600/20' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">{t('courses.title')}</h2>
        <p className="text-slate-400 mt-1">{t('courses.subtitle')}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(s => (
          <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className={`w-10 h-10 rounded-lg ${s.bg} flex items-center justify-center mb-3`}>
              <s.icon className={`w-5 h-5 ${s.color}`} />
            </div>
            <p className="text-2xl font-bold text-white">{s.value}</p>
            <p className="text-slate-400 text-sm mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {courses.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <BookOpen className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">{t('courses.empty')}</p>
          <p className="text-slate-500 text-sm mt-1">
            {t('courses.emptyHint')}
          </p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">{t('courses.thCourse')}</th>
                <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden md:table-cell">{t('common.teacher')}</th>
                <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden lg:table-cell">{t('courses.thStructure')}</th>
                <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">{t('courses.thStudents')}</th>
                <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">{t('common.status')}</th>
                <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden xl:table-cell">{t('common.createdAt')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {courses.map(course => (
                <tr key={course.id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-violet-600/20 flex items-center justify-center shrink-0">
                        <BookOpen className="w-4 h-4 text-violet-400" />
                      </div>
                      <div>
                        <p className="text-white text-sm font-medium">{course.title}</p>
                        {course.description && (
                          <p className="text-slate-500 text-xs mt-0.5 line-clamp-1">{course.description}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 hidden md:table-cell text-slate-300 text-sm">{course.teacher?.full_name ?? '—'}</td>
                  <td className="px-5 py-4 hidden lg:table-cell text-slate-300 text-sm">
                    {course.has_levels ? t('courses.levels', { count: count(course.course_levels) }) : ''}{t('courses.units', { count: count(course.course_units) })}
                  </td>
                  <td className="px-5 py-4 text-slate-300 text-sm">{count(course.course_enrollments)}</td>
                  <td className="px-5 py-4">
                    {course.is_published ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-400 text-xs font-medium">
                        <Eye className="w-3.5 h-3.5" />{t('common.published')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-slate-500 text-xs font-medium">
                        <EyeOff className="w-3.5 h-3.5" />{t('common.draft')}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 hidden xl:table-cell text-slate-500 text-sm">{formatDate(course.created_at, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
