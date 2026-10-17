'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Sparkles, ExternalLink, X } from 'lucide-react'
import { LOCALE_DIR, type Locale } from '@/i18n/config'
import { ASK_AI_PROVIDERS, askAiUrl, popupFeatures, type AskAiIntent, type AskAiProvider } from '@/lib/ask-ai'

/** How long the "open it in a normal window" hint stays. */
export const HINT_MS = 4000
const PREFERRED_KEY = 'eq_ask_ai_provider'
const INTENTS: AskAiIntent[] = ['explain', 'quiz', 'stuck']

/**
 * "Ask an AI about this lesson": the student picks an assistant they already
 * use (their own account, their own cost), and it opens in a pop-up beside the
 * platform with the question ready. A short hint then offers a normal window.
 */
export function AskAiMenu({ lessonTitle, groupName }: { lessonTitle: string; groupName?: string | null }) {
  const t = useTranslations('student.askAi')
  const locale = useLocale() as Locale
  const [open, setOpen] = useState(false)
  const [intent, setIntent] = useState<AskAiIntent>('explain')
  const [hint, setHint] = useState<{ provider: AskAiProvider; url: string; copied: boolean } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  function question(): string {
    return t(`prompt.${intent}`, { title: lessonTitle, group: groupName || t('prompt.noGroup') })
  }

  async function ask(provider: AskAiProvider) {
    const text = question()
    const url = askAiUrl(provider, text)
    // Always copy: the URL prefill is unofficial, and some sites have none.
    let copied = false
    try { await navigator.clipboard.writeText(text); copied = true } catch { /* the prefill may still work */ }
    window.open(url, 'tilmoo-ask-ai', popupFeatures(window.screen.availWidth, window.screen.availHeight, LOCALE_DIR[locale] === 'rtl'))
    try { localStorage.setItem(PREFERRED_KEY, provider.id) } catch { /* private mode */ }
    setOpen(false)
    setHint({ provider, url, copied })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setHint(null), HINT_MS)
  }

  function openNormal() {
    if (!hint) return
    // The platform's COOP header cuts the link to the pop-up, so it cannot be
    // closed from here; the hint tells the student they may close it.
    window.open(hint.url, '_blank', 'noopener')
    setHint(null)
  }

  let preferred: string | null = null
  try { preferred = typeof window !== 'undefined' ? localStorage.getItem(PREFERRED_KEY) : null } catch { /* ignore */ }
  const providers = [...ASK_AI_PROVIDERS].sort((a, b) => (a.id === preferred ? -1 : b.id === preferred ? 1 : 0))

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('button')}
        title={t('button')}
        className="eq-focus inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-control border border-line px-2 py-2 sm:px-3 text-body-sm text-fg hover:bg-elevated"
      >
        {/* Phones: icon only, so the lesson title keeps the header. */}
        <Sparkles className="w-4 h-4" aria-hidden="true" /> <span className="hidden sm:inline">{t('button')}</span>
      </button>

      {open && (
        <div role="menu" aria-label={t('button')} className="absolute end-0 top-full z-30 mt-2 w-72 rounded-overlay border border-line bg-surface p-3 shadow-overlay">
          <p className="text-label text-fg-muted">{t('whatFor')}</p>
          <div role="radiogroup" aria-label={t('whatFor')} className="mt-2 flex flex-wrap gap-2">
            {INTENTS.map(i => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={intent === i}
                onClick={() => setIntent(i)}
                className={`eq-focus rounded-control border px-2 py-1 text-meta ${intent === i ? 'border-fg bg-fg text-canvas' : 'border-line text-fg-2 hover:bg-elevated'}`}
              >
                {t(`intent.${i}`)}
              </button>
            ))}
          </div>
          <p className="mt-3 text-label text-fg-muted">{t('withWhich')}</p>
          <ul className="mt-1">
            {providers.map(p => (
              <li key={p.id}>
                <button type="button" role="menuitem" onClick={() => void ask(p)} className="eq-focus flex w-full items-center justify-between rounded-control px-2 py-2 text-body-sm text-fg hover:bg-elevated">
                  <span>{p.name}</span>
                  {!p.prefill && <span className="text-label text-fg-muted">{t('pasteNeeded')}</span>}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-label text-fg-muted">{t('ownAccount')}</p>
        </div>
      )}

      {hint && (
        <div role="status" className="fixed bottom-24 start-4 z-50 flex max-w-sm items-start gap-3 rounded-overlay border border-line bg-surface p-4 shadow-overlay">
          <div className="min-w-0 flex-1">
            <p className="text-body-sm text-fg">{t('opened', { name: hint.provider.name })}</p>
            <p className="mt-1 text-meta text-fg-muted">
              {hint.provider.prefill ? (hint.copied ? t('copiedToo') : '') : (hint.copied ? t('pasteIt') : t('copyFailed'))}
            </p>
            <button type="button" onClick={openNormal} className="eq-focus mt-2 inline-flex items-center gap-1 rounded-control bg-fg px-3 py-1 text-meta text-canvas">
              <ExternalLink className="w-3 h-3" aria-hidden="true" /> {t('openNormal')}
            </button>
          </div>
          <button type="button" aria-label={t('dismiss')} onClick={() => setHint(null)} className="eq-focus rounded-control p-1 text-fg-muted hover:text-fg">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}
