'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { MessageSquareText, X } from 'lucide-react'
import { ProviderList, useAskAiLauncher } from './ask-ai-menu'

/** Longest passage carried to the assistant (the question is also copied in full). */
export const MAX_PASSAGE_CHARS = 1200
const MIN_PASSAGE_CHARS = 2

/**
 * "Ask about this part" (owner, 2026-10-18): the student selects a passage of
 * the lesson, a small button appears beside it, and they write THEIR OWN request
 * (nothing fixed), pick the assistant they use, and it opens with their own
 * account. Only the request, the passage and the lesson title leave.
 */
export function AskAiSelection({ containerId, lessonTitle }: { containerId: string; lessonTitle: string }) {
  const t = useTranslations('student.askAi.selection')
  const { launch, providers, hint } = useAskAiLauncher()
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null)
  const [passage, setPassage] = useState('')
  const [panel, setPanel] = useState(false)
  const [request, setRequest] = useState('')
  const [error, setError] = useState('')
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Follow the selection while the panel is closed (the panel keeps its passage).
  useEffect(() => {
    const update = () => {
      if (panel) return
      const sel = window.getSelection()
      const container = document.getElementById(containerId)
      const text = sel && !sel.isCollapsed ? sel.toString().trim() : ''
      if (!sel || !container || text.length < MIN_PASSAGE_CHARS || !sel.rangeCount) { setSpot(null); return }
      const range = sel.getRangeAt(0)
      if (!container.contains(range.commonAncestorContainer)) { setSpot(null); return }
      const r = range.getBoundingClientRect()
      const x = Math.min(Math.max(r.left + r.width / 2, 24), window.innerWidth - 24)
      setPassage(text.slice(0, MAX_PASSAGE_CHARS))
      setSpot({ x, y: Math.min(r.bottom + 8, window.innerHeight - 56) })
    }
    document.addEventListener('selectionchange', update)
    window.addEventListener('scroll', update, { passive: true })
    return () => { document.removeEventListener('selectionchange', update); window.removeEventListener('scroll', update) }
  }, [containerId, panel])

  useEffect(() => {
    if (!panel) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const onDown = (e: PointerEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) close() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown) }
  }, [panel])

  function close() { setPanel(false); setSpot(null); setRequest(''); setError('') }

  function compose(): string {
    return t('compose', { request: request.trim(), passage, title: lessonTitle })
  }

  return (
    <>
      {spot && !panel && (
        <button
          type="button"
          // Keep the selection: pressing the button must not clear it first.
          onPointerDown={e => e.preventDefault()}
          onClick={() => setPanel(true)}
          style={{ left: spot.x, top: spot.y }}
          className="eq-focus fixed z-40 -translate-x-1/2 inline-flex items-center gap-2 rounded-control bg-fg px-3 py-2 text-meta text-canvas shadow-overlay"
        >
          <MessageSquareText className="w-4 h-4" aria-hidden="true" /> {t('button')}
        </button>
      )}

      {panel && spot && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={t('title')}
          style={{ left: spot.x, top: Math.min(spot.y, window.innerHeight - 380) }}
          className="fixed z-50 w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 rounded-overlay border border-line bg-surface p-3 shadow-overlay"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-body-sm text-fg font-medium">{t('title')}</p>
            <button type="button" aria-label={t('close')} onClick={close} className="eq-focus rounded-control p-1 text-fg-muted hover:text-fg">
              <X className="w-4 h-4" />
            </button>
          </div>
          <blockquote dir="auto" className="mt-2 max-h-24 overflow-y-auto border-s-2 border-line-strong ps-2 text-meta text-fg-2">{passage}</blockquote>
          <label htmlFor="ask-ai-request" className="mt-3 block text-label text-fg-muted">{t('whatDoYouWant')}</label>
          <textarea
            id="ask-ai-request"
            dir="auto"
            rows={2}
            value={request}
            onChange={e => { setRequest(e.target.value); setError('') }}
            placeholder={t('placeholder')}
            aria-describedby={error ? 'ask-ai-request-error' : undefined}
            className="eq-focus mt-1 w-full rounded-control border border-line bg-canvas px-2 py-2 text-body-sm text-fg"
          />
          {error && <p id="ask-ai-request-error" role="alert" className="mt-1 text-meta text-danger">{error}</p>}
          <p className="mt-2 text-label text-fg-muted">{t('withWhich')}</p>
          <ProviderList
            providers={providers}
            onPick={p => {
              if (!request.trim()) { setError(t('needRequest')); return }
              const text = compose()
              close()
              void launch(p, text)
            }}
          />
          <p className="mt-1 text-label text-fg-muted">{t('ownAccount')}</p>
        </div>
      )}

      {hint}
    </>
  )
}
