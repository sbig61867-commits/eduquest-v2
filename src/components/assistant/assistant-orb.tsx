'use client'

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { OrbGraphic } from './orb-graphic'
import { LessonSummaryView } from './lesson-summary-view'
import { AssistantChat } from './assistant-chat'
import type { Nudge, PlanItem } from '@/lib/assistant/nudges'
import type { LessonSummary } from '@/lib/assistant/lesson-summary'
import type { AssistantLesson } from '@/lib/data/assistant-nudges'

// The study assistant on every student page: an animated orb in the corner.
// Short "cloud" messages rise from it one at a time — deadlines, revision before
// an exam, the week's plan, new lessons and announcements — then fade, and the
// next one follows. Pressing the orb opens the assistant on a screen of its
// own (full screen since 2026-10-18: the corner panel was too small on laptops
// and unusable on phones): Today, Study plan, Lesson summary and Ask.
//
// Nudges, plan and summaries come from the student's own data through their
// session and never reach an AI provider. Only the Ask tab talks to a provider,
// and only when one is approved for personal content (privacy.ts).

export const ORB_TIMING = {
  /** Wait after the page settles before asking for the briefing. */
  fetchDelay: 1200,
  /** Before the very first message. */
  firstDelay: 1500,
  /** How long one message stays. */
  show: 5500,
  /** Between two messages. */
  gap: 1500,
  /** After the last message, before starting over. */
  roundRest: 20000,
} as const

/** Per-viewer convenience only: the student chose to silence the messages this session. */
const QUIET_KEY = 'eq-orb-quiet'

type Tab = 'today' | 'plan' | 'summary' | 'ask'
const TABS: Tab[] = ['today', 'plan', 'summary', 'ask']
const ACTIONABLE = new Set<Nudge['kind']>(['due', 'review', 'examSoon', 'plan', 'announcement', 'announcements', 'lesson'])

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)'
const reduceMotionQuery = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(REDUCE_QUERY) : null)

function subscribeReducedMotion(onChange: () => void) {
  const mq = reduceMotionQuery()
  mq?.addEventListener?.('change', onChange)
  return () => mq?.removeEventListener?.('change', onChange)
}

/** Still on the server and during hydration; follows the system setting after. */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, () => !!reduceMotionQuery()?.matches, () => false)
}

/** Silenced earlier this session? (No sessionStorage on the server: not silenced.) */
function readQuiet(): boolean {
  try { return sessionStorage.getItem(QUIET_KEY) === '1' } catch { return false }
}

