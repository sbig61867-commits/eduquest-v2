'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/lib/confirm-dialog'
import { Plus, Eye, EyeOff, Trash2, GraduationCap } from 'lucide-react'
import { RosterModal, type Option } from './roster-modal'

export interface CenterCourseRow {
  id: string
  title: string
  description: string | null
  is_published: boolean
  teacher_id: string
  units: number
  enrollments: number
}

export function CenterCoursesClient({ initialCourses, teachers, students }: {
  initialCourses: CenterCourseRow[]
  teachers: Option[]
  students: Option[]
}) {
  const router = useRouter()
  const [courses, setCourses] = useState(initialCourses)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ title: '', description: '', language: '', has_levels: false, teacher_id: '' })
  const [busy, setBusy] = useState('')
  const [roster, setRoster] = useState<CenterCourseRow | null>(null)

  async function send(method: 'PATCH' | 'DELETE', id: string, body: Record<string, unknown> = {}) {
    setBusy(id)
    const res = await fetch('/api/courses', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...body }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy('')
    if (!res.ok) { toast.error(data.error ?? 'تعذّر التحديث'); return false }
    router.refresh()
    return true
  }

  async function create() {
    if (!form.title.trim()) return toast.error('عنوان الكورس مطلوب')
    if (!form.teacher_id) return toast.error('اختر المدرب المسؤول')
    setBusy('create')
    const res = await fetch('/api/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json().catch(() => ({}))
    setBusy('')
    if (!res.ok) return toast.error(data.error ?? 'تعذّر إنشاء الكورس')
    setCourses(prev => [{
      id: data.id, title: data.title, description: data.description, is_published: !!data.is_published,
      teacher_id: data.teacher_id, units: 0, enrollments: 0,
    }, ...prev])
    setCreating(false)
    setForm({ title: '', description: '', language: '', has_levels: false, teacher_id: '' })
    toast.success('تم إنشاء الكورس — يبني المدرب محتواه من لوحته')
    router.refresh()
  }

  async function togglePublish(c: CenterCourseRow) {
    if (await send('PATCH', c.id, { is_published: !c.is_published })) {
      setCourses(prev => prev.map(x => (x.id === c.id ? { ...x, is_published: !x.is_published } : x)))
    }
  }

  async function reassign(c: CenterCourseRow, teacherId: string) {
    if (await send('PATCH', c.id, { teacher_id: teacherId })) {
      setCourses(prev => prev.map(x => (x.id === c.id ? { ...x, teacher_id: teacherId } : x)))
    }
  }

  async function remove(c: CenterCourseRow) {
    if (!(await confirmDialog(`حذف الكورس "${c.title}" نهائياً مع محتواه وتسجيلاته؟`))) return
    if (await send('DELETE', c.id)) {
      setCourses(prev => prev.filter(x => x.id !== c.id))
      toast.success('تم الحذف')
    }
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-white">الكورسات</h2>
          <p className="text-slate-400 mt-1">{courses.length} كورس · {courses.filter(c => c.is_published).length} منشور</p>
        </div>
        <Button onClick={() => setCreating(true)} disabled={teachers.length === 0}>
          <Plus className="w-4 h-4" /> كورس جديد
        </Button>
      </div>
      {teachers.length === 0 && (
        <p className="text-amber-400 text-sm">أضف مدرباً نشطاً أولاً — الكورس يُسند لمدرب يبني محتواه.</p>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full min-w-[680px]">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-start text-xs font-medium text-slate-400 px-5 py-3">الكورس</th>
              <th className="text-start text-xs font-medium text-slate-400 px-5 py-3">المدرب</th>
              <th className="text-start text-xs font-medium text-slate-400 px-5 py-3">الوحدات</th>
              <th className="text-start text-xs font-medium text-slate-400 px-5 py-3">المسجّلون</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {courses.length === 0 && (
              <tr><td colSpan={5} className="text-center text-slate-500 py-10">لا توجد كورسات بعد</td></tr>
            )}
            {courses.map(c => (
              <tr key={c.id} className="hover:bg-slate-800/50">
                <td className="px-5 py-4">
                  <p className="text-white text-sm font-medium">{c.title}</p>
                  <p className={`text-xs mt-0.5 ${c.is_published ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {c.is_published ? 'منشور' : 'مسودة'}
                  </p>
                </td>
                <td className="px-5 py-4">
                  <select
                    value={c.teacher_id}
                    disabled={busy === c.id}
                    onChange={e => reassign(c, e.target.value)}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-sm max-w-[180px]"
                  >
                    {!teachers.some(t => t.id === c.teacher_id) && <option value={c.teacher_id}>—</option>}
                    {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </td>
                <td className="px-5 py-4 text-slate-300 text-sm">{c.units}</td>
                <td className="px-5 py-4 text-slate-300 text-sm">{c.enrollments}</td>
                <td className="px-5 py-4">
                  <div className="flex gap-1 justify-end flex-wrap">
                    <Button variant="ghost" size="sm" onClick={() => setRoster(c)}>
                      <GraduationCap className="w-3.5 h-3.5" /> التسجيل
                    </Button>
                    <Button variant="ghost" size="sm" loading={busy === c.id} onClick={() => togglePublish(c)}>
                      {c.is_published ? <><EyeOff className="w-3.5 h-3.5" /> إخفاء</> : <><Eye className="w-3.5 h-3.5" /> نشر</>}
                    </Button>
                    <Button variant="ghost" size="sm" loading={busy === c.id} onClick={() => remove(c)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="كورس جديد">
        <div className="space-y-4" dir="rtl">
          <Input label="عنوان الكورس" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          <Input label="الوصف (اختياري)" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <Input label="اللغة (اختياري)" value={form.language} onChange={e => setForm(f => ({ ...f, language: e.target.value }))} />
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-300">المدرب المسؤول</span>
            <select
              value={form.teacher_id}
              onChange={e => setForm(f => ({ ...f, teacher_id: e.target.value }))}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm"
            >
              <option value="">اختر مدرباً</option>
              {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.has_levels}
              onChange={e => setForm(f => ({ ...f, has_levels: e.target.checked }))} />
            الكورس مقسّم إلى مستويات
          </label>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setCreating(false)}>إلغاء</Button>
            <Button loading={busy === 'create'} onClick={create}>إنشاء</Button>
          </div>
        </div>
      </Modal>

      <RosterModal
        key={roster?.id ?? 'none'}
        open={!!roster}
        onClose={() => setRoster(null)}
        title={`التسجيل في ${roster?.title ?? ''}`}
        endpoint="/api/course-enrollments"
        idKey="course_id"
        targetId={roster?.id ?? null}
        students={students}
        onChanged={count => roster && setCourses(prev => prev.map(c => (c.id === roster.id ? { ...c, enrollments: count } : c)))}
      />
    </div>
  )
}
