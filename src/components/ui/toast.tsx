'use client'

import { useState, useCallback, useEffect } from 'react'
import { CheckCircle, XCircle, AlertTriangle, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type ToastType = 'success' | 'error' | 'warning'

interface Toast {
  id: number
  message: string
  type: ToastType
}

// Global emitter — works across the component tree without a context provider
const listeners = new Set<(t: Toast) => void>()
let nextId = 0

export function toast(message: string, type: ToastType = 'success') {
  const t: Toast = { id: ++nextId, message, type }
  listeners.forEach(fn => fn(t))
}
toast.success = (msg: string) => toast(msg, 'success')
toast.error   = (msg: string) => toast(msg, 'error')
toast.warning = (msg: string) => toast(msg, 'warning')

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle  className="w-4 h-4 text-emerald-400 shrink-0" />,
  error:   <XCircle      className="w-4 h-4 text-red-400 shrink-0"     />,
  warning: <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0"  />,
}
const BORDERS: Record<ToastType, string> = {
  success: 'border-emerald-500/30',
  error:   'border-red-500/30',
  warning: 'border-amber-500/30',
}

function ToastItem({ toast: t, onRemove }: { toast: Toast; onRemove: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onRemove(t.id), 4000)
    return () => clearTimeout(timer)
  }, [t.id, onRemove])

  return (
    <div className={cn(
      'flex items-start gap-3 px-4 py-3 bg-slate-900 border rounded-xl shadow-2xl',
      'animate-in slide-in-from-bottom-2 fade-in duration-200',
      BORDERS[t.type],
    )}>
      {ICONS[t.type]}
      <p className="text-sm text-slate-200 leading-snug flex-1">{t.message}</p>
      <button onClick={() => onRemove(t.id)} className="text-slate-500 hover:text-white transition-colors ml-1">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const remove = useCallback((id: number) => setToasts(prev => prev.filter(t => t.id !== id)), [])

  useEffect(() => {
    const fn = (t: Toast) => setToasts(prev => [...prev.slice(-4), t])
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])

  if (!toasts.length) return null

  return (
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
      {toasts.map(t => <ToastItem key={t.id} toast={t} onRemove={remove} />)}
    </div>
  )
}
