'use client'

import { createRoot } from 'react-dom/client'

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

  const { confirmText = 'تأكيد', cancelText = 'إلغاء', danger = true } = opts

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
        <div dir={/[؀-ۿ]/.test(message) ? 'rtl' : 'ltr'} className="w-full max-w-md bg-canvas border border-border rounded-2xl shadow-2xl p-6 space-y-5">
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
