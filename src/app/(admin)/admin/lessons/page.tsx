export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { getTranslations, getLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/config'
import { redirect } from 'next/navigation'
import { BookOpen, Eye, EyeOff, Users } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { ListPagination } from '@/components/shared/list-pagination'
import { loadAdminContentCounts, loadAdminLessonsPage } from '@/lib/data/admin-content'

// Institution-wide lesson browser for university_admin. The admin is a
// pure administrator: RLS no longer grants them direct row access to
// lessons (that would expose lessons.content). Instead we read the
// get_admin_lessons_page() SECURITY DEFINER feed, which returns metadata only
// (title / teacher / group / status / date) — never the lesson body — one
// page at a time, with the totals from get_admin_content_counts().
export default async function AdminLessonsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const t = await getTranslations('admin.content')
  const locale = (await getLocale()) as Locale
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user?.tenant_id) redirect('/login')

  const { counts } = await loadAdminContentCounts(supabase)
  const { data: lessonPage, error } = await loadAdminLessonsPage(supabase, (await searchParams).page, counts.lessons)
  if (error) console.error('[admin/lessons]', error)
  const lessons = lessonPage.rows

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">{t('lessons.title')}</h2>
        <p className="text-slate-400 mt-1">
          {t('lessons.summary', { count: counts.lessons, published: counts.publishedLessons })}
        </p>
      </div>

      {lessons.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <BookOpen className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">{t('lessons.empty')}</p>
          <p className="text-slate-500 text-sm mt-1">{t('lessons.emptyHint')}</p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">{t('lessons.thLesson')}</th>
                <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden md:table-cell">{t('common.teacher')}</th>
                <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden lg:table-cell">{t('common.group')}</th>
                <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">{t('common.status')}</th>
                <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden xl:table-cell">{t('common.createdAt')}</th>
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
                  <td className="px-5 py-4 hidden md:table-cell text-slate-300 text-sm">{lesson.teacher_name ?? '—'}</td>
                  <td className="px-5 py-4 hidden lg:table-cell">
                    <span className="text-slate-300 text-sm flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-slate-500" />{lesson.group_name ?? '—'}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    {lesson.is_published ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-400 text-xs font-medium">
                        <Eye className="w-3.5 h-3.5" />{t('common.published')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-slate-500 text-xs font-medium">
                        <EyeOff className="w-3.5 h-3.5" />{t('common.draft')}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 hidden xl:table-cell text-slate-500 text-sm">{formatDate(lesson.created_at, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {lessonPage.pageCount > 1 && <ListPagination page={lessonPage.page} pageCount={lessonPage.pageCount} />}
    </div>
  )
}
