'use client'

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { UserMinus, UserPlus, ArrowLeftRight } from 'lucide-react'

export interface Option { id: string; name: string }
interface Member { id: string; full_name: string; email: string }

/**
 * Shared membership editor for a group roster or a course enrolment list.
 * `endpoint` is /api/group-students (key group_id) or
 * /api/course-enrollments (key course_id) — both speak the same shape.
 * Render it with `key={targetId}` so pick/filter state resets per target.
 */
export function RosterModal({ open, onClose, title, endpoint, idKey, targetId, students, onChanged, onTransfer }: {
  open: boolean
  onClose: () => void
  title: string
  endpoint: '/api/group-students' | '/api/course-enrollments'
  idKey: 'group_id' | 'course_id'
  targetId: string | null
  students: Option[]
  onChanged?: (count: number) => void
  /** Group rosters only: move this member to another group. */
  onTransfer?: (member: Member) => void
}) {
  const [members, setMembers] = useState<Member[]>([])
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [pick, setPick] = useState('')
  const [filter, setFilter] = useState('')
  const loading = open && !!targetId && loadedFor !== targetId

  useEffect(() => {
    if (!open || !targetId) return
    let cancelled = false
    fetch(`${endpoint}?${idKey}=${encodeURIComponent(targetId)}`)
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) toast.error(data.error ?? 'تعذّر تحميل القائمة')
        setMembers(res.ok ? data.students ?? [] : [])
        setLoadedFor(targetId)
      })
    return () => { cancelled = true }
  }, [open, endpoint, idKey, targetId])

  async function change(method: 'POST' | 'DELETE', studentId: string) {
    if (!targetId) return
    setBusy(studentId)
    const res = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [idKey]: targetId, student_id: studentId }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy('')
    if (!res.ok) return toast.error(data.error ?? 'تعذّر التحديث')
    const next = method === 'POST'
      ? [...members.filter(m => m.id !== studentId), data.student as Member].filter(Boolean)
      : members.filter(m => m.id !== studentId)
    setMembers(next)
    setPick('')
    onChanged?.(next.length)
  }

  const memberIds = new Set(members.map(m => m.id))
  const q = filter.trim().toLowerCase()
  const candidates = students.filter(s => !memberIds.has(s.id) && (!q || s.name.toLowerCase().includes(q)))

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      <div className="space-y-4" dir="rtl">
        <div className="flex gap-2 flex-wrap">
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="ابحث عن طالب…"
            className="flex-1 min-w-[160px] bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
          />
          <select
            value={pick}
            onChange={e => setPick(e.target.value)}
            className="flex-1 min-w-[180px] bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
          >
            <option value="">اختر طالباً ({candidates.length})</option>
            {candidates.slice(0, 200).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Button disabled={!pick} loading={busy === pick && !!pick} onClick={() => change('POST', pick)}>
            <UserPlus className="w-4 h-4" /> إضافة
          </Button>
        </div>

        <div className="max-h-80 overflow-y-auto border border-slate-800 rounded-lg divide-y divide-slate-800">
          {loading && <p className="text-slate-500 text-sm p-4">جارٍ التحميل…</p>}
          {!loading && members.length === 0 && <p className="text-slate-500 text-sm p-4">لا يوجد طلاب بعد.</p>}
          {members.map(m => (
            <div key={m.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
              <div className="min-w-0">
                <p className="text-white text-sm truncate">{m.full_name}</p>
                <p className="text-slate-500 text-xs truncate" dir="ltr">{m.email}</p>
              </div>
              <div className="flex gap-1">
                {onTransfer && (
                  <Button variant="ghost" size="sm" onClick={() => onTransfer(m)}>
                    <ArrowLeftRight className="w-3.5 h-3.5" /> نقل
                  </Button>
                )}
                <Button variant="ghost" size="sm" loading={busy === m.id} onClick={() => change('DELETE', m.id)}>
                  <UserMinus className="w-3.5 h-3.5" /> إزالة
                </Button>
              </div>
            </div>
          ))}
        </div>
        <p className="text-slate-500 text-xs">{members.length} طالب</p>
      </div>
    </Modal>
  )
}
