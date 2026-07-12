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
        <div dir={/[؀-ۿ]/.test(message) ? 'rtl' : 'ltr'} className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 space-y-5">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${danger ? 'bg-red-600/20' : 'bg-blue-600/20'}`}>
              <span className={`text-xl font-bold ${danger ? 'text-red-400' : 'text-blue-400'}`}>!</span>
            </div>
            <p className="text-slate-200 text-sm leading-relaxed whitespace-pre-line pt-1.5">{message}</p>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => close(false)}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
            >
              {cancelText}
            </button>
            <button
              autoFocus
              onClick={() => close(true)}
              className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors ${danger ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'}`}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    )
  })
}
