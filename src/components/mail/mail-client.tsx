'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/lib/confirm-dialog'
import { Mail, Link2, Unlink, Send, RefreshCw } from 'lucide-react'

export interface Recipient { id: string; name: string; email: string }
export interface RecipientGroup { id: string; name: string; member_count: number }

interface Connection { provider: string; email: string; status: string; last_error: string | null }

// Typing waits this long before asking the server (one request per pause, not per key).
const SEARCH_DELAY_MS = 300

/**
 * Students are found on demand (/api/mail/recipients, ≤ 20 per search) and «a
 * whole group» is kept as the group's id — the server resolves its active
 * students when counting and sending. The page never holds the student body
 * or any member list.
 */
export function MailClient({ groups }: { groups: RecipientGroup[] }) {
  const t = useTranslations('center.mail')
  const [loading, setLoading] = useState(true)
  const [configured, setConfigured] = useState(false)
  const [conn, setConn] = useState<Connection | null>(null)
  const [linking, setLinking] = useState(false)
  const [busy, setBusy] = useState('')
  const [selected, setSelected] = useState<Map<string, Recipient>>(new Map())
  const [selectedGroups, setSelectedGroups] = useState<RecipientGroup[]>([])
  const [filter, setFilter] = useState('')
  const [found, setFound] = useState<Recipient[] | null>(null)
  const searchSeq = useRef(0)
  // Exact size of the selection as the server resolves it (only needed once a group is in it).
  const [groupTotal, setGroupTotal] = useState<number | null>(null)
  const countSeq = useRef(0)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')

  const load = useCallback(() => fetch('/api/mail/connection')
    .then(async res => {
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setConfigured(!!data.configured?.google)
        setConn((data.connections as Connection[]).find(c => c.provider === 'google') ?? null)
      } else {
        toast.error(data.error ?? t('loadFailed'))
      }
      setLoading(false)
    }), [t])

  useEffect(() => { void load() }, [load])

  // The popup reports back over a same-origin channel (COOP severs window.opener).
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const ch = new BroadcastChannel('eduquest-mail')
    ch.onmessage = (e: MessageEvent<{ type?: string; ok?: boolean; message?: string }>) => {
      if (e.data?.type !== 'eduquest-mail-link') return
      setLinking(false)
      if (e.data.ok) toast.success(e.data.message ?? t('linked'))
      else toast.error(e.data.message ?? t('linkFailed'))
      load()
    }
    return () => ch.close()
  }, [load, t])

  // Backup for browsers without BroadcastChannel: poll while the popup flow is open.
  useEffect(() => {
    if (!linking || conn?.status === 'active') return
    const started = Date.now()
    const t = setInterval(() => {
      if (Date.now() - started > 180_000) { setLinking(false); clearInterval(t); return }
      load()
    }, 4000)
    return () => clearInterval(t)
  }, [linking, conn, load])

  function link() {
    const w = 520, h = 640
    const left = window.screenX + (window.outerWidth - w) / 2
    const top = window.screenY + (window.outerHeight - h) / 2
    const popup = window.open('/api/mail/google/start', 'eduquest-mail-link', `width=${w},height=${h},left=${left},top=${top}`)
    if (!popup) return toast.error(t('popupBlocked'))
    setLinking(true)
  }

  async function unlink() {
    if (!(await confirmDialog(t('unlinkConfirm')))) return
    setBusy('unlink')
    const res = await fetch('/api/mail/connection', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'google' }),
    })
    setBusy('')
    if (!res.ok) return toast.error(t('unlinkFailed'))
    toast.success(t('unlinked'))
    setConn(null)
  }

  useEffect(() => {
    const q = filter.trim()
    const mine = ++searchSeq.current
    if (!q) return
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/mail/recipients?q=${encodeURIComponent(q)}`)
      const data = await res.json().catch(() => ({}))
      if (mine !== searchSeq.current) return // a newer search superseded this one
      setFound(res.ok ? (data.students ?? []) : [])
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [filter])

  const pickedIds = [...selected.keys()]
  const groupIds = selectedGroups.map(g => g.id)
  const selectionKey = JSON.stringify([pickedIds, groupIds])
  // With a group in the selection, ask the server how many people it reaches
  // (de-duplicated, active students only — the same rule as the send).
  useEffect(() => {
    const mine = ++countSeq.current
    const [ids, gids] = JSON.parse(selectionKey) as [string[], string[]]
    if (gids.length === 0) return
    fetch('/api/mail/recipients', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_ids: ids, group_ids: gids }),
    }).then(async res => {
      const data = await res.json().catch(() => ({}))
      if (mine === countSeq.current) setGroupTotal(res.ok && typeof data.count === 'number' ? data.count : null)
    })
  }, [selectionKey])

  // Nothing typed ⇒ the current picks (so they can be unticked); typed ⇒ the search results.
  const searching = filter.trim() !== ''
  const visible: Recipient[] = searching ? (found ?? []) : [...selected.values()]
  const recipientCount = selectedGroups.length === 0 ? selected.size : (groupTotal ?? selected.size)

  function search(text: string) { setFilter(text); setFound(null) }
  function toggle(r: Recipient) {
    setGroupTotal(null)
    setSelected(prev => { const n = new Map(prev); if (n.has(r.id)) n.delete(r.id); else n.set(r.id, r); return n })
  }
  function addGroup(groupId: string) {
    const g = groups.find(x => x.id === groupId)
    if (!g) return
    setGroupTotal(null)
    setSelectedGroups(prev => (prev.some(x => x.id === g.id) ? prev : [...prev, g]))
  }
  function removeGroup(groupId: string) {
    setGroupTotal(null)
    setSelectedGroups(prev => prev.filter(x => x.id !== groupId))
  }
  function clearAll() { setSelected(new Map()); setSelectedGroups([]); setGroupTotal(null) }

  async function send() {
    if (selected.size === 0 && selectedGroups.length === 0) return toast.error(t('pickRecipient'))
    if (!subject.trim() || !body.trim()) return toast.error(t('subjectBodyRequired'))
    let count = selected.size
    if (selectedGroups.length > 0) {
      // The confirmation names the exact number the server will resolve now.
      const res = await fetch('/api/mail/recipients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient_ids: pickedIds, group_ids: groupIds }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(data.error ?? t('sendFailed'))
      count = data.count
    }
    if (!(await confirmDialog(t('sendConfirm', { from: conn?.email ?? '', count })))) return
    setBusy('send')
    const res = await fetch('/api/mail/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_ids: pickedIds, group_ids: groupIds, subject, body }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy('')
    if (!res.ok) {
      if (data.code === 'RELINK_REQUIRED' || data.code === 'NOT_LINKED') load()
      return toast.error(data.error ?? t('sendFailed'))
    }
    if (data.failed) toast.warning(t('sentPartial', { sent: data.sent, failed: data.failed }))
    else toast.success(t('sentAll', { sent: data.sent }))
    clearAll(); setSubject(''); setBody('')
  }

  const active = conn?.status === 'active'
  // The popup flow is over as soon as the mailbox shows up as connected.
  const linkingNow = linking && !active

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-2xl font-bold text-white">{t('title')}</h2>
        <p className="text-slate-400 mt-1">{t('subtitle')}</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Mail className="w-5 h-5 text-slate-400" />
            {loading ? <span className="text-slate-500 text-sm">{t('loading')}</span>
              : conn ? (
                <div>
                  <p className="text-white text-sm font-medium" dir="ltr">{conn.email}</p>
                  <Badge variant={active ? 'green' : 'red'}>{active ? t('connected') : t('needsRelink')}</Badge>
                </div>
              ) : <span className="text-slate-400 text-sm">{t('noMailbox')}</span>}
          </div>
          <div className="flex gap-2">
            {conn && (
              <Button variant="ghost" size="sm" loading={busy === 'unlink'} onClick={unlink}>
                <Unlink className="w-4 h-4" /> {t('unlink')}
              </Button>
            )}
            {(!conn || !active) && (
              <Button onClick={link} disabled={!configured || loading} loading={linkingNow}>
                {conn ? <RefreshCw className="w-4 h-4" /> : <Link2 className="w-4 h-4" />} {conn ? t('relink') : t('linkGoogle')}
              </Button>
            )}
          </div>
        </div>
        {!loading && !configured && (
          <p className="text-amber-400 text-xs">{t('notConfigured')}</p>
        )}
        <p className="text-slate-500 text-xs">
          {t.rich('privacyNote', { b: (c) => <b>{c}</b> })}
        </p>
      </div>

      {active && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <h3 className="text-white font-semibold">{t('compose')}</h3>
          <div className="flex gap-2 flex-wrap">
            <input value={filter} onChange={e => search(e.target.value)} placeholder={t('searchRecipient')}
              className="flex-1 min-w-[160px] bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm" />
            {groups.length > 0 && (
              <select value="" onChange={e => addGroup(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm">
                <option value="">{t('addGroup')}</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name} ({g.member_count})</option>)}
              </select>
            )}
            {(selected.size > 0 || selectedGroups.length > 0) && <Button variant="ghost" size="sm" onClick={clearAll}>{t('clearSelection')}</Button>}
          </div>
          {selectedGroups.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedGroups.map(g => (
                <span key={g.id} className="inline-flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-full px-3 py-1 text-xs text-white">
                  {t('wholeGroup', { name: `${g.name} (${g.member_count})` })}
                  <button type="button" aria-label={t('remove')} onClick={() => removeGroup(g.id)} className="text-slate-400 hover:text-white">×</button>
                </span>
              ))}
            </div>
          )}
          <div className="max-h-56 overflow-y-auto border border-slate-800 rounded-lg divide-y divide-slate-800">
            {visible.length === 0 && (
              <p className="text-slate-500 text-sm p-3">
                {searching && found !== null ? t('noRecipients') : !searching && selected.size === 0 ? t('typeToSearch') : t('loading')}
              </p>
            )}
            {visible.map(r => (
              <label key={r.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-800/50">
                <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r)} />
                <span className="text-white text-sm">{r.name}</span>
                <span className="text-slate-500 text-xs" dir="ltr">{r.email}</span>
              </label>
            ))}
          </div>
          <p className="text-slate-500 text-xs">{t('selectedCount', { count: recipientCount })}</p>
          <Input label={t('subject')} value={subject} maxLength={200} onChange={e => setSubject(e.target.value)} />
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-300">{t('body')}</span>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={8} maxLength={20000}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm" />
          </label>
          <div className="flex justify-end">
            <Button loading={busy === 'send'} onClick={send}><Send className="w-4 h-4" /> {t('send')}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
