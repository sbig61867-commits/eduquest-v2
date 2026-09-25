'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/lib/confirm-dialog'
import { CalendarDays, Plus, Trash2, Pencil, Eye, EyeOff, Users, User } from 'lucide-react'
import { DAY_INDEXES, formatTime, slotsForDay, type ScheduleRow, type TargetOption } from './types'

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
  const t = useTranslations('staff.schedules')
  const tc = useTranslations('common')
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
    if (!res.ok) { toast.error(data.error ?? t('updateFailed')); return false }
    return true
  }

  async function createSchedule() {
    if (!createForm.target_id) return toast.error(t('pickTarget'))
    if (!createForm.title.trim()) return toast.error(t('titleRequired'))
    setBusy(true)
    const res = await fetch('/api/schedules', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createForm),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return toast.error(data.error ?? t('createFailed'))
    toast.success(t('created'))
    setCreating(false)
    setCreateForm({ kind: 'group', target_id: '', title: '' })
    setSelectedId(data.id)
    router.refresh()
  }

  async function togglePublish() {
    if (!selected) return
    const next = !selected.is_published
    if (next && selected.slots.length === 0) {
      return toast.error(t('publishNeedsSlots'))
    }
    if (await send('/api/schedules', 'PATCH', { id: selected.id, is_published: next })) {
      toast.success(next ? t('published') : t('unpublished'))
      router.refresh()
    }
  }

  async function deleteSchedule() {
    if (!selected) return
    if (!(await confirmDialog(t('deleteConfirm', { name: selected.target_name ?? selected.title })))) return
    if (await send('/api/schedules', 'DELETE', { id: selected.id })) {
      toast.success(t('deleted'))
      setSelectedId(null)
      router.refresh()
    }
  }

  async function saveSlot() {
    if (!selected) return
    if (!slotForm.title.trim()) return toast.error(t('slotTitleRequired'))
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
    toast.success(slotForm.id ? t('slotSaved') : t('slotAdded'))
    setSlotForm({ ...EMPTY_SLOT })
    setSlotOpen(false)
    router.refresh()
  }

  async function deleteSlot(id: string) {
    if (!(await confirmDialog(t('slotDeleteConfirm')))) return
    if (await send('/api/schedules/slots', 'DELETE', { id })) {
      toast.success(t('slotDeleted'))
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

  const field = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-white">{t('title')}</h2>
          <p className="text-slate-400 mt-1">
            {t('summary', { count: schedules.length, published: schedules.filter(s => s.is_published).length })}
          </p>
        </div>
        <Button onClick={() => setCreating(v => !v)}><Plus className="w-4 h-4" /> {t('newSchedule')}</Button>
      </div>

      {creating && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <h3 className="text-white font-semibold">{t('createTitle')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="text-sm text-slate-300 space-y-1.5 block">
              <span>{t('kind')}</span>
              <select
                className={field}
                value={createForm.kind}
                onChange={e => setCreateForm(f => ({ ...f, kind: e.target.value, target_id: '' }))}
              >
                <option value="group">{t('kindGroup')}</option>
                <option value="teacher">{t('kindTeacher')}</option>
              </select>
            </label>
            <label className="text-sm text-slate-300 space-y-1.5 block">
              <span>{createForm.kind === 'group' ? t('targetGroup') : t('targetTeacher')}</span>
              <select
                className={field}
                value={createForm.target_id}
                onChange={e => setCreateForm(f => ({ ...f, target_id: e.target.value }))}
              >
                <option value="">{t('choose')}</option>
                {availableTargets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="text-sm text-slate-300 space-y-1.5 block">
              <span>{t('scheduleTitle')}</span>
              <input
                className={field}
                value={createForm.title}
                onChange={e => setCreateForm(f => ({ ...f, title: e.target.value }))}
                placeholder={t('scheduleTitlePlaceholder')}
              />
            </label>
          </div>
          {availableTargets.length === 0 && (
            <p className="text-amber-400 text-xs">
              {t('oneEach', { target: createForm.kind === 'group' ? t('targetGroups') : t('targetTeachers') })}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setCreating(false)}>{t('cancel')}</Button>
            <Button loading={busy} onClick={createSchedule}>{t('create')}</Button>
          </div>
        </div>
      )}

      {schedules.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <CalendarDays className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">{t('empty')}</p>
          <p className="text-slate-500 text-sm mt-1">{t('emptyHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Schedule list */}
          <div className="space-y-2 lg:col-span-1">
            {schedules.map(s => (
              <button
                key={s.id}
                onClick={() => { setSelectedId(s.id); setSlotOpen(false); setSlotForm({ ...EMPTY_SLOT }) }}
                className={`w-full text-end p-3 rounded-xl border transition-colors ${
                  selectedId === s.id ? 'bg-slate-800 border-blue-600' : 'bg-slate-900 border-slate-800 hover:bg-slate-800/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  {s.kind === 'group'
                    ? <Users className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    : <User className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                  <span className="text-white text-sm font-medium truncate">{s.target_name ?? '—'}</span>
                </div>
                <p className="text-slate-500 text-xs mt-1 truncate">{s.title}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${
                    s.is_published ? 'text-emerald-400 bg-emerald-500/10' : 'text-slate-400 bg-slate-500/10'
                  }`}>
                    {s.is_published ? t('published_') : t('draft')}
                  </span>
                  <span className="text-slate-500 text-[11px]">{t('slotsCount', { count: s.slots.length })}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Selected schedule */}
          <div className="lg:col-span-3">
            {selected ? (
              <div className="space-y-4">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <h3 className="text-white font-semibold">{selected.target_name ?? '—'}</h3>
                      <p className="text-slate-500 text-xs mt-0.5">
                        {t('detailMeta', { title: selected.title, kind: selected.kind === 'group' ? t('kindGroupShort') : t('kindTeacherShort') })}
                      </p>
                      {selected.kind === 'teacher' && (
                        <p className="text-amber-400/80 text-[11px] mt-1">
                          {t('teacherPrivateHint')}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => { setSlotForm({ ...EMPTY_SLOT }); setSlotOpen(true) }}>
                        <Plus className="w-3.5 h-3.5" /> {t('addSlot')}
                      </Button>
                      {selected.kind === 'group' && (
                        <Button size="sm" variant="ghost" loading={busy} onClick={togglePublish}>
                          {selected.is_published
                            ? <><EyeOff className="w-3.5 h-3.5" /> {t('hide')}</>
                            : <><Eye className="w-3.5 h-3.5" /> {t('publish')}</>}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" loading={busy} onClick={deleteSchedule}>
                        <Trash2 className="w-3.5 h-3.5" /> {t('delete')}
                      </Button>
                    </div>
                  </div>
                </div>

                {slotOpen && (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                    <h4 className="text-white font-semibold text-sm">
                      {slotForm.id ? t('editSlot') : t('newSlot')}
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <label className="text-sm text-slate-300 space-y-1.5 block">
                        <span>{t('day')}</span>
                        <select
                          className={field}
                          value={slotForm.day_of_week}
                          onChange={e => setSlotForm(f => ({ ...f, day_of_week: Number(e.target.value) }))}
                        >
                          {DAY_INDEXES.map(i => <option key={i} value={i}>{tc(`days.${i}`)}</option>)}
                        </select>
                      </label>
                      <label className="text-sm text-slate-300 space-y-1.5 block">
                        <span>{t('from')}</span>
                        <input type="time" className={field} value={slotForm.start_time}
                          onChange={e => setSlotForm(f => ({ ...f, start_time: e.target.value }))} />
                      </label>
                      <label className="text-sm text-slate-300 space-y-1.5 block">
                        <span>{t('to')}</span>
                        <input type="time" className={field} value={slotForm.end_time}
                          onChange={e => setSlotForm(f => ({ ...f, end_time: e.target.value }))} />
                      </label>
                      <label className="text-sm text-slate-300 space-y-1.5 block">
                        <span>{t('slotTeacher')}</span>
                        <select
                          className={field}
                          value={slotForm.teacher_id}
                          onChange={e => setSlotForm(f => ({ ...f, teacher_id: e.target.value }))}
                        >
                          <option value="">{t('choose')}</option>
                          {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </label>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <label className="text-sm text-slate-300 space-y-1.5 block md:col-span-1">
                        <span>{t('slotTitle')}</span>
                        <input className={field} value={slotForm.title}
                          onChange={e => setSlotForm(f => ({ ...f, title: e.target.value }))}
                          placeholder={t('slotTitlePlaceholder')} />
                      </label>
                      <label className="text-sm text-slate-300 space-y-1.5 block">
                        <span>{t('location')}</span>
                        <input className={field} value={slotForm.location}
                          onChange={e => setSlotForm(f => ({ ...f, location: e.target.value }))}
                          placeholder={t('locationPlaceholder')} />
                      </label>
                      <label className="text-sm text-slate-300 space-y-1.5 block">
                        <span>{t('note')}</span>
                        <input className={field} value={slotForm.note}
                          onChange={e => setSlotForm(f => ({ ...f, note: e.target.value }))} />
                      </label>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button variant="ghost" onClick={() => { setSlotOpen(false); setSlotForm({ ...EMPTY_SLOT }) }}>
                        {t('cancel')}
                      </Button>
                      <Button loading={busy} onClick={saveSlot}>{t('save')}</Button>
                    </div>
                  </div>
                )}

                {/* Editable 7-day grid */}
                <div className="overflow-x-auto">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 min-w-full lg:min-w-[900px]">
                    {DAY_INDEXES.map(day => {
                      const daySlots = slotsForDay(selected.slots, day)
                      return (
                        <div key={day} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                          <div className="px-3 py-2 border-b border-slate-800 bg-slate-800/50">
                            <p className="text-white text-sm font-semibold">{tc(`days.${day}`)}</p>
                          </div>
                          <div className="p-2 space-y-2 min-h-[72px]">
                            {daySlots.length === 0 ? (
                              <p className="text-slate-600 text-xs text-center py-4">—</p>
                            ) : daySlots.map(slot => (
                              <div key={slot.id} className="rounded-lg bg-slate-800/70 border border-slate-700/60 p-2.5">
                                <p className="text-white text-sm font-medium leading-tight">{slot.title}</p>
                                <p className="text-blue-300 text-xs mt-1">
                                  {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
                                </p>
                                {slot.teacher_name && <p className="text-slate-400 text-[11px] mt-1">{slot.teacher_name}</p>}
                                {slot.location && <p className="text-slate-400 text-[11px] mt-0.5">{slot.location}</p>}
                                <div className="flex gap-1 mt-2">
                                  <button onClick={() => editSlot(slot.id)}
                                    className="text-slate-400 hover:text-white p-1 rounded" title={t('editAria')}>
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                  <button onClick={() => deleteSlot(slot.id)}
                                    className="text-slate-400 hover:text-red-400 p-1 rounded" title={t('deleteAria')}>
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
              <div className="bg-slate-900 border border-slate-800 rounded-xl h-full flex items-center justify-center text-slate-500 text-sm py-20">
                {t('pickScheduleHint')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
