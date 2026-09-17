'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/lib/confirm-dialog'
import { CheckCheck, Save, Trash2 } from 'lucide-react'
import type { Option } from './roster-modal'

type Status = 'present' | 'absent' | 'late' | 'excused'
const STATUS: { key: Status; label: string; on: string }[] = [
  { key: 'present', label: 'حاضر',   on: 'bg-emerald-600 border-emerald-600 text-white' },
  { key: 'late',    label: 'متأخر',  on: 'bg-amber-600 border-amber-600 text-white' },
  { key: 'absent',  label: 'غائب',   on: 'bg-rose-600 border-rose-600 text-white' },
  { key: 'excused', label: 'بعذر',   on: 'bg-slate-600 border-slate-600 text-white' },
]

interface RosterEntry { id: string; full_name: string; email: string; is_active: boolean }
interface Recent { id: string; session_date: string; title: string | null; present: number; late: number; absent: number; excused: number }

/** Today's date in the viewer's own timezone, as YYYY-MM-DD. */
export function localToday(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function AttendanceClient({ groups }: { groups: Option[] }) {
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '')
  const [date, setDate] = useState(localToday())
  const [title, setTitle] = useState('')
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [marks, setMarks] = useState<Record<string, { status: Status | ''; note: string }>>({})
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [recent, setRecent] = useState<Recent[]>([])
  const [saving, setSaving] = useState(false)
  // Bumped after a save/delete to refetch; `loadedKey` records which
  // (group, date, revision) the visible data belongs to, so loading is derived.
  const [revision, setRevision] = useState(0)
  const [loadedKey, setLoadedKey] = useState('')
  const [maxDate] = useState(() => localToday(new Date(Date.now() + 86_400_000)))
  const requestKey = `${groupId}|${date}|${revision}`
  const loading = !!groupId && !!date && loadedKey !== requestKey

  useEffect(() => {
    if (!groupId || !date) return
    let cancelled = false
    fetch(`/api/attendance?group_id=${encodeURIComponent(groupId)}&date=${date}`)
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          toast.error(data.error ?? 'تعذّر تحميل الحضور')
          setRoster([]); setRecent([]); setSessionId(null); setMarks({})
        } else {
          const recs = (data.records ?? {}) as Record<string, { status: Status; note: string | null }>
          setRoster(data.roster ?? [])
          setSessionId(data.session?.id ?? null)
          setTitle(data.session?.title ?? '')
          setRecent(data.recent ?? [])
          setMarks(Object.fromEntries((data.roster ?? []).map((s: RosterEntry) => [
            s.id, { status: recs[s.id]?.status ?? '', note: recs[s.id]?.note ?? '' },
          ])))
        }
        setLoadedKey(`${groupId}|${date}|${revision}`)
      })
    return () => { cancelled = true }
  }, [groupId, date, revision])

  function setStatus(id: string, status: Status) {
    setMarks(m => ({ ...m, [id]: { note: m[id]?.note ?? '', status } }))
  }

  function markAllPresent() {
    setMarks(m => Object.fromEntries(roster.map(s => [s.id, { note: m[s.id]?.note ?? '', status: m[s.id]?.status || 'present' }])))
  }

  async function save() {
    const records = roster
      .filter(s => marks[s.id]?.status)
      .map(s => ({ student_id: s.id, status: marks[s.id].status, note: marks[s.id].note.trim() || null }))
    if (records.length === 0) return toast.error('حدّد حالة طالب واحد على الأقل')
    const missing = roster.length - records.length
    if (missing > 0 && !(await confirmDialog(`${missing} طالب بلا حالة — حفظ الباقين فقط؟`))) return
    setSaving(true)
    const res = await fetch('/api/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: groupId, session_date: date, title: title.trim() || null, records }),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) return toast.error(data.error ?? 'تعذّر حفظ الحضور')
    toast.success(`تم حفظ حضور ${data.saved} طالب`)
    setRevision(r => r + 1)
  }

  async function removeSession(id: string) {
    if (!(await confirmDialog('حذف هذه الجلسة وكل سجلات حضورها؟'))) return
    const res = await fetch('/api/attendance', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: id }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return toast.error(data.error ?? 'تعذّر الحذف')
    toast.success('تم حذف الجلسة')
    setRevision(r => r + 1)
  }

  if (groups.length === 0) {
    return <p className="text-slate-400 text-center py-20" dir="rtl">لا توجد مجموعات نشطة لتسجيل الحضور فيها.</p>
  }

  const counts = STATUS.map(s => ({ ...s, n: roster.filter(r => marks[r.id]?.status === s.key).length }))

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h2 className="text-2xl font-bold text-white">الحضور</h2>
        <p className="text-slate-400 mt-1">سجّل حضور المجموعة لكل جلسة — يُحفظ السجل ويظهر في لوحة البيانات.</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="space-y-1.5 block">
          <span className="text-sm text-slate-300">المجموعة</span>
          <select value={groupId} onChange={e => setGroupId(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm">
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        <label className="space-y-1.5 block">
          <span className="text-sm text-slate-300">التاريخ</span>
          <input type="date" value={date} max={maxDate}
            onChange={e => setDate(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm" />
        </label>
        <label className="space-y-1.5 block">
          <span className="text-sm text-slate-300">عنوان الجلسة (اختياري)</span>
          <input value={title} maxLength={120} onChange={e => setTitle(e.target.value)} placeholder="مثال: المحاضرة 3"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm" />
        </label>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap text-xs">
          {counts.map(c => <span key={c.key} className="px-2.5 py-1 rounded-full bg-slate-800 text-slate-300">{c.label}: {c.n}</span>)}
          {sessionId && <span className="px-2.5 py-1 rounded-full bg-blue-600/15 text-blue-300">جلسة محفوظة — التعديل يحدّثها</span>}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={markAllPresent} disabled={roster.length === 0}>
            <CheckCheck className="w-4 h-4" /> الكل حاضر
          </Button>
          <Button loading={saving} onClick={save} disabled={roster.length === 0}>
            <Save className="w-4 h-4" /> حفظ
          </Button>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl divide-y divide-slate-800">
        {loading && <p className="text-slate-500 text-sm p-5">جارٍ التحميل…</p>}
        {!loading && roster.length === 0 && <p className="text-slate-500 text-sm p-5">لا يوجد طلاب في هذه المجموعة.</p>}
        {!loading && roster.map(s => (
          <div key={s.id} className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 px-5 py-3">
            <div className="md:w-56 min-w-0">
              <p className={`text-sm truncate ${s.is_active ? 'text-white' : 'text-slate-500 line-through'}`}>{s.full_name}</p>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {STATUS.map(st => (
                <button
                  key={st.key}
                  onClick={() => setStatus(s.id, st.key)}
                  aria-pressed={marks[s.id]?.status === st.key}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                    marks[s.id]?.status === st.key ? st.on : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}
                >{st.label}</button>
              ))}
            </div>
            <input
              value={marks[s.id]?.note ?? ''}
              maxLength={300}
              onChange={e => setMarks(m => ({ ...m, [s.id]: { status: m[s.id]?.status ?? '', note: e.target.value } }))}
              placeholder="ملاحظة"
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs"
            />
          </div>
        ))}
      </div>

      {recent.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-white font-semibold">آخر الجلسات</h3>
          <div className="bg-slate-900 border border-slate-800 rounded-xl divide-y divide-slate-800">
            {recent.map(r => {
              const counted = r.present + r.late + r.absent
              const rate = counted ? Math.round(((r.present + r.late) / counted) * 100) : null
              return (
                <div key={r.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <button className="text-start min-w-0" onClick={() => setDate(r.session_date)}>
                    <span className="text-white">{r.session_date}</span>
                    {r.title && <span className="text-slate-500"> · {r.title}</span>}
                  </button>
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span>{rate === null ? '—' : `${rate}%`}</span>
                    <span>غياب {r.absent}</span>
                    <button onClick={() => removeSession(r.id)} aria-label="حذف الجلسة" className="text-slate-500 hover:text-rose-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
