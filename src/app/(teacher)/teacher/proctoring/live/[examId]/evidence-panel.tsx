'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, X, Clock } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import type { EvidenceItem } from '@/app/api/proctor/evidence/route'

// Violation snapshots of THIS exam, next to the live wall. Snapshots live
// outside Supabase for 30 hours only (src/lib/evidence-keys.ts).
//
// Refreshed when it matters, not on a timer: `refreshSignal` is the total
// snapshot count the students report on the exam's live channel, so the list
// reloads as soon as a new snapshot is stored. A slow fallback poll covers a
// dropped channel and keeps the 10-minute signed links fresh.

const FALLBACK_POLL_MS = 2 * 60_000
const MIN_GAP_MS = 3_000
const HOUR_MS = 60 * 60 * 1000

type State =
  | { kind: 'loading' }
  | { kind: 'disabled' }
  | { kind: 'error' }
  | { kind: 'ready'; items: EvidenceItem[]; ttlHours: number }

export function EvidencePanel({ examId, refreshSignal = 0 }: { examId: string; refreshSignal?: number }) {
  const t = useTranslations('teacher.live.evidence')
  const locale = useLocale()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [open, setOpen] = useState<EvidenceItem | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const loadRef = useRef<() => void>(() => {})
  const lastLoadRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      lastLoadRef.current = Date.now()
      try {
        const res = await fetch(`/api/proctor/evidence?examId=${examId}`, { cache: 'no-store' })
        if (!res.ok) throw new Error(String(res.status))
        const data = await res.json() as { configured: boolean; ttlHours: number; items: EvidenceItem[] }
        if (cancelled) return
        setNow(Date.now())
        setState(data.configured ? { kind: 'ready', items: data.items, ttlHours: data.ttlHours } : { kind: 'disabled' })
      } catch {
        if (!cancelled) setState(prev => (prev.kind === 'ready' ? prev : { kind: 'error' }))
      }
    }
    loadRef.current = () => { load() }
    load()
    const id = window.setInterval(load, FALLBACK_POLL_MS)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [examId])

  // A new snapshot was stored somewhere in the exam → reload (debounced).
  useEffect(() => {
    if (refreshSignal === 0) return
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastLoadRef.current))
    const id = window.setTimeout(() => loadRef.current(), wait + 500)
    return () => window.clearTimeout(id)
  }, [refreshSignal])

  // Close the enlarged view with Escape.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const time = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-u-nu-latn' : 'en-GB', { hour: '2-digit', minute: '2-digit' })
  const typeLabel = (type: string) => (t.has(`types.${type}`) ? t(`types.${type}`) : type)
  const hoursLeft = (item: EvidenceItem) => Math.max(0, Math.floor((new Date(item.expiresAt).getTime() - now) / HOUR_MS))

  return (
    <aside className="bg-slate-900 border border-slate-800 rounded-xl p-4 xl:sticky xl:top-4">
      <div className="flex items-center gap-2">
        <Camera className="w-4 h-4 text-amber-400" />
        <h3 className="text-white font-semibold">{t('title')}</h3>
        {state.kind === 'ready' && state.items.length > 0 && (
          <span className="ms-auto text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 tabular-nums">{state.items.length}</span>
        )}
      </div>
      {state.kind === 'ready' && <p className="text-slate-500 text-xs mt-1.5 leading-relaxed">{t('note', { hours: state.ttlHours })}</p>}

      <div className="mt-4">
        {state.kind === 'loading' && <div className="h-24 rounded-lg bg-slate-800/60 animate-pulse" />}
        {state.kind === 'disabled' && <p className="text-slate-400 text-sm leading-relaxed">{t('disabled')}</p>}
        {state.kind === 'error' && <p className="text-red-400 text-sm">{t('loadError')}</p>}
        {state.kind === 'ready' && state.items.length === 0 && <p className="text-slate-400 text-sm leading-relaxed">{t('empty')}</p>}
        {state.kind === 'ready' && state.items.length > 0 && (
          <ul className="grid grid-cols-2 xl:grid-cols-1 gap-3 max-h-[70vh] overflow-y-auto pe-1">
            {state.items.map(item => (
              <li key={item.url}>
                <button
                  type="button"
                  onClick={() => setOpen(item)}
                  aria-label={t('enlarge')}
                  className="w-full text-start rounded-lg border border-slate-800 bg-slate-950 overflow-hidden hover:border-amber-500/50 transition-colors"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from the external evidence bucket; next/image would proxy and cache it */}
                  <img src={item.url} alt="" loading="lazy" className="w-full aspect-[4/3] object-cover bg-slate-800" />
                  <div className="p-2.5 space-y-1">
                    <p className="text-white text-sm font-medium truncate">{item.studentName}</p>
                    <p className="text-amber-300 text-xs">{typeLabel(item.type)}</p>
                    <p className="flex items-center justify-between gap-2 text-slate-500 text-[11px]">
                      <span className="tabular-nums">{time.format(new Date(item.capturedAt))}</span>
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{t('expiresIn', { hours: hoursLeft(item) })}</span>
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {open && (
        <div role="dialog" aria-modal="true" aria-label={t('title')} onClick={() => setOpen(null)}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div onClick={e => e.stopPropagation()} className="relative max-w-2xl w-full bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
            <button type="button" onClick={() => setOpen(null)} aria-label={t('close')}
              className="absolute top-2 end-2 p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80">
              <X className="w-4 h-4" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
            <img src={open.url} alt="" className="w-full aspect-[4/3] object-contain bg-black" />
            <div className="p-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-white font-semibold">{open.studentName}</p>
                <p className="text-amber-300 text-sm">{typeLabel(open.type)}</p>
              </div>
              <p className="text-slate-400 text-sm tabular-nums">{time.format(new Date(open.capturedAt))}</p>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
