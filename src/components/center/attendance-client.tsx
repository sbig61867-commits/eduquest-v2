'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/lib/confirm-dialog'
import { Check, CheckCheck, Save, Trash2 } from 'lucide-react'
import type { Option } from './roster-modal'

type Status = 'present' | 'absent' | 'late' | 'excused'
// Colours only — a label baked in at module level would resolve once at
// import and then serve that one language for the process's lifetime.
const STATUS: { key: Status; on: string }[] = [
  { key: 'present', on: 'bg-emerald-600 border-emerald-600 text-white' },
  { key: 'late',    on: 'bg-amber-600 border-amber-600 text-white' },
  { key: 'absent',  on: 'bg-rose-600 border-rose-600 text-white' },
  { key: 'excused', on: 'bg-slate-600 border-slate-600 text-white' },
]

interface RosterEntry { id: string; full_name: string; email: string; is_active: boolean }
interface Recent { id: string; session_date: string; title: string | null; present: number; late: number; absent: number; excused: number }

/** Today's date in the viewer's own timezone, as YYYY-MM-DD. */
export function localToday(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function AttendanceClient({ groups }: { groups: Option[] }) {
  const t = useTranslations('staff.attendance')
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
          toast.error(data.error ?? t('loadFailed'))
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

  function setStatus(id: string, status: Status | '') {
    setMarks(m => ({ ...m, [id]: { note: m[id]?.note ?? '', status } }))
  }

  function markAllPresent() {
    setMarks(m => Object.fromEntries(roster.map(s => [s.id, { note: m[s.id]?.note ?? '', status: m[s.id]?.status || 'present' }])))
  }

  async function save() {
    const records = roster
      .filter(s => marks[s.id]?.status)
      .map(s => ({ student_id: s.id, status: marks[s.id].status, note: marks[s.id].note.trim() || null }))
    if (records.length === 0) return toast.error(t('noMarks'))
    const missing = roster.length - records.length
    if (missing > 0 && !(await confirmDialog(t('missingConfirm', { count: missing })))) return
    setSaving(true)
    const res = await fetch('/api/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: groupId, session_date: date, title: title.trim() || null, records }),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) return toast.error(data.error ?? t('saveFailed'))
    toast.success(t('saved', { count: data.saved }))
    setRevision(r => r + 1)
  }

  async function removeSession(id: string) {
    if (!(await confirmDialog(t('deleteConfirm')))) return
    const res = await fetch('/api/attendance', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: id }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return toast.error(data.error ?? t('deleteFailed'))
    toast.success(t('deleted'))
    setRevision(r => r + 1)
  }

  if (groups.length === 0) {
    return <p className="text-slate-400 text-center py-20">{t('noGroups')}</p>
  }

  const counts = STATUS.map(s => ({ ...s, label: t(`status.${s.key}`), n: roster.filter(r => marks[r.id]?.status === s.key).length }))

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">{t('title')}</h2>
        <p className="text-slate-400 mt-1">{t('subtitle')}</p>
      </div>

      {/* Every group the user may mark, visible at once — no dropdown to open. */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <span className="text-sm text-slate-300">{t('group')}</span>
        <div className="flex flex-wrap gap-2">
          {groups.map(g => (
            <button
              key={g.id}
              onClick={() => setGroupId(g.id)}
              aria-pressed={g.id === groupId}
              className={`px-3.5 py-2 rounded-lg text-sm border transition-colors ${
                g.id === groupId
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500'
              }`}
            >{g.name}</button>
          ))}
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="space-y-1.5 block">
          <span className="text-sm text-slate-300">{t('date')}</span>
          <input type="date" value={date} max={maxDate}
            onChange={e => setDate(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm" />
        </label>
        <label className="space-y-1.5 block">
          <span className="text-sm text-slate-300">{t('sessionTitle')}</span>
          <input value={title} maxLength={120} onChange={e => setTitle(e.target.value)} placeholder={t('sessionTitlePlaceholder')}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm" />
        </label>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap text-xs">
          {counts.map(c => <span key={c.key} className="px-2.5 py-1 rounded-full bg-slate-800 text-slate-300">{c.label}: {c.n}</span>)}
          {sessionId && <span className="px-2.5 py-1 rounded-full bg-blue-600/15 text-blue-300">{t('savedSession')}</span>}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={markAllPresent} disabled={roster.length === 0}>
            <CheckCheck className="w-4 h-4" /> {t('allPresent')}
          </Button>
          <Button loading={saving} onClick={save} disabled={roster.length === 0}>
            <Save className="w-4 h-4" /> {t('save')}
          </Button>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl divide-y divide-slate-800">
        {loading && <p className="text-slate-500 text-sm p-5">{t('loading')}</p>}
        {!loading && roster.length === 0 && <p className="text-slate-500 text-sm p-5">{t('noStudents')}</p>}
        {!loading && roster.map(s => (
          <div key={s.id} className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 px-5 py-3">
            <div className="flex items-center gap-3 md:w-64 min-w-0">
              {/* One click on the box = present, click again to clear it.
                  The detailed statuses stay available as the buttons beside it. */}
              <button
                onClick={() => setStatus(s.id, marks[s.id]?.status === 'present' ? '' : 'present')}
                role="checkbox"
                aria-checked={marks[s.id]?.status === 'present'}
                aria-label={t('markAria', { name: s.full_name })}
                className={`shrink-0 w-7 h-7 rounded-md border flex items-center justify-center transition-colors ${
                  marks[s.id]?.status === 'present'
                    ? 'bg-emerald-600 border-emerald-600 text-white'
                    : 'bg-slate-800 border-slate-600 text-transparent hover:border-emerald-500'
                }`}
              >
                <Check className="w-4 h-4" />
              </button>
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
                >{t(`status.${st.key}`)}</button>
              ))}
            </div>
            <input
              value={marks[s.id]?.note ?? ''}
              maxLength={300}
              onChange={e => setMarks(m => ({ ...m, [s.id]: { status: m[s.id]?.status ?? '', note: e.target.value } }))}
              placeholder={t('notePlaceholder')}
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs"
            />
          </div>
        ))}
      </div>

      {recent.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-white font-semibold">{t('recentSessions')}</h3>
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
                    <span>{t('absentCount', { count: r.absent })}</span>
                    <button onClick={() => removeSession(r.id)} aria-label={t('deleteSession')} className="text-slate-500 hover:text-rose-400">
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
