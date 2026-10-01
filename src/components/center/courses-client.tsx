'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/lib/confirm-dialog'
import { Plus, Eye, EyeOff, Trash2, GraduationCap } from 'lucide-react'
import { RosterModal } from './roster-modal'
import { TeacherPicker, type PickedTeacher } from './teacher-picker'

export interface CenterCourseRow {
  id: string
  title: string
  description: string | null
  is_published: boolean
  teacher_id: string
  /** Active teacher's name; null ⇒ «—» (disabled / not visible), as before. */
  teacher_name: string | null
  units: number
  enrollments: number
}

export function CenterCoursesClient({ initialCourses, hasTeachers }: {
  initialCourses: CenterCourseRow[]
  /** At least one active teacher exists (a count — the teachers are searched on demand). */
  hasTeachers: boolean
}) {
  const t = useTranslations('staff.courses')
  const tp = useTranslations('staff.teacherPicker')
  const router = useRouter()
  const [courses, setCourses] = useState(initialCourses)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ title: '', description: '', language: '', has_levels: false, teacher_id: '' })
  const [chosenTeacher, setChosenTeacher] = useState<PickedTeacher | null>(null)
  const [changingTeacher, setChangingTeacher] = useState<CenterCourseRow | null>(null)
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
    if (!res.ok) { toast.error(data.error ?? t('updateFailed')); return false }
    router.refresh()
    return true
  }

  async function create() {
    if (!form.title.trim()) return toast.error(t('titleRequired'))
    if (!form.teacher_id) return toast.error(t('teacherRequired'))
    setBusy('create')
    const res = await fetch('/api/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json().catch(() => ({}))
    setBusy('')
    if (!res.ok) return toast.error(data.error ?? t('createFailed'))
    setCourses(prev => [{
      id: data.id, title: data.title, description: data.description, is_published: !!data.is_published,
      teacher_id: data.teacher_id,
      teacher_name: chosenTeacher && chosenTeacher.id === data.teacher_id ? (chosenTeacher.full_name || null) : null,
      units: 0, enrollments: 0,
    }, ...prev])
    setCreating(false)
    setForm({ title: '', description: '', language: '', has_levels: false, teacher_id: '' })
    setChosenTeacher(null)
    toast.success(t('created'))
    router.refresh()
  }

  async function togglePublish(c: CenterCourseRow) {
    if (await send('PATCH', c.id, { is_published: !c.is_published })) {
      setCourses(prev => prev.map(x => (x.id === c.id ? { ...x, is_published: !x.is_published } : x)))
    }
  }

  // «تغيير المعلم»: the same PATCH /api/courses { id, teacher_id } the old per-row
  // select sent. Picking the current teacher changes nothing (as before).
  async function reassign(c: CenterCourseRow, teacher: PickedTeacher) {
    if (teacher.id === c.teacher_id) { setChangingTeacher(null); return }
    if (await send('PATCH', c.id, { teacher_id: teacher.id })) {
      setCourses(prev => prev.map(x => (x.id === c.id ? { ...x, teacher_id: teacher.id, teacher_name: teacher.full_name || null } : x)))
      setChangingTeacher(null)
    }
  }

  async function remove(c: CenterCourseRow) {
    if (!(await confirmDialog(t('deleteConfirm', { title: c.title })))) return
    if (await send('DELETE', c.id)) {
      setCourses(prev => prev.filter(x => x.id !== c.id))
      toast.success(t('deleted'))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-white">{t('title')}</h2>
          <p className="text-slate-400 mt-1">{t('summary', { count: courses.length, published: courses.filter(c => c.is_published).length })}</p>
        </div>
        <Button onClick={() => setCreating(true)} disabled={!hasTeachers}>
          <Plus className="w-4 h-4" /> {t('newCourse')}
        </Button>
      </div>
      {!hasTeachers && (
        <p className="text-amber-400 text-sm">{t('needTeacher')}</p>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full min-w-[680px]">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-start text-xs font-medium text-slate-400 px-5 py-3">{t('thCourse')}</th>
              <th className="text-start text-xs font-medium text-slate-400 px-5 py-3">{t('thTeacher')}</th>
              <th className="text-start text-xs font-medium text-slate-400 px-5 py-3">{t('thUnits')}</th>
              <th className="text-start text-xs font-medium text-slate-400 px-5 py-3">{t('thEnrollments')}</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {courses.length === 0 && (
              <tr><td colSpan={5} className="text-center text-slate-500 py-10">{t('empty')}</td></tr>
            )}
            {courses.map(c => (
              <tr key={c.id} className="hover:bg-slate-800/50">
                <td className="px-5 py-4">
                  <p className="text-white text-sm font-medium">{c.title}</p>
                  <p className={`text-xs mt-0.5 ${c.is_published ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {c.is_published ? t('published') : t('draft')}
                  </p>
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-1.5">
                    <span className="text-white text-sm truncate max-w-[160px]">{c.teacher_name ?? '—'}</span>
                    <Button variant="ghost" size="sm" disabled={busy === c.id} onClick={() => setChangingTeacher(c)}>
                      {tp('change')}
                    </Button>
                  </div>
                </td>
                <td className="px-5 py-4 text-slate-300 text-sm">{c.units}</td>
                <td className="px-5 py-4 text-slate-300 text-sm">{c.enrollments}</td>
                <td className="px-5 py-4">
                  <div className="flex gap-1 justify-end flex-wrap">
                    <Button variant="ghost" size="sm" onClick={() => setRoster(c)}>
                      <GraduationCap className="w-3.5 h-3.5" /> {t('enrollments')}
                    </Button>
                    <Button variant="ghost" size="sm" loading={busy === c.id} onClick={() => togglePublish(c)}>
                      {c.is_published ? <><EyeOff className="w-3.5 h-3.5" /> {t('unpublish')}</> : <><Eye className="w-3.5 h-3.5" /> {t('publish')}</>}
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

      <Modal open={creating} onClose={() => setCreating(false)} title={t('createTitle')}>
        <div className="space-y-4">
          <Input label={t('courseTitle')} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          <Input label={t('description')} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <Input label={t('language')} value={form.language} onChange={e => setForm(f => ({ ...f, language: e.target.value }))} />
          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-slate-300">{t('teacher')}</span>
            <p className={`text-sm ${chosenTeacher ? 'text-white' : 'text-slate-500'}`}>
              {chosenTeacher ? tp('chosen', { name: chosenTeacher.full_name || '—' }) : t('pickTeacher')}
            </p>
            <TeacherPicker
              scope="courses"
              selectedId={form.teacher_id || null}
              onPick={teacher => { setChosenTeacher(teacher); setForm(f => ({ ...f, teacher_id: teacher.id })) }}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.has_levels}
              onChange={e => setForm(f => ({ ...f, has_levels: e.target.checked }))} />
            {t('hasLevels')}
          </label>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setCreating(false)}>{t('cancel')}</Button>
            <Button loading={busy === 'create'} onClick={create}>{t('create')}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!changingTeacher} onClose={() => setChangingTeacher(null)} title={tp('changeTitle', { name: changingTeacher?.title ?? '' })}>
        {changingTeacher && (
          <TeacherPicker
            key={changingTeacher.id}
            scope="courses"
            selectedId={changingTeacher.teacher_id}
            onPick={teacher => reassign(changingTeacher, teacher)}
          />
        )}
      </Modal>

      <RosterModal
        key={roster?.id ?? 'none'}
        open={!!roster}
        onClose={() => setRoster(null)}
        title={t('rosterTitle', { title: roster?.title ?? '' })}
        endpoint="/api/course-enrollments"
        idKey="course_id"
        targetId={roster?.id ?? null}
        onChanged={count => roster && setCourses(prev => prev.map(c => (c.id === roster.id ? { ...c, enrollments: count } : c)))}
      />
    </div>
  )
}
