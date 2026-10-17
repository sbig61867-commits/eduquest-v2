'use client'
import { confirmDialog } from '@/lib/confirm-dialog'
import { useTranslations, useLocale } from 'next-intl'
import type { Locale } from '@/i18n/config'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ResetPasswordButton } from '@/components/shared/reset-password-button'
import { Badge } from '@/components/ui/badge'
import { Mail, Search, Trash2, ToggleLeft, UserPlus, BookOpen } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import type { User } from '@/types'
import { ListPagination } from '@/components/shared/list-pagination'

// Only what this screen uses — satisfied by a people-page row (src/lib/data/people.ts).
type TeacherRow = Pick<User, 'id' | 'email' | 'full_name' | 'is_active' | 'created_at'> & {
  can_create_courses?: boolean | null
}

interface Props {
  /** One page of teachers, already searched on the server (src/lib/data/people.ts). */
  initialTeachers: TeacherRow[]
  /** Teachers matching the search in the whole institution (from the database). */
  total?: number
  page?: number
  pageCount?: number
  /** The search the server applied (?q=). */
  search?: string
}

// Typing waits this long before asking the server for the matching page.
const SEARCH_DELAY_MS = 350

export function TeachersClient({ initialTeachers, total, page = 1, pageCount = 1, search = '' }: Props) {
  const t = useTranslations('admin.people')
  const locale = useLocale() as Locale
  // Local copy for immediate feedback after an action; replaced whenever the
  // server sends a new page (navigation, search, router.refresh()).
  const [shown, setShown] = useState(initialTeachers)
  const [teachers, setTeachers] = useState(initialTeachers)
  if (shown !== initialTeachers) { setShown(initialTeachers); setTeachers(initialTeachers) }
  const [query, setQuery] = useState(search)
  const router = useRouter()

  // Search runs in the database: the typed text goes to the URL (?q=) and the
  // server renders the first matching page. Nothing is filtered here.
  useEffect(() => {
    if (query.trim() === search) return
    const timer = setTimeout(() => {
      const q = query.trim()
      router.replace(q ? `?q=${encodeURIComponent(q)}` : '?')
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [query, search, router])

  // Through the route (capability + tenant checks, service-role write): the
  // users_update policy no longer lets an admin write other users' rows.
  async function toggleStatus(teacher: TeacherRow) {
    const res = await fetch('/api/admin/toggle-user', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: teacher.id, isActive: !teacher.is_active }),
    })
    if (res.ok) {
      setTeachers(prev => prev.map(t => t.id === teacher.id ? { ...t, is_active: !t.is_active } : t))
      router.refresh()
    }
  }

  async function toggleCoursePermission(teacher: TeacherRow) {
    const next = !teacher.can_create_courses
    const res = await fetch('/api/admin/teacher-permissions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacher_id: teacher.id, can_create_courses: next }),
    })
    if (res.ok) {
      setTeachers(prev => prev.map(t => t.id === teacher.id ? { ...t, can_create_courses: next } : t))
      router.refresh()
    }
  }

  async function deleteTeacher(id: string) {
    if (!(await confirmDialog(t('teachers.deleteConfirm')))) return
    const res = await fetch(`/api/admin/delete-user?id=${id}`, { method: 'DELETE' })
    if (res.ok) {
      setTeachers(prev => prev.filter(t => t.id !== id))
      router.refresh()
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">{t('teachers.title')}</h2>
          <p className="text-slate-400 mt-1">{t('teachers.summary', { count: total ?? teachers.length })}</p>
        </div>
        <Button onClick={() => router.push('/admin/invitations')}>
          <UserPlus className="w-4 h-4" /> {t('teachers.invite')}
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('teachers.search')}
          className="w-full ps-10 pe-4 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        />
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">{t('common.name')}</th>
              <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden md:table-cell">{t('common.email')}</th>
              <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden lg:table-cell">{t('common.joined')}</th>
              <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">{t('common.status')}</th>
              <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden xl:table-cell">{t('teachers.thCourses')}</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {teachers.length === 0 && (
              <tr><td colSpan={6} className="text-center text-slate-500 py-10">{t('teachers.empty')}</td></tr>
            )}
            {teachers.map(teacher => (
              <tr key={teacher.id} className="hover:bg-slate-800/50 transition-colors">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                      {teacher.full_name[0].toUpperCase()}
                    </div>
                    <span className="text-white text-sm font-medium">{teacher.full_name}</span>
                  </div>
                </td>
                <td className="px-5 py-4 hidden md:table-cell">
                  <span className="text-slate-400 text-sm flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5" />{teacher.email}
                  </span>
                </td>
                <td className="px-5 py-4 hidden lg:table-cell">
                  <span className="text-slate-400 text-sm">{formatDate(teacher.created_at, locale)}</span>
                </td>
                <td className="px-5 py-4">
                  <Badge variant={teacher.is_active ? 'green' : 'red'}>
                    {teacher.is_active ? t('common.active') : t('common.disabled')}
                  </Badge>
                </td>
                <td className="px-5 py-4 hidden xl:table-cell">
                  <button
                    onClick={() => toggleCoursePermission(teacher)}
                    title={teacher.can_create_courses ? t('teachers.revokeCourses') : t('teachers.grantCourses')}
                    className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                      teacher.can_create_courses
                        ? 'bg-violet-500/10 border-violet-500/30 text-violet-400 hover:bg-violet-500/20'
                        : 'bg-slate-800 border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-400'
                    }`}
                  >
                    <BookOpen className="w-3 h-3" />
                    {teacher.can_create_courses ? t('teachers.allowed') : t('teachers.notAllowed')}
                  </button>
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-1 justify-end">
                    <ResetPasswordButton userId={teacher.id} name={teacher.full_name} />
                    <Button variant="ghost" size="sm" onClick={() => toggleStatus(teacher)}>
                      <ToggleLeft className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteTeacher(teacher.id)} className="hover:text-red-400 hover:bg-red-500/10">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && <ListPagination page={page} pageCount={pageCount} />}
    </div>
  )
}
