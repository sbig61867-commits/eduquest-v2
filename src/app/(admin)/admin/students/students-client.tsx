'use client'
import { confirmDialog } from '@/lib/confirm-dialog'
import { useTranslations, useLocale } from 'next-intl'
import type { Locale } from '@/i18n/config'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ResetPasswordButton } from '@/components/shared/reset-password-button'
import { Badge } from '@/components/ui/badge'
import { UserPlus, Search, Trash2, ToggleLeft, Mail, GraduationCap, PenLine } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import type { User } from '@/types'
import { useAuthStore } from '@/stores/auth-store'
import { getTerms } from '@/lib/terminology'
import { StudentNameEditor, type NamedStudent } from '@/components/shared/student-name-editor'
import { ListPagination } from '@/components/shared/list-pagination'

// Only what this screen uses — satisfied by a people-page row (src/lib/data/people.ts).
type StudentRow = Pick<User, 'id' | 'email' | 'full_name' | 'is_active' | 'created_at'> & {
  is_university_student?: boolean | null
  name_complete?: boolean | null
}

interface Props {
  /** One page of students, already searched on the server (src/lib/data/people.ts). */
  initialStudents: StudentRow[]
  /** Students matching the search in the whole institution (from the database). */
  total?: number
  page?: number
  pageCount?: number
  /** The search the server applied (?q=). */
  search?: string
  /** Holds `announce_to_university`: may move a student between the two populations. */
  canSetAffiliation?: boolean
  /** Without a centre there is no university/centre split to show. */
  hasCenter?: boolean
}

// Typing waits this long before asking the server for the matching page.
const SEARCH_DELAY_MS = 350

export function StudentsClient({ initialStudents, total, page = 1, pageCount = 1, search = '', canSetAffiliation = false, hasCenter = true }: Props) {
  const t = useTranslations('admin.people')
  const tName = useTranslations('common.studentName')
  const locale = useLocale() as Locale
  const terms = getTerms(useAuthStore(s => s.tenant?.institution_type), locale)
  // Local copy for immediate feedback after an action; replaced whenever the
  // server sends a new page (navigation, search, router.refresh()).
  const [shown, setShown] = useState(initialStudents)
  const [students, setStudents] = useState(initialStudents)
  if (shown !== initialStudents) { setShown(initialStudents); setStudents(initialStudents) }
  const [query, setQuery] = useState(search)
  const [naming, setNaming] = useState<NamedStudent | null>(null)
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

  async function toggleStatus(student: StudentRow) {
    const res = await fetch('/api/admin/toggle-user', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: student.id, isActive: !student.is_active }),
    })
    if (res.ok) { setStudents(prev => prev.map(s => s.id === student.id ? { ...s, is_active: !s.is_active } : s)); router.refresh() }
  }

  // University student vs centre-only trainee — decides which announcements
  // reach them (see src/lib/student-affiliation.ts).
  async function toggleAffiliation(student: StudentRow) {
    const next = student.is_university_student === false
    const res = await fetch('/api/admin/student-affiliation', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: student.id, isUniversityStudent: next }),
    })
    if (res.ok) {
      setStudents(prev => prev.map(s => s.id === student.id ? { ...s, is_university_student: next } : s))
      router.refresh()
    }
  }

  async function deleteStudent(id: string) {
    if (!(await confirmDialog(t('students.deleteConfirm')))) return
    const res = await fetch(`/api/admin/delete-user?id=${id}`, { method: 'DELETE' })
    if (res.ok) { setStudents(prev => prev.filter(s => s.id !== id)); router.refresh() }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">{t('students.title')}</h2>
          <p className="text-slate-400 mt-1">{t('students.summary', { count: total ?? students.length })}</p>
        </div>
        <Button onClick={() => router.push('/admin/invitations')}>
          <UserPlus className="w-4 h-4" /> {t('students.invite')}
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('students.search')} className="w-full ps-10 pe-4 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">{t('common.name')}</th>
              <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden md:table-cell">{t('common.email')}</th>
              <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden lg:table-cell">{t('common.joined')}</th>
              <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">{t('common.status')}</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {students.length === 0 && <tr><td colSpan={5} className="text-center text-slate-500 py-10">{t('students.empty')}</td></tr>}
            {students.map(student => (
              <tr key={student.id} className="hover:bg-slate-800/50 transition-colors">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-white text-sm font-bold shrink-0">{student.full_name[0].toUpperCase()}</div>
                    <span className="text-white text-sm font-medium">{student.full_name}</span>
                    {student.name_complete === false && (
                      <span title={tName('notFourPartHint')}><Badge variant="yellow">{tName('notFourPart')}</Badge></span>
                    )}
                  </div>
                </td>
                <td className="px-5 py-4 hidden md:table-cell"><span className="text-slate-400 text-sm flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />{student.email}</span></td>
                <td className="px-5 py-4 hidden lg:table-cell"><span className="text-slate-400 text-sm">{formatDate(student.created_at, locale)}</span></td>
                <td className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={student.is_active ? 'green' : 'red'}>{student.is_active ? t('common.active') : t('common.disabled')}</Badge>
                    {hasCenter && (
                      <Badge variant={student.is_university_student === false ? 'gray' : 'blue'}>
                        {student.is_university_student === false ? t('students.centreTrainee') : terms.institution}
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-1 justify-end">
                    {canSetAffiliation && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title={student.is_university_student === false ? t('students.markInstitution', { label: terms.institutionStudent }) : t('students.markCentreOnly')}
                        onClick={() => toggleAffiliation(student)}
                      ><GraduationCap className="w-4 h-4" /></Button>
                    )}
                    <Button variant="ghost" size="sm" title={tName('correct')} aria-label={tName('correct')} onClick={() => setNaming(student)}><PenLine className="w-4 h-4" /></Button>
                    <ResetPasswordButton userId={student.id} name={student.full_name} />
                    <Button variant="ghost" size="sm" onClick={() => toggleStatus(student)}><ToggleLeft className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteStudent(student.id)} className="hover:text-red-400 hover:bg-red-500/10"><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && <ListPagination page={page} pageCount={pageCount} />}

      <StudentNameEditor
        student={naming}
        onClose={() => setNaming(null)}
        onSaved={(id, fullName, isComplete) => {
          setStudents(prev => prev.map(s => s.id === id ? { ...s, full_name: fullName, name_complete: isComplete } : s))
          router.refresh()
        }}
      />
    </div>
  )
}
