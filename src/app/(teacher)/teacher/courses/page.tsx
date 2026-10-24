export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { redirect } from 'next/navigation'
import { CoursesClient } from './courses-client'
import { Lock, GraduationCap } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

export default async function CoursesPage() {
  const user = await currentUser()
  if (!user) redirect('/login')

  const t = await getTranslations('teacher')

  // The permission and the course list in one unit; the list is only shown
  // when the permission holds.
  const [profiles, courses] = await run({ as: 'user', userId: user.id }, sql => [
    sql`select can_create_courses, tenant_id from public.users where id = ${user.id}`,
    sql`select c.id, c.title, c.description, c.language, c.has_levels, c.is_published, c.created_at,
               json_build_array(json_build_object('count', (select count(*)::int from public.course_levels l where l.course_id = c.id))) as course_levels,
               json_build_array(json_build_object('count', (select count(*)::int from public.course_enrollments e where e.course_id = c.id))) as course_enrollments
          from public.courses c
         where c.teacher_id = ${user.id} and exists (select 1 from public.users u where u.id = ${user.id} and u.can_create_courses)
         order by c.created_at desc limit 500`,
  ])
  const profile = profiles[0] as { can_create_courses: boolean | null; tenant_id: string | null } | undefined

  if (!profile?.can_create_courses) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center mb-5">
          <Lock className="w-8 h-8 text-slate-500" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">{t('courses.noPermission')}</h2>
        <p className="text-slate-400 max-w-sm">
          {t('courses.requestPermission')}
        </p>
        <div className="mt-6 flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 border border-slate-800">
          <GraduationCap className="w-4 h-4 text-slate-500" />
          <span className="text-slate-500 text-sm">{t('courses.requestPermission')}</span>
        </div>
      </div>
    )
  }

  return (
    <CoursesClient
      initialCourses={courses as unknown as Parameters<typeof CoursesClient>[0]['initialCourses']}
      teacherId={user.id}
      tenantId={profile.tenant_id ?? ''}
    />
  )
}
