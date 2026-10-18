'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

// Undo / redo and a local draft for the lesson editor (2026-10-18).
//
// History: every change is a step; quick successive changes (typing) within
// COALESCE_MS fold into one step, so Undo goes back a word or an action, not a
// letter. Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y work outside text fields; inside the
// rich text field its own undo takes over (TipTap).
//
// Draft: the work in progress is kept in this browser (localStorage) a moment
// after each change, so a closed tab or a lost connection loses nothing. It is
// offered back only while the saved lesson is still the one it was based on,
// and cleared once the lesson is saved.

const COALESCE_MS = 800
const LIMIT = 100
const DRAFT_DELAY_MS = 1000
const draftKey = (id: string) => `eq-lesson-draft:${id}`

export interface LessonDraft<T> { value: T; base: string; at: number }
interface History<T> { past: T[]; present: T; future: T[]; at: number }

const noSubscribe = () => () => {}

/** The draft left by an earlier visit, if it still applies (read once, on open). */
function readDraft<T>(lessonId: string, base: string, initial: T): LessonDraft<T> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(draftKey(lessonId))
    if (!raw) return null
    const d = JSON.parse(raw) as LessonDraft<T>
    return d.base === base && JSON.stringify(d.value) !== JSON.stringify(initial) ? d : null
  } catch { return null /* private mode or a broken draft */ }
}

export function useLessonHistory<T>(initial: T, opts: { lessonId: string; base: string }) {
  const [h, setH] = useState<History<T>>({ past: [], present: initial, future: [], at: 0 })
  const dirty = useRef(false)
  // Read on the client's first render; shown only after hydration (the server has no draft).
  const [found] = useState(() => readDraft(opts.lessonId, opts.base, initial))
  const [answered, setAnswered] = useState(false)
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false)

  // A draft that no longer applies is removed.
  useEffect(() => {
    if (found) return
    try { localStorage.removeItem(draftKey(opts.lessonId)) } catch { /* ignore */ }
    // Only on open; later drafts are this visit's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.lessonId])

  const set = useCallback((next: T | ((p: T) => T)) => {
    setH(prev => {
      const value = typeof next === 'function' ? (next as (p: T) => T)(prev.present) : next
      if (value === prev.present) return prev
      const now = Date.now()
      const newStep = now - prev.at > COALESCE_MS || prev.past.length === 0
      return {
        past: newStep ? [...prev.past.slice(-(LIMIT - 1)), prev.present] : prev.past,
        present: value, future: [], at: now,
      }
    })
    dirty.current = true
  }, [])

  const undo = useCallback(() => {
    setH(prev => {
      const last = prev.past.at(-1)
      if (last === undefined) return prev
      return { past: prev.past.slice(0, -1), present: last, future: [prev.present, ...prev.future], at: 0 }
    })
    dirty.current = true
  }, [])

  const redo = useCallback(() => {
    setH(prev => {
      const [next, ...rest] = prev.future
      if (next === undefined) return prev
      return { past: [...prev.past, prev.present], present: next, future: rest, at: 0 }
    })
    dirty.current = true
  }, [])

  // Keyboard, outside text fields (which keep their own undo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  // Keep the draft a moment after each change.
  const present = h.present
  useEffect(() => {
    if (!dirty.current) return
    const timer = setTimeout(() => {
      try { localStorage.setItem(draftKey(opts.lessonId), JSON.stringify({ value: present, base: opts.base, at: Date.now() } satisfies LessonDraft<T>)) } catch { /* full or private */ }
    }, DRAFT_DELAY_MS)
    return () => clearTimeout(timer)
  }, [present, opts.lessonId, opts.base])

  const draft = hydrated && found && !answered ? found : null
  const restoreDraft = useCallback(() => { if (found) { set(found.value); setAnswered(true) } }, [found, set])
  const discardDraft = useCallback(() => {
    setAnswered(true)
    try { localStorage.removeItem(draftKey(opts.lessonId)) } catch { /* ignore */ }
  }, [opts.lessonId])
  /** Call after a successful save. */
  const markSaved = useCallback(() => {
    dirty.current = false
    setAnswered(true)
    try { localStorage.removeItem(draftKey(opts.lessonId)) } catch { /* ignore */ }
  }, [opts.lessonId])

  return {
    value: present, set, undo, redo,
    canUndo: h.past.length > 0, canRedo: h.future.length > 0,
    draft, restoreDraft, discardDraft, markSaved,
  }
}
