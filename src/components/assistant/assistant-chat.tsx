'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Markdown } from '@/components/shared/markdown'

// The "Ask" tab of the study assistant: free questions to an AI provider through
// /api/assistant/student (privacy gate, allowance and rate limit apply there).
// Nothing is requested until the student sends a message. Replies are shown as
// formatted text through the shared Markdown renderer (no HTML, ever).

export interface AssistantLessonOption { id: string; title: string }

type Mode = 'chat' | 'explain' | 'simplify' | 'summarize'
interface Turn { role: 'user' | 'assistant'; content: string }

export function AssistantChat({ lessons }: { lessons: AssistantLessonOption[] }) {
  const t = useTranslations('student.assistant')
  const [lessonId, setLessonId] = useState<string>('')
  const [selection, setSelection] = useState('')
  const [input, setInput] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Keep the newest message in view.
  useEffect(() => {
    listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, busy])

  async function ask(mode: Mode, message: string) {
    const text = message.trim()
    if (!text || busy) return
    setBusy(true)
    setNotice(null)
    const history = turns.slice(-6)
    setTurns(prev => [...prev, { role: 'user', content: text }])
    setInput('')
    try {
      const res = await fetch('/api/assistant/student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          message: text,
          lessonId: lessonId || null,
          selection: selection.trim() || null,
          history,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setTurns(prev => [...prev, { role: 'assistant', content: data.error ?? t('error') }])
        return
      }
      setTurns(prev => [...prev, { role: 'assistant', content: data.answer as string }])
      const notices: string[] = []
      if (data.truncated) notices.push(t('truncated'))
      for (const n of (data.notices ?? []) as { error: string }[]) notices.push(n.error)
      if (notices.length) setNotice(notices.join(' '))
    } catch {
      setTurns(prev => [...prev, { role: 'assistant', content: t('error') }])
    } finally {
      setBusy(false)
    }
  }

  // The selected text travels as `selection`; without one, the chosen lesson is the subject.
  function runAction(mode: Exclude<Mode, 'chat'>, label: string) {
    if (selection.trim()) return void ask(mode, label)
    const title = lessons.find(l => l.id === lessonId)?.title
    if (title) void ask(mode, label + ': ' + title)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div ref={listRef} className="flex min-h-32 flex-1 flex-col gap-2 overflow-y-auto pe-1">
        {turns.length === 0 && (
          <p className="rounded-control bg-elevated px-3 py-2 text-body-sm text-fg">{t('empty')}</p>
        )}
        {turns.map((turn, i) => (
          turn.role === 'user'
            ? <p key={i} dir="auto" className="ms-8 whitespace-pre-wrap rounded-control bg-accent-subtle px-3 py-2 text-body-sm text-fg">{turn.content}</p>
            : (
              <div key={i} dir="auto" data-testid="assistant-answer" className="me-8 rounded-control bg-elevated px-3 py-2 text-body-sm text-fg">
                <Markdown content={turn.content} />
              </div>
            )
        ))}
        {busy && (
          <p className="me-8 rounded-control bg-elevated px-3 py-2 text-body-sm text-fg-muted" role="status">{t('sending')}</p>
        )}
        {notice && <p className="text-body-sm text-warning">{notice}</p>}
      </div>

      <details className="rounded-control border border-line px-3 py-2 text-body-sm">
        <summary className="cursor-pointer text-fg-muted">{t('advanced')}</summary>
        <div className="mt-2 flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-fg-muted">
            {t('lessonLabel')}
            <select value={lessonId} onChange={e => setLessonId(e.target.value)} className="rounded-control border border-line bg-canvas px-2 py-1 text-fg">
              <option value="">{t('noLesson')}</option>
              {lessons.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-fg-muted">
            {t('selectionLabel')}
            <textarea value={selection} onChange={e => setSelection(e.target.value)} rows={2} maxLength={4000} className="rounded-control border border-line bg-canvas px-2 py-1 text-fg" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => runAction('explain', t('actionExplain'))} className="rounded-control border border-line px-3 py-1 text-fg hover:bg-elevated disabled:opacity-50">{t('actionExplain')}</button>
            <button type="button" disabled={busy} onClick={() => runAction('simplify', t('actionSimplify'))} className="rounded-control border border-line px-3 py-1 text-fg hover:bg-elevated disabled:opacity-50">{t('actionSimplify')}</button>
            <button type="button" disabled={busy} onClick={() => runAction('summarize', t('actionSummarize'))} className="rounded-control border border-line px-3 py-1 text-fg hover:bg-elevated disabled:opacity-50">{t('actionSummarize')}</button>
          </div>
        </div>
      </details>

      <form onSubmit={e => { e.preventDefault(); void ask('chat', input) }} className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          maxLength={1000}
          placeholder={t('placeholder')}
          className="min-w-0 flex-1 rounded-control border border-line bg-canvas px-3 py-2 text-body-sm text-fg"
        />
        <button type="submit" disabled={busy || !input.trim()} className="rounded-control bg-accent px-3 py-2 text-body-sm font-semibold text-accent-fg disabled:opacity-50">
          {t('send')}
        </button>
      </form>
    </div>
  )
}
