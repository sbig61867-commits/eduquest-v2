'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/lib/confirm-dialog'
import { CalendarDays, Plus, Trash2, Pencil, Eye, EyeOff, Users, User } from 'lucide-react'
import { DAY_LABELS, formatTime, slotsForDay, type ScheduleRow, type TargetOption } from './types'

// Staff timetable editor (university_admin / centre manager holding
// `manage_schedules`). Writes go to /api/schedules and
// /api/schedules/slots, then router.refresh() re-pulls the authoritative
// server state rather than trusting local mutations.

const EMPTY_SLOT = {
  id: '', day_of_week: 0, start_time: '08:00', end_time: '09:00',
  title: '', teacher_id: '', location: '', note: '',
}

export function SchedulesManager({
  schedules, targets,
}: { schedules: ScheduleRow[]; targets: TargetOption[] }) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState<string | null>(schedules[0]?.id ?? null)
  const [creating, setCreating] = useState(false)
  const [createForm, setCreateForm] = useState({ kind: 'group', target_id: '', title: '' })
  const [slotForm, setSlotForm] = useState({ ...EMPTY_SLOT })
  const [slotOpen, setSlotOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const selected = useMemo(
    () => schedules.find(s => s.id === selectedId) ?? null,
    [schedules, selectedId],
  )
  const teachers = useMemo(() => targets.filter(t => t.kind === 'teacher'), [targets])

  // A group/teacher may only have one timetable, so hide targets already used.
  const availableTargets = useMemo(() => {
    const taken = new Set(schedules.map(s => (s.kind === 'group' ? s.group_id : s.teacher_id)))
    return targets.filter(t => t.kind === createForm.kind && !taken.has(t.id))
  }, [targets, schedules, createForm.kind])

  async function send(url: string, method: string, payload: unknown): Promise<boolean> {
    setBusy(true)
    const res = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { toast.error(data.error ?? 'تعذّر تنفيذ العملية'); return false }
    return true
  }

  async function createSchedule() {
    if (!createForm.target_id) return toast.error('اختر المجموعة أو المعلم')
    if (!createForm.title.trim()) return toast.error('اكتب عنوان الجدول')
    setBusy(true)
    const res = await fetch('/api/schedules', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createForm),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return toast.error(data.error ?? 'تعذّر إنشاء الجدول')
    toast.success('تم إنشاء الجدول')
    setCreating(false)
    setCreateForm({ kind: 'group', target_id: '', title: '' })
    setSelectedId(data.id)
    router.refresh()
  }

  async function togglePublish() {
    if (!selected) return
    const next = !selected.is_published
    if (next && selected.slots.length === 0) {
      return toast.error('أضف مواعيد قبل نشر الجدول')
    }
    if (await send('/api/schedules', 'PATCH', { id: selected.id, is_published: next })) {
      toast.success(next ? 'تم نشر الجدول للطلاب' : 'تم إخفاء الجدول عن الطلاب')
      router.refresh()
    }
  }

  async function deleteSchedule() {
    if (!selected) return
    if (!(await confirmDialog(`حذف جدول "${selected.target_name ?? selected.title}"؟ ستُحذف كل مواعيده.`))) return
    if (await send('/api/schedules', 'DELETE', { id: selected.id })) {
      toast.success('تم حذف الجدول')
      setSelectedId(null)
      router.refresh()
    }
  }

  async function saveSlot() {
    if (!selected) return
    if (!slotForm.title.trim()) return toast.error('اكتب عنوان الموعد')
    const payload = {
      ...(slotForm.id ? { id: slotForm.id } : { schedule_id: selected.id }),
      day_of_week: slotForm.day_of_week,
      start_time: slotForm.start_time,
      end_time: slotForm.end_time,
      title: slotForm.title.trim(),
      teacher_id: slotForm.teacher_id || null,
      location: slotForm.location || null,
      note: slotForm.note || null,
    }
    const ok = await send('/api/schedules/slots', slotForm.id ? 'PATCH' : 'POST', payload)
    if (!ok) return
    toast.success(slotForm.id ? 'تم تحديث الموعد' : 'تمت إضافة الموعد')
    setSlotForm({ ...EMPTY_SLOT })
    setSlotOpen(false)
    router.refresh()
  }

  async function deleteSlot(id: string) {
    if (!(await confirmDialog('حذف هذا الموعد؟'))) return
    if (await send('/api/schedules/slots', 'DELETE', { id })) {
      toast.success('تم حذف الموعد')
      router.refresh()
    }
  }

  function editSlot(slotId: string) {
    const s = selected?.slots.find(x => x.id === slotId)
    if (!s) return
    setSlotForm({
      id: s.id,
      day_of_week: s.day_of_week,
      start_time: formatTime(s.start_time),
      end_time: formatTime(s.end_time),
      title: s.title,
      teacher_id: s.teacher_id ?? '',
      location: s.location ?? '',
      note: s.note ?? '',
    })
    setSlotOpen(true)
  }

  const field = 'w-full bg-surface border border-border-strong rounded-lg px-3 py-2 text-fg text-sm'

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-fg">جداول المواعيد الأسبوعية</h2>
          <p className="text-fg-secondary mt-1">
            {schedules.length} جدول · {schedules.filter(s => s.is_published).length} منشور
          </p>
        </div>
        <Button onClick={() => setCreating(v => !v)}><Plus className="w-4 h-4" /> جدول جديد</Button>
      </div>

      {creating && (
        <div className="bg-surface border border-border rounded-lg p-5 space-y-4">
          <h3 className="text-fg font-semibold">إنشاء جدول</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="text-sm text-fg-secondary space-y-1.5 block">
              <span>نوع الجدول</span>
              <select
                className={field}
                value={createForm.kind}
                onChange={e => setCreateForm(f => ({ ...f, kind: e.target.value, target_id: '' }))}
              >
                <option value="group">جدول رسمي لمجموعة (يراه الطلاب)</option>
                <option value="teacher">جدول خاص بمعلم (لا يراه الطلاب)</option>
              </select>
            </label>
            <label className="text-sm text-fg-secondary space-y-1.5 block">
              <span>{createForm.kind === 'group' ? 'المجموعة' : 'المعلم'}</span>
              <select
                className={field}
                value={createForm.target_id}
                onChange={e => setCreateForm(f => ({ ...f, target_id: e.target.value }))}
              >
                <option value="">— اختر —</option>
                {availableTargets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="text-sm text-fg-secondary space-y-1.5 block">
              <span>عنوان الجدول</span>
              <input
                className={field}
                value={createForm.title}
                onChange={e => setCreateForm(f => ({ ...f, title: e.target.value }))}
                placeholder="مثال: الفصل الأول 2026"
              />
            </label>
          </div>
          {availableTargets.length === 0 && (
            <p className="text-accent text-xs">
              كل {createForm.kind === 'group' ? 'المجموعات' : 'المعلمين'} لديها جدول بالفعل.
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setCreating(false)}>إلغاء</Button>
            <Button loading={busy} onClick={createSchedule}>إنشاء</Button>
          </div>
        </div>
      )}

      {schedules.length === 0 ? (
        <div className="text-center py-20 bg-surface border border-border rounded-lg">
          <CalendarDays className="w-12 h-12 text-fg-muted mx-auto mb-3" />
          <p className="text-fg-secondary">لا توجد جداول بعد.</p>
          <p className="text-fg-muted text-sm mt-1">أنشئ جدولاً لمجموعة ثم أضف مواعيده وانشره للطلاب.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Schedule list */}
          <div className="space-y-2 lg:col-span-1">
            {schedules.map(s => (
              <button
                key={s.id}
                onClick={() => { setSelectedId(s.id); setSlotOpen(false); setSlotForm({ ...EMPTY_SLOT }) }}
                className={`w-full text-right p-3 rounded-lg border transition-colors ${
                  selectedId === s.id ? 'bg-surface border-accent-border' : 'bg-surface border-border hover:bg-surface/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  {s.kind === 'group'
                    ? <Users className="w-3.5 h-3.5 text-accent shrink-0" />
                    : <User className="w-3.5 h-3.5 text-accent shrink-0" />}
                  <span className="text-fg text-sm font-medium truncate">{s.target_name ?? '—'}</span>
                </div>
                <p className="text-fg-muted text-xs mt-1 truncate">{s.title}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${
                    s.is_published ? 'text-accent bg-accent-subtle' : 'text-fg-secondary bg-surface'
                  }`}>
                    {s.is_published ? 'منشور' : 'مسودة'}
                  </span>
                  <span className="text-fg-muted text-[11px]">{s.slots.length} موعد</span>
                </div>
              </button>
            ))}
          </div>

          {/* Selected schedule */}
          <div className="lg:col-span-3">
            {selected ? (
              <div className="space-y-4">
                <div className="bg-surface border border-border rounded-lg p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <h3 className="text-fg font-semibold">{selected.target_name ?? '—'}</h3>
                      <p className="text-fg-muted text-xs mt-0.5">
                        {selected.title} · {selected.kind === 'group' ? 'جدول رسمي' : 'جدول خاص بالمعلم'}
                      </p>
                      {selected.kind === 'teacher' && (
                        <p className="text-accent/80 text-[11px] mt-1">
                          هذا الجدول لا يظهر للطلاب — مخصص لاختبارات المعلم غير الرسمية.
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => { setSlotForm({ ...EMPTY_SLOT }); setSlotOpen(true) }}>
                        <Plus className="w-3.5 h-3.5" /> موعد
                      </Button>
                      {selected.kind === 'group' && (
                        <Button size="sm" variant="ghost" loading={busy} onClick={togglePublish}>
                          {selected.is_published
                            ? <><EyeOff className="w-3.5 h-3.5" /> إخفاء</>
                            : <><Eye className="w-3.5 h-3.5" /> نشر</>}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" loading={busy} onClick={deleteSchedule}>
                        <Trash2 className="w-3.5 h-3.5" /> حذف
                      </Button>
                    </div>
                  </div>
                </div>

                {slotOpen && (
                  <div className="bg-surface border border-border rounded-lg p-5 space-y-4">
                    <h4 className="text-fg font-semibold text-sm">
                      {slotForm.id ? 'تعديل موعد' : 'إضافة موعد'}
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <label className="text-sm text-fg-secondary space-y-1.5 block">
                        <span>اليوم</span>
                        <select
                          className={field}
                          value={slotForm.day_of_week}
                          onChange={e => setSlotForm(f => ({ ...f, day_of_week: Number(e.target.value) }))}
                        >
                          {DAY_LABELS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                        </select>
                      </label>
                      <label className="text-sm text-fg-secondary space-y-1.5 block">
                        <span>من</span>
                        <input type="time" className={field} value={slotForm.start_time}
                          onChange={e => setSlotForm(f => ({ ...f, start_time: e.target.value }))} />
                      </label>
                      <label className="text-sm text-fg-secondary space-y-1.5 block">
                        <span>إلى</span>
                        <input type="time" className={field} value={slotForm.end_time}
                          onChange={e => setSlotForm(f => ({ ...f, end_time: e.target.value }))} />
                      </label>
                      <label className="text-sm text-fg-secondary space-y-1.5 block">
                        <span>المعلم (اختياري)</span>
                        <select
                          className={field}
                          value={slotForm.teacher_id}
                          onChange={e => setSlotForm(f => ({ ...f, teacher_id: e.target.value }))}
                        >
                          <option value="">— بدون —</option>
                          {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </label>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <label className="text-sm text-fg-secondary space-y-1.5 block md:col-span-1">
                        <span>عنوان الموعد</span>
                        <input className={field} value={slotForm.title}
                          onChange={e => setSlotForm(f => ({ ...f, title: e.target.value }))}
                          placeholder="مثال: محاضرة رياضيات" />
                      </label>
                      <label className="text-sm text-fg-secondary space-y-1.5 block">
                        <span>المكان (اختياري)</span>
                        <input className={field} value={slotForm.location}
                          onChange={e => setSlotForm(f => ({ ...f, location: e.target.value }))}
                          placeholder="قاعة 201" />
                      </label>
                      <label className="text-sm text-fg-secondary space-y-1.5 block">
                        <span>ملاحظة (اختياري)</span>
                        <input className={field} value={slotForm.note}
                          onChange={e => setSlotForm(f => ({ ...f, note: e.target.value }))} />
                      </label>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button variant="ghost" onClick={() => { setSlotOpen(false); setSlotForm({ ...EMPTY_SLOT }) }}>
                        إلغاء
                      </Button>
                      <Button loading={busy} onClick={saveSlot}>حفظ</Button>
                    </div>
                  </div>
                )}

                {/* Editable 7-day grid */}
                <div className="overflow-x-auto">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 min-w-full lg:min-w-[900px]">
                    {DAY_LABELS.map((label, day) => {
                      const daySlots = slotsForDay(selected.slots, day)
                      return (
                        <div key={day} className="bg-surface border border-border rounded-lg overflow-hidden">
                          <div className="px-3 py-2 border-b border-border bg-surface/50">
                            <p className="text-fg text-sm font-semibold">{label}</p>
                          </div>
                          <div className="p-2 space-y-2 min-h-[72px]">
                            {daySlots.length === 0 ? (
                              <p className="text-fg-muted text-xs text-center py-4">—</p>
                            ) : daySlots.map(slot => (
                              <div key={slot.id} className="rounded-lg bg-surface/70 border border-border-strong/60 p-2.5">
                                <p className="text-fg text-sm font-medium leading-tight">{slot.title}</p>
                                <p className="text-accent text-xs mt-1">
                                  {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
                                </p>
                                {slot.teacher_name && <p className="text-fg-secondary text-[11px] mt-1">{slot.teacher_name}</p>}
                                {slot.location && <p className="text-fg-secondary text-[11px] mt-0.5">{slot.location}</p>}
                                <div className="flex gap-1 mt-2">
                                  <button onClick={() => editSlot(slot.id)}
                                    className="text-fg-secondary hover:text-fg p-1 rounded" title="تعديل">
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                  <button onClick={() => deleteSlot(slot.id)}
                                    className="text-fg-secondary hover:text-error p-1 rounded" title="حذف">
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-surface border border-border rounded-lg h-full flex items-center justify-center text-fg-muted text-sm py-20">
                اختر جدولاً لعرضه وتحريره
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
