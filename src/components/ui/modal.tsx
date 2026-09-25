'use client'

import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  }

  return (
    // `overflow-y-auto` + `my-auto` instead of `items-center`: a flex item
    // centred with `items-center` in a non-scrolling fixed overlay overflows
    // EQUALLY above and below when it is taller than the viewport, and the
    // part above the top edge cannot be scrolled to. Measured on a 375x812
    // phone box: a 984px-tall modal rendered at -70..914, putting its action
    // buttons 69px below the screen with no way to reach them — every
    // "Create"/"Save"/"Cancel" button in the app was unreachable on a phone
    // for any modal taller than the screen. `my-auto` still centres it when
    // it fits, and lets the overlay scroll when it does not.
    <div className="fixed inset-0 z-50 flex justify-center p-4 overflow-y-auto overscroll-contain">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={cn('relative my-auto bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full', sizes[size])}>
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <h3 className="text-white font-semibold text-lg">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
