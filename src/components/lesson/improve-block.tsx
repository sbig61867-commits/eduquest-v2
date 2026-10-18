'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Sparkles } from 'lucide-react'
import type { LessonBlock } from '@/lib/lesson-doc'
import { BlockView } from './lesson-view'

const ACTIONS = ['simplify', 'expand', 'example', 'fix', 'shorter'] as const

/**
 * "Improve this block" (2026-10-18): one action on one text block through
 * /api/ai/improve-block. The suggestion is shown as the student would see it;
 * nothing changes until the teacher chooses "Use it".
 */
export function ImproveBlock({ block, lessonTitle, onAccept }: {
  block: Extract<LessonBlock, { type: 'text' | 'callout' }>
  lessonTitle: string
  onAccept: (md: string) => void
}) {
  const t = useTranslations('common.lessonBuilder.improve')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function run(action: (typeof ACTIONS)[number]) {
    setOpen(false); setBusy(true); setError(''); setSuggestion(null)
    try {
      const res = await fetch('/api/ai/improve-block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: block.md, action, lessonTitle }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || typeof data.suggestion !== 'string') { setError(typeof data.error === 'string' ? data.error : t('failed')); return }
      setSuggestion(data.suggestion)
    } catch {
      setError(t('failed'))
    } finally {
      setBusy(false)
    }
  }

  if (!block.md.trim()) return null
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} disabled={busy} aria-expanded={open} aria-haspopup="menu"
        title={t('button')} aria-label={t('button')}
        className="eq-focus inline-flex items-center gap-1 h-7 px-2 rounded-control text-label text-accent hover:bg-accent-subtle disabled:opacity-60">
        <Sparkles className="w-4 h-4" aria-hidden="true" /> <span className="hidden sm:inline">{busy ? t('working') : t('button')}</span>
      </button>
      {open && (
        <div role="menu" aria-label={t('button')} className="absolute end-0 top-full z-30 mt-1 w-56 rounded-overlay border border-line bg-surface p-1 shadow-overlay">
          {ACTIONS.map(a => (
            <button key={a} type="button" role="menuitem" onClick={() => void run(a)}
              className="eq-focus block w-full rounded-control px-2 py-2 text-start text-body-sm text-fg hover:bg-elevated">
              {t(a)}
            </button>
          ))}
        </div>
      )}
      {(suggestion !== null || error) && (
        <div role="dialog" aria-label={t('suggestion')} className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-2xl rounded-overlay border border-line bg-surface p-4 shadow-overlay sm:inset-x-auto sm:start-1/2 sm:-translate-x-1/2 rtl:sm:translate-x-1/2">
          {error
            ? <p role="alert" className="text-body-sm text-danger">{error}</p>
            : (
              <>
                <p className="text-label text-fg-muted">{t('suggestion')}</p>
                <div className="mt-2 max-h-72 overflow-y-auto rounded-control border border-line bg-canvas p-3">
                  <BlockView block={{ ...block, md: suggestion ?? '' }} urls={{}} />
                </div>
              </>
            )}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => { setSuggestion(null); setError('') }}
              className="eq-focus rounded-control border border-line-strong px-3 py-1.5 text-body-sm text-fg-2 hover:text-fg">
              {error ? t('close') : t('keep')}
            </button>
            {!error && (
              <button type="button" onClick={() => { if (suggestion) onAccept(suggestion); setSuggestion(null) }}
                className="eq-focus rounded-control bg-accent px-3 py-1.5 text-body-sm text-on-accent hover:bg-accent-hover">
                {t('use')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