export function AssistantOrb({ chatEnabled }: { chatEnabled: boolean }) {
  const t = useTranslations('student.assistant.orb')
  const reduceMotion = usePrefersReducedMotion()
  const panelId = useId()
  const orbRef = useRef<HTMLButtonElement>(null)

  const [nudges, setNudges] = useState<Nudge[]>([])
  const [plan, setPlan] = useState<PlanItem[]>([])
  const [lessons, setLessons] = useState<AssistantLesson[]>([])
  const [loaded, setLoaded] = useState(false)

  const [index, setIndex] = useState(0)
  const [shown, setShown] = useState(0)
  const [bubbleVisible, setBubbleVisible] = useState(false)
  const [hovered, setHovered] = useState(false)
  // Nothing that depends on it renders before the briefing arrives, so reading
  // it on the first client render cannot change the hydrated markup.
  const [quiet, setQuiet] = useState(readQuiet)

  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('today')
  const [summaries, setSummaries] = useState<Record<string, LessonSummary>>({})
  const [summaryFor, setSummaryFor] = useState<string | null>(null)
  const [summaryState, setSummaryState] = useState<'idle' | 'loading' | 'error'>('idle')

  // One briefing per mounted layout (client navigation keeps it), asked for
  // after the page has rendered so it never delays it.
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      fetch('/api/assistant/student/briefing')
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
          if (cancelled || !data) return
          setNudges(Array.isArray(data.nudges) ? data.nudges : [])
          setPlan(Array.isArray(data.plan) ? data.plan : [])
          setLessons(Array.isArray(data.lessons) ? data.lessons : [])
        })
        .catch(() => { /* the orb stays, without messages */ })
        .finally(() => { if (!cancelled) setLoaded(true) })
    }, ORB_TIMING.fetchDelay)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])

  // The message cycle: show → fade → next. Paused while hovered or focused,
  // stopped while the panel is open or after the student silences it.
  const cycling = loaded && nudges.length > 0 && !open && !quiet
  useEffect(() => {
    if (!cycling || hovered) return
    if (bubbleVisible) {
      const timer = setTimeout(() => {
        setBubbleVisible(false)
        setIndex(i => (i + 1) % nudges.length)
        setShown(c => c + 1)
      }, ORB_TIMING.show)
      return () => clearTimeout(timer)
    }
    const wait = shown === 0 ? ORB_TIMING.firstDelay : index === 0 ? ORB_TIMING.roundRest : ORB_TIMING.gap
    const timer = setTimeout(() => setBubbleVisible(true), wait)
    return () => clearTimeout(timer)
  }, [cycling, hovered, bubbleVisible, index, shown, nudges.length])

  // Escape closes the assistant and gives focus back to the orb. While it is
  // open the page under it does not scroll.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); orbRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow }
  }, [open])

  const silence = useCallback(() => {
    setQuiet(true)
    setBubbleVisible(false)
    try { sessionStorage.setItem(QUIET_KEY, '1') } catch { /* fine: silenced for this page only */ }
  }, [])

  const openSummary = useCallback(async (lessonId: string) => {
    setOpen(true)
    setTab('summary')
    setSummaryFor(lessonId)
    if (summaries[lessonId]) { setSummaryState('idle'); return }
    setSummaryState('loading')
    try {
      const res = await fetch(`/api/assistant/student/summary?lessonId=${encodeURIComponent(lessonId)}`)
      const data = res.ok ? await res.json() : null
      if (!data?.summary) throw new Error('no summary')
      setSummaries(s => ({ ...s, [lessonId]: data.summary as LessonSummary }))
      setSummaryState('idle')
    } catch {
      setSummaryState('error')
    }
  }, [summaries])

  const openTab = (next: Tab) => { setOpen(true); setTab(next) }

  // "Open" links (2026-10-17): on a phone's slower link the page took seconds
  // to arrive with no visible change, so students tapped again, and each tap
  // aborted and restarted the request. The pages a nudge can open are fetched
  // as soon as the panel opens, and a tap closes the panel at once, so the tap
  // is acknowledged and the page is (mostly) already there. No loading UI.
  const router = useRouter()
  const hrefs = nudges.map(n => n.href).filter((h): h is string => !!h).join('|')
  useEffect(() => {
    if (!open || !hrefs) return
    for (const h of new Set(hrefs.split('|'))) router.prefetch(h)
  }, [open, hrefs, router])
  const current = nudges[index % Math.max(1, nudges.length)]
  const nudgeText = (n: Nudge) => t(`nudge.${n.kind}`, n.params)
  const count = nudges.filter(n => ACTIONABLE.has(n.kind)).length
  const activeSummary = summaryFor ? summaries[summaryFor] : undefined

  const nudgeActions = (n: Nudge, compact: boolean) => (
    <div className={`flex flex-wrap gap-2 ${compact ? 'mt-1.5' : 'mt-1'}`}>
      {n.lessonId && (
        <button
          type="button"
          onClick={() => void openSummary(n.lessonId as string)}
          className="rounded-control bg-accent px-2 py-0.5 text-label text-accent-fg hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-focus"
        >
          {t('summarize')}
        </button>
      )}
      {n.kind === 'plan' && (
        <button
          type="button"
          onClick={() => openTab('plan')}
          className="rounded-control border border-line px-2 py-0.5 text-label text-fg hover:bg-elevated focus-visible:ring-2 focus-visible:ring-focus"
        >
          {t('tabs.plan')}
        </button>
      )}
      {n.href && (
        <Link
          href={n.href}
          onClick={() => setOpen(false)}
          className="rounded-control border border-line px-2 py-0.5 text-label text-fg hover:bg-elevated focus-visible:ring-2 focus-visible:ring-focus"
        >
          {t('open')}
        </Link>
      )}
    </div>
  )

  return (
    <>
      <div className="fixed bottom-4 end-4 z-40 flex flex-col items-end print:hidden">
        {cycling && current && (
          <div
            className={`mb-1 flex flex-col items-end transition duration-300 ease-out motion-reduce:transition-none ${bubbleVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-1 opacity-0'}`}
            aria-hidden={!bubbleVisible}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocus={() => setHovered(true)}
            onBlur={() => setHovered(false)}
            data-testid="orb-bubble"
          >
            <div aria-live="polite" className="relative w-max max-w-[min(17rem,calc(100vw-6rem))] rounded-overlay border border-line bg-surface px-3 py-2 shadow-overlay">
              <p className="pe-5 text-body-sm text-fg">{nudgeText(current)}</p>
              {nudgeActions(current, true)}
              <button
                type="button"
                onClick={silence}
                aria-label={t('dismiss')}
                tabIndex={bubbleVisible ? 0 : -1}
                className="absolute end-1 top-1 rounded-control p-0.5 text-fg-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-focus"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            {/* the cloud's tail: two small puffs towards the orb */}
            <span aria-hidden="true" className="me-10 mt-1 h-2.5 w-2.5 rounded-full border border-line bg-surface" />
            <span aria-hidden="true" className="me-7 mt-0.5 h-1.5 w-1.5 rounded-full border border-line bg-surface" />
          </div>
        )}

        <button
          ref={orbRef}
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-label={t('openPanel')}
          aria-expanded={open}
          aria-controls={panelId}
          className="relative h-16 w-16 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:h-[4.5rem] sm:w-[4.5rem]"
        >
          <OrbGraphic animated={!reduceMotion} />
          {count > 0 && !open && (
            <span className="absolute -end-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-label text-on-accent">
              {count}
            </span>
          )}
        </button>
      </div>

      {open && (
        <section
          id={panelId}
          role="dialog"
          aria-modal="true"
          aria-label={t('label')}
          className="fixed inset-0 z-50 flex flex-col bg-canvas print:hidden"
        >
          <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-3 p-4 sm:p-6">
          <header className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="h-9 w-9"><OrbGraphic animated={false} /></span>
              <h2 className="text-h3 text-fg">{t('label')}</h2>
            </div>
            <button
              type="button"
              onClick={() => { setOpen(false); orbRef.current?.focus() }}
              aria-label={t('closePanel')}
              className="rounded-control p-2 text-fg-muted hover:bg-elevated hover:text-fg focus-visible:ring-2 focus-visible:ring-focus"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </header>

          <div role="tablist" aria-label={t('label')} className="flex gap-1 overflow-x-auto border-b border-line">
            {TABS.map(k => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-body focus-visible:ring-2 focus-visible:ring-focus ${tab === k ? 'border-accent font-semibold text-fg' : 'border-transparent text-fg-muted hover:text-fg'}`}
              >
                {t(`tabs.${k}`)}
              </button>
            ))}
          </div>

          {/* Ask scrolls its own conversation; the other tabs scroll here. One scrollbar either way. */}
          <div role="tabpanel" className={`flex min-h-0 flex-1 flex-col ${tab === 'ask' ? '' : 'overflow-y-auto pe-1'}`}>
            {tab === 'today' && (
              nudges.length === 0
                ? <p className="text-body-sm text-fg-2">{loaded ? t('nudge.welcome') : t('loading')}</p>
                : (
                  <ul className="flex flex-col gap-2">
                    {nudges.map(n => (
                      <li key={n.id} className="rounded-control border border-line bg-elevated px-3 py-2">
                        <p className="text-body-sm text-fg">{nudgeText(n)}</p>
                        {nudgeActions(n, false)}
                      </li>
                    ))}
                  </ul>
                )
            )}

            {tab === 'plan' && (
              plan.length === 0
                ? <p className="text-body-sm text-fg-2">{t('plan.empty')}</p>
                : (
                  <div className="flex flex-col gap-2">
                    <p className="text-body-sm text-fg-2">{t('plan.intro')}</p>
                    <ol className="flex flex-col gap-2">
                      {plan.map(p => (
                        <li key={p.examId} className="rounded-control border border-line px-3 py-2">
                          <p className="text-body-sm font-semibold text-fg">{p.title}</p>
                          <p className="text-meta text-fg-2">{t(`plan.${p.event}`, { type: p.type, days: p.days })}</p>
                          <p className="text-meta text-accent">{t('plan.reviewFrom', { days: p.reviewInDays })}</p>
                          {p.lessonId && (
                            <button
                              type="button"
                              onClick={() => void openSummary(p.lessonId as string)}
                              className="mt-1 rounded-control border border-line px-2 py-0.5 text-label text-fg hover:bg-elevated focus-visible:ring-2 focus-visible:ring-focus"
                            >
                              {t('plan.summarizeLesson', { lesson: p.lesson ?? '' })}
                            </button>
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                )
            )}

            {tab === 'summary' && (
              summaryFor && summaryState === 'loading'
                ? <p className="text-body-sm text-fg-muted" role="status">{t('summary.loading')}</p>
                : summaryFor && summaryState === 'error'
                  ? (
                    <div className="flex flex-col gap-2">
                      <p className="text-body-sm text-danger">{t('summary.error')}</p>
                      <button type="button" onClick={() => setSummaryFor(null)} className="self-start rounded-control border border-line px-2 py-0.5 text-label text-fg hover:bg-elevated">{t('summary.back')}</button>
                    </div>
                  )
                  : summaryFor && activeSummary
                    ? (
                      <div className="flex flex-col gap-3">
                        <button type="button" onClick={() => setSummaryFor(null)} className="self-start rounded-control border border-line px-2 py-0.5 text-label text-fg hover:bg-elevated">{t('summary.back')}</button>
                        <LessonSummaryView lessonId={summaryFor} summary={activeSummary} />
                      </div>
                    )
                    : lessons.length === 0
                      ? <p className="text-body-sm text-fg-2">{t('summary.noLessons')}</p>
                      : (
                        <div className="flex flex-col gap-2">
                          <p className="text-body-sm text-fg-2">{t('summary.pick')}</p>
                          <ul className="flex flex-col gap-1.5">
                            {lessons.map(l => (
                              <li key={l.id}>
                                <button
                                  type="button"
                                  onClick={() => void openSummary(l.id)}
                                  className="w-full rounded-control border border-line px-3 py-2 text-start text-body-sm text-fg hover:bg-elevated focus-visible:ring-2 focus-visible:ring-focus"
                                >
                                  {l.title}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )
            )}

            {tab === 'ask' && (
              chatEnabled
                ? <AssistantChat lessons={lessons} />
                : (
                  <div className="flex flex-col gap-2">
                    <p className="text-body-sm text-fg-2">{t('ask.paused')}</p>
                    <button type="button" onClick={() => setTab('summary')} className="self-start rounded-control bg-accent px-3 py-1 text-body-sm font-semibold text-accent-fg hover:bg-accent-hover">{t('ask.toSummary')}</button>
                  </div>
                )
            )}
          </div>
          </div>
        </section>
      )}
    </>
  )
}
