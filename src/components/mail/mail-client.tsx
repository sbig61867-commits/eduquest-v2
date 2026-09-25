'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/lib/confirm-dialog'
import { Mail, Link2, Unlink, Send, RefreshCw } from 'lucide-react'

export interface Recipient { id: string; name: string; email: string }
export interface RecipientGroup { id: string; name: string; member_ids: string[] }

interface Connection { provider: string; email: string; status: string; last_error: string | null }

export function MailClient({ recipients, groups }: { recipients: Recipient[]; groups: RecipientGroup[] }) {
  const t = useTranslations('center.mail')
  const [loading, setLoading] = useState(true)
  const [configured, setConfigured] = useState(false)
  const [conn, setConn] = useState<Connection | null>(null)
  const [linking, setLinking] = useState(false)
  const [busy, setBusy] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
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
    }), [])

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
  }, [load])

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

  const q = filter.trim().toLowerCase()
  const visible = useMemo(
    () => recipients.filter(r => !q || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q)),
    [recipients, q],
  )

  function toggle(id: string) {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function addGroup(groupId: string) {
    const g = groups.find(x => x.id === groupId)
    if (!g) return
    setSelected(prev => new Set([...prev, ...g.member_ids.filter(id => recipients.some(r => r.id === id))]))
  }

  async function send() {
    if (selected.size === 0) return toast.error(t('pickRecipient'))
    if (!subject.trim() || !body.trim()) return toast.error(t('subjectBodyRequired'))
    if (!(await confirmDialog(t('sendConfirm', { from: conn?.email ?? '', count: selected.size })))) return
    setBusy('send')
    const res = await fetch('/api/mail/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_ids: [...selected], subject, body }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy('')
    if (!res.ok) {
      if (data.code === 'RELINK_REQUIRED' || data.code === 'NOT_LINKED') load()
      return toast.error(data.error ?? t('sendFailed'))
    }
    if (data.failed) toast.warning(t('sentPartial', { sent: data.sent, failed: data.failed }))
    else toast.success(t('sentAll', { sent: data.sent }))
    setSelected(new Set()); setSubject(''); setBody('')
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
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder={t('searchRecipient')}
              className="flex-1 min-w-[160px] bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm" />
            {groups.length > 0 && (
              <select value="" onChange={e => addGroup(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm">
                <option value="">{t('addGroup')}</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name} ({g.member_ids.length})</option>)}
              </select>
            )}
            {selected.size > 0 && <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>{t('clearSelection')}</Button>}
          </div>
          <div className="max-h-56 overflow-y-auto border border-slate-800 rounded-lg divide-y divide-slate-800">
            {visible.length === 0 && <p className="text-slate-500 text-sm p-3">{t('noRecipients')}</p>}
            {visible.map(r => (
              <label key={r.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-800/50">
                <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                <span className="text-white text-sm">{r.name}</span>
                <span className="text-slate-500 text-xs" dir="ltr">{r.email}</span>
              </label>
            ))}
          </div>
          <p className="text-slate-500 text-xs">{t('selectedCount', { count: selected.size })}</p>
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
