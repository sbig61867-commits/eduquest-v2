'use client'
import { confirmDialog } from '@/lib/confirm-dialog'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { UserPlus, Search, Trash2, ToggleLeft, Mail, GraduationCap } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import type { User } from '@/types'
import { useAuthStore } from '@/stores/auth-store'
import { getTerms } from '@/lib/terminology'

interface Props {
  initialStudents: User[]
  /** Holds `announce_to_university`: may move a student between the two populations. */
  canSetAffiliation?: boolean
  /** Without a centre there is no university/centre split to show. */
  hasCenter?: boolean
}

export function StudentsClient({ initialStudents, canSetAffiliation = false, hasCenter = true }: Props) {
  const terms = getTerms(useAuthStore(s => s.tenant?.institution_type))
  const [students, setStudents] = useState(initialStudents)
  const [search, setSearch] = useState('')
  const router = useRouter()

  const filtered = students.filter(s =>
    s.full_name.toLowerCase().includes(search.toLowerCase()) ||
    s.email.toLowerCase().includes(search.toLowerCase())
  )

  async function toggleStatus(student: User) {
    const res = await fetch('/api/admin/toggle-user', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: student.id, isActive: !student.is_active }),
    })
    if (res.ok) { setStudents(prev => prev.map(s => s.id === student.id ? { ...s, is_active: !s.is_active } : s)); router.refresh() }
  }

  // University student vs centre-only trainee — decides which announcements
  // reach them (see src/lib/student-affiliation.ts).
  async function toggleAffiliation(student: User) {
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
    if (!(await confirmDialog('Remove this student?'))) return
    const res = await fetch(`/api/admin/delete-user?id=${id}`, { method: 'DELETE' })
    if (res.ok) { setStudents(prev => prev.filter(s => s.id !== id)); router.refresh() }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">الطلاب</h2>
          <p className="text-slate-400 mt-1">{students.length} total students</p>
        </div>
        <Button onClick={() => router.push('/admin/invitations')}>
          <UserPlus className="w-4 h-4" /> دعوة طالب
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ابحث عن طالب…" className="w-full ps-10 pe-4 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">الاسم</th>
              <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden md:table-cell">البريد الإلكتروني</th>
              <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden lg:table-cell">تاريخ الانضمام</th>
              <th className="text-start text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">الحالة</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filtered.length === 0 && <tr><td colSpan={5} className="text-center text-slate-500 py-10">لم يُعثر على طلاب</td></tr>}
            {filtered.map(student => (
              <tr key={student.id} className="hover:bg-slate-800/50 transition-colors">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-white text-sm font-bold shrink-0">{student.full_name[0].toUpperCase()}</div>
                    <span className="text-white text-sm font-medium">{student.full_name}</span>
                  </div>
                </td>
                <td className="px-5 py-4 hidden md:table-cell"><span className="text-slate-400 text-sm flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />{student.email}</span></td>
                <td className="px-5 py-4 hidden lg:table-cell"><span className="text-slate-400 text-sm">{formatDate(student.created_at)}</span></td>
                <td className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={student.is_active ? 'green' : 'red'}>{student.is_active ? 'نشط' : 'معطّل'}</Badge>
                    {hasCenter && (
                      <Badge variant={student.is_university_student === false ? 'gray' : 'blue'}>
                        {student.is_university_student === false ? 'Centre trainee' : terms.institution}
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
                        title={student.is_university_student === false ? `Mark as ${terms.institutionStudent.toLowerCase()}` : 'Mark as centre-only trainee'}
                        onClick={() => toggleAffiliation(student)}
                      ><GraduationCap className="w-4 h-4" /></Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => toggleStatus(student)}><ToggleLeft className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteStudent(student.id)} className="hover:text-red-400 hover:bg-red-500/10"><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
