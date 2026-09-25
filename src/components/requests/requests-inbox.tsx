'use client'

import { useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import type { Locale } from '@/i18n/config'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { formatDate } from '@/lib/utils'
import { Inbox, Send, Plus, MessageSquare, Check, X, CheckCircle2, Ban } from 'lucide-react'

// Shared teacher↔admin request inbox. Reads are done server-side (RLS);
// this component handles creating requests, replying, and status changes,
// then router.refresh()es to re-pull the authoritative server state.

export interface RequestMessage {
  id: string
  sender_id: string
  body: string
  created_at: string
}
export interface RequestRow {
  id: string
  type: 'general' | 'grade_sheet' | 'report'
  subject: string
  status: 'pending' | 'accepted' | 'rejected' | 'completed' | 'cancelled'
  created_at: string
  updated_at: string
  from_user_id: string
  to_user_id: string
  from_name: string | null
  to_name: string | null
  group_name: string | null
  messages: RequestMessage[]
}
export interface RecipientOption { id: string; full_name: string | null }
export interface GroupOption { id: string; name: string; teacher_id: string }

interface Props {
  me: { id: string; role: string }
  requests: RequestRow[]
  recipients: RecipientOption[]
  groups: GroupOption[]
  /** Already-localized label for the counterpart, supplied by the page. */
  recipientLabel: string
}

const STATUS_CLASS: Record<RequestRow['status'], string> = {
  pending: 'text-amber-400 bg-amber-500/10',
  accepted: 'text-blue-400 bg-blue-500/10',
  rejected: 'text-red-400 bg-red-500/10',
  completed: 'text-emerald-400 bg-emerald-500/10',
  cancelled: 'text-slate-400 bg-slate-500/10',
}

export function RequestsInbox({ me, requests, recipients, groups, recipientLabel }: Props) {
  const t = useTranslations('staff.requests')
  const locale = useLocale() as Locale
  const router = useRouter()
  const [selectedId, setSelectedId] = useState<string | null>(requests[0]?.id ?? null)
  const [composing, setComposing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState('')

  // New-request form state
  const [form, setForm] = useState({ to_user_id: '', type: 'general', subject: '', group_id: '', message: '' })

  const selected = useMemo(() => requests.find(r => r.id === selectedId) ?? null, [requests, selectedId])

  // Groups selectable in the form: for an admin they filter to the chosen
  // teacher's groups; for a teacher they're already only their own.
  const formGroups = useMemo(() => {
    if (me.role === 'university_admin' && form.to_user_id) {
      return groups.filter(g => g.teacher_id === form.to_user_id)
    }
    return groups
  }, [groups, form.to_user_id, me.role])

  async function createRequest() {
    if (!form.to_user_id) return toast.error(t('pickRecipient', { recipient: recipientLabel }))
    if (!form.subject.trim()) return toast.error(t('subjectRequired'))
    setBusy(true)
    const res = await fetch('/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to_user_id: form.to_user_id,
        type: form.type,
        subject: form.subject.trim(),
        group_id: form.group_id || undefined,
        message: form.message.trim() || undefined,
      }),
    })
    const data = await res.json()
    setBusy(false)
    if (!res.ok) return toast.error(data.error ?? t('createFailed'))
    toast.success(t('created'))
    setComposing(false)
    setForm({ to_user_id: '', type: 'general', subject: '', group_id: '', message: '' })
    setSelectedId(data.id)
    router.refresh()
  }

  async function sendReply() {
    if (!selected || !reply.trim()) return
    setBusy(true)
    const res = await fetch('/api/requests/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: selected.id, body: reply.trim() }),
    })
    const data = await res.json()
    setBusy(false)
    if (!res.ok) return toast.error(data.error ?? t('replyFailed'))
    setReply('')
    router.refresh()
  }

  async function setStatus(status: RequestRow['status']) {
    if (!selected) return
    setBusy(true)
    const res = await fetch('/api/requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: selected.id, status }),
    })
    const data = await res.json()
    setBusy(false)
    if (!res.ok) return toast.error(data.error ?? t('statusFailed'))
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">{t('title')}</h2>
          <p className="text-slate-400 mt-1">{t('summary', { count: requests.length, recipient: recipientLabel })}</p>
        </div>
        <Button onClick={() => setComposing(v => !v)}>
          <Plus className="w-4 h-4" /> {t('newRequest')}
        </Button>
      </div>

      {composing && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <h3 className="text-white font-semibold">{t('composeTitle', { recipient: recipientLabel })}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-sm text-slate-300 space-y-1.5 block">
              <span>{recipientLabel}</span>
              <select
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                value={form.to_user_id}
                onChange={e => setForm(f => ({ ...f, to_user_id: e.target.value, group_id: '' }))}
              >
                <option value="">{t('choose')}</option>
                {recipients.map(r => <option key={r.id} value={r.id}>{r.full_name ?? '—'}</option>)}
              </select>
            </label>
            <label className="text-sm text-slate-300 space-y-1.5 block">
              <span>{t('typeLabel')}</span>
              <select
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              >
                <option value="general">{t('type.general')}</option>
                <option value="grade_sheet">{t('type.grade_sheet')}</option>
                <option value="report">{t('type.report')}</option>
              </select>
            </label>
          </div>
          <label className="text-sm text-slate-300 space-y-1.5 block">
            <span>{t('subject')}</span>
            <input
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
              value={form.subject}
              onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              placeholder={t('subjectPlaceholder')}
            />
          </label>
          {formGroups.length > 0 && (
            <label className="text-sm text-slate-300 space-y-1.5 block">
              <span>{t('groupLabel')}</span>
              <select
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                value={form.group_id}
                onChange={e => setForm(f => ({ ...f, group_id: e.target.value }))}
              >
                <option value="">{t('none')}</option>
                {formGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
          )}
          <label className="text-sm text-slate-300 space-y-1.5 block">
            <span>{t('bodyLabel')}</span>
            <textarea
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm min-h-[80px]"
              value={form.message}
              onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
              placeholder={t('bodyPlaceholder')}
            />
          </label>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setComposing(false)}>{t('cancel')}</Button>
            <Button loading={busy} onClick={createRequest}><Send className="w-4 h-4" /> {t('send')}</Button>
          </div>
        </div>
      )}

      {requests.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <Inbox className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">{t('empty')}</p>
          <p className="text-slate-500 text-sm mt-1">{t('emptyHint', { recipient: recipientLabel })}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* List */}
          <div className="space-y-2 lg:col-span-1">
            {requests.map(r => {
              const counterpart = r.from_user_id === me.id ? r.to_name : r.from_name
              const outgoing = r.from_user_id === me.id
              return (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={`w-full text-end p-3 rounded-xl border transition-colors ${
                    selectedId === r.id ? 'bg-slate-800 border-blue-600' : 'bg-slate-900 border-slate-800 hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-white text-sm font-medium truncate">{r.subject}</span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${STATUS_CLASS[r.status]}`}>{t(`status.${r.status}`)}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                    <span>{t(`type.${r.type}`)}</span>
                    <span>·</span>
                    <span>{outgoing ? t('to') : t('from')} {counterpart ?? '—'}</span>
                    {r.messages.length > 0 && (
                      <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{r.messages.length}</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Thread */}
          <div className="lg:col-span-2">
            {selected ? (
              <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col h-full">
                <div className="p-4 border-b border-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-white font-semibold">{selected.subject}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_CLASS[selected.status]}`}>{t(`status.${selected.status}`)}</span>
                  </div>
                  <p className="text-slate-500 text-xs mt-1">
                    {t(`type.${selected.type}`)}
                    {selected.group_name && <> · {t('group', { name: selected.group_name })}</>}
                    {' · '}{formatDate(selected.created_at, locale)}
                  </p>
                  <StatusActions me={me} req={selected} busy={busy} onSet={setStatus} />
                </div>

                <div className="p-4 space-y-3 max-h-[420px] overflow-y-auto">
                  {selected.messages.length === 0 ? (
                    <p className="text-slate-500 text-sm text-center py-6">{t('noMessages')}</p>
                  ) : (
                    [...selected.messages]
                      .sort((a, b) => a.created_at.localeCompare(b.created_at))
                      .map(m => {
                        const mine = m.sender_id === me.id
                        return (
                          <div key={m.id} className={`flex ${mine ? 'justify-start' : 'justify-end'}`}>
                            <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${mine ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-200'}`}>
                              <p className="whitespace-pre-wrap break-words">{m.body}</p>
                              <p className={`text-[10px] mt-1 ${mine ? 'text-blue-100' : 'text-slate-500'}`}>{formatDate(m.created_at, locale)}</p>
                            </div>
                          </div>
                        )
                      })
                  )}
                </div>

                <div className="p-3 border-t border-slate-800 flex gap-2">
                  <input
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                    placeholder={t('replyPlaceholder')}
                    value={reply}
                    onChange={e => setReply(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() } }}
                  />
                  <Button loading={busy} onClick={sendReply} disabled={!reply.trim()}><Send className="w-4 h-4" /></Button>
                </div>
              </div>
            ) : (
              <div className="bg-slate-900 border border-slate-800 rounded-xl h-full flex items-center justify-center text-slate-500 text-sm py-20">
                {t('pickRequestHint')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function StatusActions({ me, req, busy, onSet }: {
  me: { id: string; role: string }
  req: RequestRow
  busy: boolean
  onSet: (s: RequestRow['status']) => void
}) {
  const t = useTranslations('staff.requests')
  const isRecipient = req.to_user_id === me.id
  const isSender = req.from_user_id === me.id
  const isAdmin = me.role === 'university_admin' || me.role === 'super_admin'
  const canDecide = isRecipient || isAdmin
  const canCancel = isSender || isAdmin

  const buttons: React.ReactNode[] = []
  if (req.status === 'pending' && canDecide) {
    buttons.push(
      <Button key="acc" size="sm" loading={busy} onClick={() => onSet('accepted')}><Check className="w-3.5 h-3.5" /> {t('accept')}</Button>,
      <Button key="rej" size="sm" variant="ghost" loading={busy} onClick={() => onSet('rejected')}><X className="w-3.5 h-3.5" /> {t('reject')}</Button>,
    )
  }
  if (req.status === 'accepted' && canDecide) {
    buttons.push(
      <Button key="done" size="sm" loading={busy} onClick={() => onSet('completed')}><CheckCircle2 className="w-3.5 h-3.5" /> {t('complete')}</Button>,
    )
  }
  if ((req.status === 'pending' || req.status === 'accepted') && canCancel && !isRecipient) {
    buttons.push(
      <Button key="cancel" size="sm" variant="ghost" loading={busy} onClick={() => onSet('cancelled')}><Ban className="w-3.5 h-3.5" /> {t('cancelRequest')}</Button>,
    )
  }
  if (buttons.length === 0) return null
  return <div className="flex flex-wrap gap-2 mt-3">{buttons}</div>
}
