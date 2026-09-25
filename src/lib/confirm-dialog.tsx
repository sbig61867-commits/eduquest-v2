'use client'

import { createRoot } from 'react-dom/client'
import arCommon from '@/messages/ar/common.json'
import enCommon from '@/messages/en/common.json'
import { dirFor, toLocale } from '@/i18n/config'

// Imperative, promise-based replacement for window.confirm() with platform
// styling. No provider needed — call `await confirmDialog(msg)` anywhere in
// a client component. A fresh portal is mounted per call and cleaned up on
// close.
export interface ConfirmOptions {
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

export function confirmDialog(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  // Unit tests stub window.confirm and expect synchronous behaviour.
  if (process.env.NODE_ENV === 'test') return Promise.resolve(window.confirm(message))

  // Imperative and mounted outside any React tree, so there is no intl
  // context here: the language is read from <html lang>, which the root
  // layout sets from the same resolved locale the page rendered with.
  const locale = toLocale(document.documentElement.lang)
  const actions = (locale === 'ar' ? arCommon : enCommon).actions
  const { confirmText = actions.confirm, cancelText = actions.cancel, danger = true } = opts

  return new Promise<boolean>(resolve => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    const close = (result: boolean) => {
      root.unmount()
      host.remove()
      resolve(result)
    }

    root.render(
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={e => { if (e.target === e.currentTarget) close(false) }}
      >
        <div dir={dirFor(locale)} className="w-full max-w-md bg-canvas border border-border rounded-2xl shadow-2xl p-6 space-y-5">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${danger ? 'bg-error-subtle' : 'bg-accent/20'}`}>
              <span className={`text-xl font-bold ${danger ? 'text-error' : 'text-info'}`}>!</span>
            </div>
            <p className="text-fg-secondary text-sm leading-relaxed whitespace-pre-line pt-1.5">{message}</p>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => close(false)}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-surface hover:bg-elevated text-fg-secondary border border-border transition-colors"
            >
              {cancelText}
            </button>
            <button
              autoFocus
              onClick={() => close(true)}
              className={`px-4 py-2 rounded-lg text-sm font-medium text-accent-fg transition-colors ${danger ? 'bg-error hover:opacity-90' : 'bg-accent hover:bg-accent-hover'}`}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    )
  })
}
