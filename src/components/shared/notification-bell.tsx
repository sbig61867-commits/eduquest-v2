'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, BookOpen, ClipboardList, BarChart2, Send, UserPlus, Mail, Building2 } from 'lucide-react'
import { formatDate } from '@/lib/utils'

interface Notif { id: string; type: string; title: string; subtitle: string; date: string; href: string }

const ICONS: Record<string, typeof Bell> = {
  lesson: BookOpen, exam: ClipboardList, grade: BarChart2,
  submission: Send, user: UserPlus, message: Mail, tenant: Building2,
}
const COLORS: Record<string, string> = {
  lesson: 'bg-violet-600/20 text-violet-400', exam: 'bg-amber-600/20 text-amber-400',
  grade: 'bg-emerald-600/20 text-emerald-400', submission: 'bg-blue-600/20 text-blue-400',
  user: 'bg-cyan-600/20 text-cyan-400', message: 'bg-pink-600/20 text-pink-400',
  tenant: 'bg-indigo-600/20 text-indigo-400',
}
const SEEN_KEY = 'eq_notif_seen_at'

export function NotificationBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notif[]>([])
  const [loading, setLoading] = useState(false)
  const [seenAt, setSeenAt] = useState<number>(0)
  const ref = useRef<HTMLDivElement>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/notifications')
      if (res.ok) setItems((await res.json()).notifications ?? [])
    } catch { /* ignore */ }
    setLoading(false)
  }

  // Initial fetch (for the unread badge) + read the last-seen timestamp.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading localStorage must happen client-side (no SSR value); synchronous setState here is intentional
    setSeenAt(Number(localStorage.getItem(SEEN_KEY) ?? 0))
    load()
    const t = setInterval(load, 60_000) // refresh badge every minute
    return () => clearInterval(t)
  }, [])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const unread = items.filter(n => new Date(n.date).getTime() > seenAt).length

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) {
      load()
      const now = Date.now()
      localStorage.setItem(SEEN_KEY, String(now))
      setSeenAt(now)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={toggle} aria-label="Notifications"
        className="relative p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        // Pin the panel to the viewport's right edge (LTR anchor) so it never
        // spills off-screen regardless of the page's RTL/LTR direction; on
        // mobile it spans almost the full width with a small margin.
        <div className="fixed sm:absolute top-16 sm:top-auto sm:mt-2 right-3 sm:right-0 sm:left-auto w-[calc(100vw-1.5rem)] sm:w-80 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden z-50" dir="rtl">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <span className="text-white font-semibold text-sm">الإشعارات</span>
            {loading && <span className="text-slate-500 text-xs">تحديث...</span>}
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Bell className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-slate-400 text-sm">لا توجد إشعارات بعد</p>
              </div>
            ) : items.map(n => {
              const Icon = ICONS[n.type] ?? Bell
              const isNew = new Date(n.date).getTime() > seenAt
              return (
                <button key={n.id}
                  onClick={() => { setOpen(false); router.push(n.href) }}
                  className={`w-full text-start flex items-start gap-3 px-4 py-3 border-b border-slate-800/60 hover:bg-slate-800/50 transition-colors ${isNew ? 'bg-slate-800/30' : ''}`}>
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${COLORS[n.type] ?? 'bg-slate-700 text-slate-300'}`}>
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-white text-sm truncate">{n.title}</span>
                    {n.subtitle && <span className="block text-slate-400 text-xs truncate">{n.subtitle}</span>}
                    <span className="block text-slate-500 text-[11px] mt-0.5">{formatDate(n.date)}</span>
                  </span>
                  {isNew && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 mt-1.5" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
