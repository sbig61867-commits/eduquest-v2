'use client'
import { confirmDialog } from '@/lib/confirm-dialog'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Mail, Search, Trash2, ToggleLeft, UserPlus, BookOpen } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import type { User } from '@/types'

interface Props { initialTeachers: User[] }

export function TeachersClient({ initialTeachers }: Props) {
  const [teachers, setTeachers] = useState(initialTeachers)
  const [search, setSearch] = useState('')
  const supabase = createClient()
  const router = useRouter()

  const filtered = teachers.filter(t =>
    t.full_name.toLowerCase().includes(search.toLowerCase()) ||
    t.email.toLowerCase().includes(search.toLowerCase())
  )

  async function toggleStatus(teacher: User) {
    const { error } = await supabase
      .from('users')
      .update({ is_active: !teacher.is_active })
      .eq('id', teacher.id)
    if (!error) {
      setTeachers(prev => prev.map(t => t.id === teacher.id ? { ...t, is_active: !t.is_active } : t))
      router.refresh()
    }
  }

  async function toggleCoursePermission(teacher: User) {
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
    if (!(await confirmDialog('Are you sure? This will remove the teacher and all their data.'))) return
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
          <h2 className="text-2xl font-bold text-white">المعلمون</h2>
          <p className="text-slate-400 mt-1">{teachers.length} total teachers</p>
        </div>
        <Button onClick={() => router.push('/admin/invitations')}>
          <UserPlus className="w-4 h-4" /> دعوة معلم
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="ابحث عن معلم…"
          className="w-full ps-10 pe-4 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        />
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">الاسم</th>
              <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden md:table-cell">البريد الإلكتروني</th>
              <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden lg:table-cell">تاريخ الانضمام</th>
              <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">الحالة</th>
              <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden xl:table-cell">المساقات</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center text-slate-500 py-10">لم يُعثر على معلمين</td></tr>
            )}
            {filtered.map(teacher => (
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
                  <span className="text-slate-400 text-sm">{formatDate(teacher.created_at)}</span>
                </td>
                <td className="px-5 py-4">
                  <Badge variant={teacher.is_active ? 'green' : 'red'}>
                    {teacher.is_active ? 'نشط' : 'معطّل'}
                  </Badge>
                </td>
                <td className="px-5 py-4 hidden xl:table-cell">
                  <button
                    onClick={() => toggleCoursePermission(teacher)}
                    title={teacher.can_create_courses ? 'Revoke course creation' : 'Allow course creation'}
                    className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                      teacher.can_create_courses
                        ? 'bg-violet-500/10 border-violet-500/30 text-violet-400 hover:bg-violet-500/20'
                        : 'bg-slate-800 border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-400'
                    }`}
                  >
                    <BookOpen className="w-3 h-3" />
                    {teacher.can_create_courses ? 'مسموح' : 'غير مسموح'}
                  </button>
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-1 justify-end">
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
    </div>
  )
}
