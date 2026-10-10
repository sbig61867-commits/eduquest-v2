'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { LOCALES, LOCALE_LABEL, type Locale } from '@/i18n/config'

// Language picker: a compact button showing the current language code; it
// opens a small menu listing every language. Keyboard: Enter/Space or ArrowDown
// opens, arrows move, Enter picks, Escape or Tab closes and returns focus.
// What a pick does is the caller's business (navigate, cookie, or reload).
// The menu is LTR-fixed so it does not flip sides with the page direction.
export function LocaleToggle({ active, onPick }: { active: Locale; onPick: (l: Locale) => void }) {
  const t = useTranslations('common.locale')
  const [open, setOpen] = useState(false)
  // Which edge the menu hangs from: whichever side of the button has room.
  const [hang, setHang] = useState<'start' | 'end'>('end')
  const id = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function pick(l: Locale) {
    setOpen(false)
    buttonRef.current?.focus()
    if (l !== active) onPick(l)
  }

  function onMenuKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape' || e.key === 'Tab') { setOpen(false); buttonRef.current?.focus(); return }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[next]?.focus()
    }
  }

  return (
    <div ref={wrapRef} className="relative" dir="ltr">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`${t('switchLabel')}: ${LOCALE_LABEL[active]}`}
        onClick={() => {
          if (!open) {
            const r = buttonRef.current?.getBoundingClientRect()
            setHang(r && r.left < 180 ? 'start' : 'end')
          }
          setOpen(v => !v)
        }}
        onKeyDown={e => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true) } }}
        className="eq-focus inline-flex h-8 items-center gap-1.5 px-2.5 rounded-control bg-elevated text-label font-semibold tracking-wide text-fg hover:bg-line transition-colors"
      >
        <span lang={active}>{active.toUpperCase()}</span>
        <svg aria-hidden="true" viewBox="0 0 24 24" className={`w-3.5 h-3.5 text-fg-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          id={id}
          role="menu"
          aria-label={t('switchLabel')}
          onKeyDown={onMenuKey}
          onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false) }}
          className={`absolute top-full mt-1.5 z-50 min-w-40 p-1 rounded-overlay border border-line-strong bg-surface shadow-overlay ${hang === 'start' ? 'start-0' : 'end-0'}`}
        >
          {LOCALES.map(l => (
            <button
              key={l}
              type="button"
              role="menuitemradio"
              aria-checked={l === active}
              lang={l}
              autoFocus={l === active}
              onClick={() => pick(l)}
              className="eq-focus flex w-full items-center justify-between gap-6 px-3 py-2 rounded-control text-body-sm text-fg hover:bg-elevated focus-visible:bg-elevated"
            >
              <span>{LOCALE_LABEL[l]}</span>
              {l === active && <span aria-hidden="true" className="text-accent font-bold">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
