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
        className="eq-focus inline-flex h-9 items-center gap-2 ps-2.5 pe-2 rounded-full border border-line bg-surface text-body-sm font-medium text-fg shadow-sm hover:border-line-strong hover:bg-elevated transition-colors"
      >
        {/* Globe: the universal language mark. */}
        <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4 text-fg-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
        <span lang={active}>{LOCALE_LABEL[active]}</span>
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
          className={`absolute top-full mt-2 z-50 min-w-48 p-1.5 rounded-overlay border border-line bg-surface shadow-overlay ${hang === 'start' ? 'start-0' : 'end-0'}`}
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
              className={`eq-focus flex w-full items-center gap-3 px-3 py-2.5 rounded-control text-body-sm hover:bg-elevated focus-visible:bg-elevated ${l === active ? 'text-fg font-semibold' : 'text-fg-2'}`}
            >
              {/* Decorative code badge, drawn from data-code by CSS so the item text stays the language name. */}
              <span aria-hidden="true" data-code={l.toUpperCase()} className="eq-locale-code w-8 text-center rounded-control bg-elevated py-0.5 text-xs font-semibold text-fg-3" />
              <span className="flex-1 text-start">{LOCALE_LABEL[l]}</span>
              <svg aria-hidden="true" viewBox="0 0 24 24" className={`w-4 h-4 text-accent ${l === active ? '' : 'invisible'}`} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="m5 12 5 5 9-10" />
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
