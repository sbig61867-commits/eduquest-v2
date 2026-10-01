'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { UserMinus, UserPlus, ArrowLeftRight } from 'lucide-react'

export interface Option { id: string; name: string }
interface Member { id: string; full_name: string; email: string }
interface Candidate { id: string; full_name: string }

// Typing waits this long before asking the server (one request per pause, not per key).
const SEARCH_DELAY_MS = 300

/**
 * Shared membership editor for a group roster or a course enrolment list.
 * `endpoint` is /api/group-students (key group_id) or
 * /api/course-enrollments (key course_id) — both speak the same shape.
 * Render it with `key={targetId}` so pick/filter state resets per target.
 *
 * Students to add are found on demand (/api/roster/candidates: ≤ 20 active
 * students by name, the target's members already left out on the server) —
 * the institution's student body never reaches the page.
 */
export function RosterModal({ open, onClose, title, endpoint, idKey, targetId, onChanged, onTransfer }: {
  open: boolean
  onClose: () => void
  title: string
  endpoint: '/api/group-students' | '/api/course-enrollments'
  idKey: 'group_id' | 'course_id'
  targetId: string | null
  onChanged?: (count: number) => void
  /** Group rosters only: move this member to another group. */
  onTransfer?: (member: Member) => void
}) {
  const t = useTranslations('staff.roster')
  const tp = useTranslations('common.pagination')
  const [members, setMembers] = useState<Member[]>([])
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [pick, setPick] = useState('')
  const [filter, setFilter] = useState('')
  const [found, setFound] = useState<Candidate[] | null>(null)
  const searchSeq = useRef(0)
  const loading = open && !!targetId && loadedFor !== targetId

  useEffect(() => {
    const q = filter.trim()
    const mine = ++searchSeq.current
    if (!open || !targetId || !q) return
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/roster/candidates?${idKey}=${encodeURIComponent(targetId)}&q=${encodeURIComponent(q)}`)
      const data = await res.json().catch(() => ({}))
      if (mine !== searchSeq.current) return // a newer search superseded this one
      setFound(res.ok ? (data.students ?? []) : [])
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [open, idKey, targetId, filter])

  // Members come one page at a time (?page=, 50 each) with the server's total —
  // a course may hold thousands of enrolments (C-M). `reload` re-reads the
  // current page after an add/remove; `notify` then reports the new total.
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [total, setTotal] = useState(0)
  const [reload, setReload] = useState(0)
  const notify = useRef(false)

  useEffect(() => {
    if (!open || !targetId) return
    let cancelled = false
    fetch(`${endpoint}?${idKey}=${encodeURIComponent(targetId)}&page=${page}`)
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) toast.error(data.error ?? t('loadFailed'))
        setMembers(res.ok ? data.students ?? [] : [])
        setTotal(res.ok ? data.total ?? 0 : 0)
        setPageCount(res.ok ? data.pageCount ?? 1 : 1)
        // The server answers a page past the end with the last page.
        if (res.ok && typeof data.page === 'number' && data.page !== page) setPage(data.page)
        setLoadedFor(targetId)
        if (notify.current && res.ok) { notify.current = false; onChanged?.(data.total ?? 0) }
      })
    return () => { cancelled = true }
    // onChanged is a parent callback; re-reading on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, endpoint, idKey, targetId, page, reload, t])

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
    if (!res.ok) return toast.error(data.error ?? t('updateFailed'))
    // Show the change at once, then re-read the page: the server's total is
    // the one reported to the parent (an already-present student adds nothing).
    if (method === 'POST' && data.student) setMembers(prev => [data.student as Member, ...prev.filter(m => m.id !== studentId)])
    if (method === 'DELETE') setMembers(prev => prev.filter(m => m.id !== studentId))
    setPick('')
    notify.current = true
    setReload(n => n + 1)
  }

  // Nothing typed ⇒ no candidates («type to search»), whatever an older search returned.
  // The server already leaves the target's members out; this also drops one
  // added a moment ago (after the search ran).
  const searched = filter.trim() ? found : null
  const memberIds = new Set(members.map(m => m.id))
  const candidates = (searched ?? []).filter(s => !memberIds.has(s.id))

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      <div className="space-y-4">
        <div className="flex gap-2 flex-wrap">
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder={t('search')}
            className="flex-1 min-w-[160px] bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
          />
          <select
            value={pick}
            onChange={e => setPick(e.target.value)}
            disabled={searched === null}
            className="flex-1 min-w-[180px] bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
          >
            <option value="">{searched === null ? t('typeToSearch') : t('pick', { count: candidates.length })}</option>
            {candidates.map(s => <option key={s.id} value={s.id}>{s.full_name || '—'}</option>)}
          </select>
          <Button disabled={!pick} loading={busy === pick && !!pick} onClick={() => change('POST', pick)}>
            <UserPlus className="w-4 h-4" /> {t('add')}
          </Button>
        </div>

        <div className="max-h-80 overflow-y-auto border border-slate-800 rounded-lg divide-y divide-slate-800">
          {loading && <p className="text-slate-500 text-sm p-4">{t('loading')}</p>}
          {!loading && members.length === 0 && <p className="text-slate-500 text-sm p-4">{t('empty')}</p>}
          {members.map(m => (
            <div key={m.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
              <div className="min-w-0">
                <p className="text-white text-sm truncate">{m.full_name}</p>
                <p className="text-slate-500 text-xs truncate" dir="ltr">{m.email}</p>
              </div>
              <div className="flex gap-1">
                {onTransfer && (
                  <Button variant="ghost" size="sm" onClick={() => onTransfer(m)}>
                    <ArrowLeftRight className="w-3.5 h-3.5" /> {t('transfer')}
                  </Button>
                )}
                <Button variant="ghost" size="sm" loading={busy === m.id} onClick={() => change('DELETE', m.id)}>
                  <UserMinus className="w-3.5 h-3.5" /> {t('remove')}
                </Button>
              </div>
            </div>
          ))}
        </div>
        {pageCount > 1 && (
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>{tp('prev')}</Button>
            <span className="text-slate-400 text-xs">{tp('pageOf', { page, pages: pageCount })}</span>
            <Button variant="ghost" size="sm" disabled={page >= pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))}>{tp('next')}</Button>
          </div>
        )}
        <p className="text-slate-500 text-xs">{t('count', { count: total })}</p>
      </div>
    </Modal>
  )
}
