'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/lib/confirm-dialog'
import { Plus, Users, Archive, ArchiveRestore, Settings2, BookOpen } from 'lucide-react'
import { RosterModal, type Option } from './roster-modal'

export interface CenterGroupRow {
  id: string
  name: string
  description: string | null
  is_active: boolean
  teacher_id: string
  student_count: number
  course_id: string | null
  image_url: string | null
  max_students: number | null
  instructions: string | null
}

interface SettingsForm { course_id: string; image_url: string; max_students: string; instructions: string }
const toSettings = (g?: CenterGroupRow): SettingsForm => ({
  course_id: g?.course_id ?? '', image_url: g?.image_url ?? '',
  max_students: g?.max_students ? String(g.max_students) : '', instructions: g?.instructions ?? '',
})

export function CenterGroupsClient({ initialGroups, teachers, students, courses = [] }: {
  initialGroups: CenterGroupRow[]
  teachers: Option[]
  students: Option[]
  courses?: Option[]
}) {
  const router = useRouter()
  const [groups, setGroups] = useState(initialGroups)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', teacher_id: '' })
  const [newSettings, setNewSettings] = useState<SettingsForm>(toSettings())
  const [editing, setEditing] = useState<CenterGroupRow | null>(null)
  const [settings, setSettings] = useState<SettingsForm>(toSettings())
  const [transfer, setTransfer] = useState<{ group: CenterGroupRow; student: { id: string; full_name: string } } | null>(null)
  const [transferTo, setTransferTo] = useState('')
  const [transferReason, setTransferReason] = useState('')
  const courseName = (id: string | null) => courses.find(c => c.id === id)?.name
  const [busy, setBusy] = useState('')
  const [roster, setRoster] = useState<CenterGroupRow | null>(null)

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id)
    const res = await fetch('/api/groups', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...body }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy('')
    if (!res.ok) { toast.error(data.error ?? 'تعذّر التحديث'); return false }
    setGroups(prev => prev.map(g => (g.id === id ? { ...g, ...body } as CenterGroupRow : g)))
    router.refresh()
    return true
  }

  async function create() {
    if (!form.name.trim()) return toast.error('اسم المجموعة مطلوب')
    if (!form.teacher_id) return toast.error('اختر مدرب المجموعة')
    setBusy('create')
    const res = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, ...settingsBody(newSettings) }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy('')
    if (!res.ok) return toast.error(data.error ?? 'تعذّر إنشاء المجموعة')
    setGroups(prev => [{
      id: data.id, name: data.name, description: data.description, is_active: data.is_active ?? true,
      teacher_id: data.teacher_id, student_count: 0,
      course_id: data.course_id ?? null, image_url: data.image_url ?? null,
      max_students: data.max_students ?? null, instructions: data.instructions ?? null,
    }, ...prev])
    setCreating(false)
    setForm({ name: '', description: '', teacher_id: '' })
    setNewSettings(toSettings())
    toast.success('تم إنشاء المجموعة')
    router.refresh()
  }

  function settingsBody(s: SettingsForm) {
    return {
      course_id: s.course_id || null,
      image_url: s.image_url.trim() || null,
      max_students: s.max_students ? Number(s.max_students) : null,
      instructions: s.instructions.trim() || null,
    }
  }

  async function saveSettings() {
    if (!editing) return
    const ok = await patch(editing.id, settingsBody(settings))
    if (ok) { setEditing(null); toast.success('تم حفظ إعدادات المجموعة') }
  }

  async function doTransfer() {
    if (!transfer) return
    if (!transferTo) return toast.error('اختر المجموعة الجديدة')
    if (transferReason.trim().length < 3) return toast.error('اكتب سبب النقل')
    setBusy('transfer')
    const res = await fetch('/api/group-transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: transfer.student.id, from_group_id: transfer.group.id,
        to_group_id: transferTo, reason: transferReason.trim(),
      }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy('')
    if (!res.ok) return toast.error(data.error ?? 'تعذّر نقل الطالب')
    setGroups(prev => prev.map(g =>
      g.id === transfer.group.id ? { ...g, student_count: Math.max(0, g.student_count - 1) }
        : g.id === transferTo ? { ...g, student_count: g.student_count + 1 } : g))
    toast.success(`تم نقل ${transfer.student.full_name}`)
    setTransfer(null); setRoster(null); setTransferTo(''); setTransferReason('')
    router.refresh()
  }

  async function toggleArchive(g: CenterGroupRow) {
    if (g.is_active && !(await confirmDialog(`أرشفة "${g.name}"؟ تبقى كل السجلات محفوظة.`))) return
    await patch(g.id, { is_active: !g.is_active })
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-white">المجموعات</h2>
          <p className="text-slate-400 mt-1">{groups.filter(g => g.is_active).length} نشطة · {groups.filter(g => !g.is_active).length} مؤرشفة</p>
        </div>
        <Button onClick={() => setCreating(true)} disabled={teachers.length === 0}>
          <Plus className="w-4 h-4" /> مجموعة جديدة
        </Button>
      </div>
      {teachers.length === 0 && (
        <p className="text-amber-400 text-sm">أضف مدرباً نشطاً أولاً — كل مجموعة تحتاج مدرباً مسؤولاً.</p>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-start text-xs font-medium text-slate-400 px-5 py-3">المجموعة</th>
              <th className="text-start text-xs font-medium text-slate-400 px-5 py-3">المدرب</th>
              <th className="text-start text-xs font-medium text-slate-400 px-5 py-3">الطلاب</th>
              <th className="text-start text-xs font-medium text-slate-400 px-5 py-3">الحالة</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {groups.length === 0 && (
              <tr><td colSpan={5} className="text-center text-slate-500 py-10">لا توجد مجموعات بعد</td></tr>
            )}
            {groups.map(g => (
              <tr key={g.id} className={`hover:bg-slate-800/50 ${g.is_active ? '' : 'opacity-60'}`}>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    {g.image_url
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={g.image_url} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                      : <div className="w-10 h-10 rounded-lg bg-slate-800 shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-white text-sm font-medium">{g.name}</p>
                      {g.course_id && (
                        <p className="text-violet-400 text-xs flex items-center gap-1"><BookOpen className="w-3 h-3" /> {courseName(g.course_id) ?? 'كورس'}</p>
                      )}
                      {g.description && <p className="text-slate-500 text-xs truncate max-w-[220px]">{g.description}</p>}
                    </div>
                  </div>
                </td>
                <td className="px-5 py-4">
                  <select
                    value={g.teacher_id}
                    disabled={busy === g.id}
                    onChange={e => patch(g.id, { teacher_id: e.target.value })}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-sm max-w-[180px]"
                  >
                    {!teachers.some(t => t.id === g.teacher_id) && <option value={g.teacher_id}>—</option>}
                    {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </td>
                <td className="px-5 py-4 text-slate-300 text-sm">{g.student_count}{g.max_students ? ` / ${g.max_students}` : ''}</td>
                <td className="px-5 py-4">
                  <Badge variant={g.is_active ? 'green' : 'yellow'}>{g.is_active ? 'نشطة' : 'مؤرشفة'}</Badge>
                </td>
                <td className="px-5 py-4">
                  <div className="flex gap-1 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => { setEditing(g); setSettings(toSettings(g)) }}>
                      <Settings2 className="w-3.5 h-3.5" /> الإعدادات
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setRoster(g)}>
                      <Users className="w-3.5 h-3.5" /> الطلاب
                    </Button>
                    <Button variant="ghost" size="sm" loading={busy === g.id} onClick={() => toggleArchive(g)}>
                      {g.is_active ? <><Archive className="w-3.5 h-3.5" /> أرشفة</> : <><ArchiveRestore className="w-3.5 h-3.5" /> استرجاع</>}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="مجموعة جديدة">
        <div className="space-y-4" dir="rtl">
          <Input label="اسم المجموعة" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <Input label="الوصف (اختياري)" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
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
          <GroupSettingsFields value={newSettings} onChange={setNewSettings} courses={courses} />
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
        title={`طلاب ${roster?.name ?? ''}`}
        endpoint="/api/group-students"
        idKey="group_id"
        targetId={roster?.id ?? null}
        students={students}
        onChanged={count => roster && setGroups(prev => prev.map(g => (g.id === roster.id ? { ...g, student_count: count } : g)))}
        onTransfer={member => roster && setTransfer({ group: roster, student: member })}
      />

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`إعدادات ${editing?.name ?? ''}`}>
        <div className="space-y-4" dir="rtl">
          <GroupSettingsFields value={settings} onChange={setSettings} courses={courses} />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setEditing(null)}>إلغاء</Button>
            <Button loading={busy === editing?.id} onClick={saveSettings}>حفظ</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!transfer} onClose={() => setTransfer(null)} title={`نقل ${transfer?.student.full_name ?? ''}`}>
        <div className="space-y-4" dir="rtl">
          <p className="text-slate-400 text-sm">
            من: <span className="text-white">{transfer?.group.name}</span>
            {transfer?.group.course_id && <> ({courseName(transfer.group.course_id)})</>}
          </p>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-300">إلى المجموعة</span>
            <select
              value={transferTo}
              onChange={e => setTransferTo(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm"
            >
              <option value="">اختر مجموعة</option>
              {groups.filter(g => g.is_active && g.id !== transfer?.group.id).map(g => (
                <option key={g.id} value={g.id}>
                  {g.name}{g.course_id ? ` — ${courseName(g.course_id) ?? ''}` : ''}{g.max_students ? ` (${g.student_count}/${g.max_students})` : ''}
                </option>
              ))}
            </select>
          </label>
          {(() => {
            const target = groups.find(g => g.id === transferTo)
            if (!transfer || !target || !transfer.group.course_id || target.course_id === transfer.group.course_id) return null
            return (
              <p className="text-amber-400 text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                المجموعة الجديدة تتبع كورساً آخر: يُجمَّد تقدم الطالب في «{courseName(transfer.group.course_id)}» كما هو الآن
                ويبقى ظاهراً له للاطلاع فقط، ويبدأ تقدمه في الكورس الجديد منفصلاً.
              </p>
            )
          })()}
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-300">سبب النقل</span>
            <textarea
              value={transferReason}
              onChange={e => setTransferReason(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="مثال: بناءً على طلب الطالب / نتيجة اختبار تحديد المستوى"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm"
            />
          </label>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setTransfer(null)}>إلغاء</Button>
            <Button loading={busy === 'transfer'} onClick={doTransfer}>نقل الطالب</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function GroupSettingsFields({ value, onChange, courses }: {
  value: SettingsForm
  onChange: (v: SettingsForm) => void
  courses: Option[]
}) {
  const set = (k: keyof SettingsForm) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value })
  return (
    <div className="space-y-4">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-slate-300">الكورس التابعة له (اختياري)</span>
        <select value={value.course_id} onChange={set('course_id')}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm">
          <option value="">بدون كورس</option>
          {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="block text-slate-500 text-xs">إضافة طالب لمجموعة مرتبطة بكورس تسجّله في الكورس تلقائياً.</span>
      </label>
      <Input label="رابط صورة المجموعة (اختياري)" dir="ltr" placeholder="https://…" value={value.image_url} onChange={set('image_url')} />
      <Input label="الحد الأقصى للطلاب (اختياري)" type="number" min={1} value={value.max_students} onChange={set('max_students')} />
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-slate-300">تعليمات المجموعة (اختياري)</span>
        <textarea value={value.instructions} onChange={set('instructions')} maxLength={2000} rows={3}
          placeholder="تظهر للطالب مع الكورس: مواعيد الحضور، قواعد المجموعة…"
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm" />
      </label>
    </div>
  )
}
