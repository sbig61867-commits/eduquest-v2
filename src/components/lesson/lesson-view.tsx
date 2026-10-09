'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import {
  Check, ChevronDown, ChevronLeft, ExternalLink, Info, Lightbulb, AlertTriangle, Bookmark,
  Map as MapIcon, Volume2, Languages, RotateCcw, X, ZoomIn,
} from 'lucide-react'
import { Markdown } from '@/components/shared/markdown'
import { InteractiveQuiz, speak } from '@/components/shared/lesson-tabs'
import { parseVideoUrl } from '@/lib/video-embed'
import {
  imagePaths, lessonOutline, parseLessonContent, type CalloutTone, type LessonBlock, type LessonDoc, type MapNode,
} from '@/lib/lesson-doc'
import { cn } from '@/lib/utils'

// The student-facing lesson (also the teacher's preview): a learning path of
// sections with visited marks, an optional "lesson map" (the concept tree),
// and each section's blocks rendered interactively.

interface Props {
  /** Stored lesson content (block JSON or legacy Markdown) — or a ready document. */
  content?: string | null
  doc?: LessonDoc
  title?: string
  /** For signed image URLs (/api/lessons/media) and remembered progress. */
  lessonId?: string
  /** A course content item instead of a lesson (images signed through ?item=). */
  itemId?: string
  /** Already-signed URLs by path (builder preview of fresh uploads). */
  imageUrls?: Record<string, string>
}

function useLessonImages(doc: LessonDoc, query: string | null, given: Record<string, string> | undefined) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const needed = imagePaths(doc).filter(p => !given?.[p])
  const key = needed.join('|')
  useEffect(() => {
    if (!query || !key) return
    let alive = true
    fetch(`/api/lessons/media?${query}`)
      .then(r => (r.ok ? r.json() : { urls: {} }))
      .then(d => { if (alive) setUrls(d.urls ?? {}) })
      .catch(() => {})
    return () => { alive = false }
  }, [query, key])
  return { ...urls, ...given }
}

const PROGRESS_KEY = (id: string) => `eq-lesson-visited:${id}`
const anchor = (id: string) => `lesson-sec-${id}`

// The whole lesson on one page, read top to bottom: every section in order,
// an index beside it (above it on a phone) that follows the reader as they
// scroll, a "next" button at the end of each section, and a lesson map.
export function LessonView({ content, doc: givenDoc, title = '', lessonId, itemId, imageUrls }: Props) {
  const t = useTranslations('common.lessonView')
  const doc = useMemo(() => givenDoc ?? parseLessonContent(content), [givenDoc, content])
  const sections = useMemo(() => doc.sections.filter(s => s.blocks.length > 0 || s.title), [doc])
  const urls = useLessonImages(doc, lessonId ? `lesson=${lessonId}` : itemId ? `item=${itemId}` : null, imageUrls)
  const progressId = lessonId ?? itemId
  const [showMap, setShowMap] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(sections[0]?.id ?? null)
  // Sections the reader has reached, remembered per lesson in this browser.
  const [visited, setVisited] = useState<Set<string>>(() => {
    const seen = new Set<string>()
    if (progressId && typeof window !== 'undefined') {
      try { for (const id of JSON.parse(localStorage.getItem(PROGRESS_KEY(progressId)) ?? '[]') as string[]) seen.add(id) } catch { /* private mode */ }
    }
    if (sections[0]) seen.add(sections[0].id)
    return seen
  })

  // Scroll-spy: the section crossing the upper part of the screen is "current".
  const sectionKey = sections.map(s => s.id).join('|')
  useEffect(() => {
    if (!sectionKey.includes('|') || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        const id = (e.target as HTMLElement).dataset.section
        if (!id) continue
        setActiveId(id)
        setVisited(prev => {
          if (prev.has(id)) return prev
          const next = new Set(prev).add(id)
          if (progressId) { try { localStorage.setItem(PROGRESS_KEY(progressId), JSON.stringify([...next])) } catch { /* ignore */ } }
          return next
        })
      }
    }, { rootMargin: '-15% 0px -65% 0px' })
    for (const id of sectionKey.split('|')) {
      const el = document.getElementById(anchor(id))
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [sectionKey, progressId])

  if (sections.length === 0) return <p className="text-fg-3 text-body-sm">{t('empty')}</p>

  const outline = lessonOutline({ ...doc, sections }, title || t('mapRoot'))
  const done = sections.filter(s => visited.has(s.id)).length
  const multi = sections.length > 1
  const go = (id: string) => {
    setShowMap(false)
    document.getElementById(anchor(id))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="space-y-4">
      {multi && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-48">
            <div className="flex justify-between text-meta text-fg-3 mb-1">
              <span>{t('progress', { done, total: sections.length })}</span>
              <span className="num">{Math.round((done / sections.length) * 100)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-elevated overflow-hidden">
              <div className="h-full bg-success transition-all" style={{ width: `${(done / sections.length) * 100}%` }} />
            </div>
          </div>
          <button type="button" onClick={() => setShowMap(v => !v)} aria-pressed={showMap}
            className={cn('eq-focus inline-flex items-center gap-2 px-3 py-1.5 rounded-control border text-body-sm transition-colors',
              showMap ? 'border-accent bg-accent-subtle text-accent' : 'border-line-strong text-fg-2 hover:text-fg')}>
            <MapIcon className="w-4 h-4" /> {t('lessonMap')}
          </button>
        </div>
      )}

      {showMap && (
        <div className="border border-line rounded-overlay bg-surface p-4">
          <p className="text-meta text-fg-3 mb-2">{t('mapHint')}</p>
          <MindMap root={outline} onPick={go} />
        </div>
      )}

      <div className={cn(multi && 'lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8')}>
        {multi && (
          <nav aria-label={t('path')} className="sticky top-[var(--eq-sticky-offset,0px)] z-10 -mx-1 px-1 py-2 bg-canvas lg:py-0 lg:self-start lg:top-[calc(var(--eq-sticky-offset,0px)+1rem)]">
            <ol className="flex lg:flex-col gap-1 overflow-x-auto">
              {sections.map((s, i) => {
                const isOn = s.id === activeId
                const seen = visited.has(s.id)
                return (
                  <li key={s.id} className="shrink-0">
                    <button type="button" onClick={() => go(s.id)} aria-current={isOn ? 'location' : undefined}
                      className={cn('eq-focus w-full flex items-center gap-2 px-2 py-2 rounded-control text-start text-body-sm transition-colors',
                        isOn ? 'bg-accent-subtle text-fg font-medium' : 'text-fg-2 hover:bg-elevated')}>
                      <span className={cn('shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-label num border',
                        isOn ? 'bg-accent text-on-accent border-accent' : seen ? 'bg-success-subtle text-success border-success' : 'border-line-strong text-fg-3')}>
                        {seen && !isOn ? <Check className="w-3.5 h-3.5" /> : i + 1}
                      </span>
                      <span className="truncate max-w-40 lg:max-w-none">{s.title || t('untitled', { n: i + 1 })}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </nav>
        )}

        <div className="min-w-0 space-y-12">
          {sections.map((s, i) => {
            const next = sections[i + 1]
            return (
              <section key={s.id} id={anchor(s.id)} data-section={s.id} className="scroll-mt-[calc(var(--eq-sticky-offset,0px)+4.5rem)] lg:scroll-mt-[calc(var(--eq-sticky-offset,0px)+1.5rem)] space-y-4">
                {(s.title || multi) && (
                  <header className="flex items-baseline gap-3 pb-2 border-b border-line">
                    {multi && <span className="eq-section-index">{String(i + 1).padStart(2, '0')}</span>}
                    <h2 className="text-h2 text-fg">{s.title || t('untitled', { n: i + 1 })}</h2>
                  </header>
                )}
                {s.blocks.map(b => <BlockView key={b.id} block={b} urls={urls} />)}
                {multi && (next
                  ? <div className="flex justify-end pt-2">
                      <button type="button" onClick={() => go(next.id)}
                        className="eq-focus inline-flex items-center gap-2 px-4 py-2 rounded-control bg-accent hover:bg-accent-hover text-on-accent text-body-sm font-medium">
                        {t('nextSection', { title: next.title || t('untitled', { n: i + 2 }) })}
                        <ChevronLeft className="w-4 h-4 ltr:rotate-180" />
                      </button>
                    </div>
                  : <p className="flex items-center justify-center gap-2 pt-4 text-success text-body-sm">
                      <Check className="w-4 h-4" /> {t('finished')}
                    </p>)}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Blocks ──────────────────────────────────────────────────────────────────

export function BlockView({ block, urls }: { block: LessonBlock; urls: Record<string, string> }) {
  switch (block.type) {
    case 'text': return block.md.trim() ? <Markdown content={block.md} className="text-fg-2 text-body leading-relaxed" /> : null
    case 'image': return <ImageBlock src={urls[block.path]} caption={block.caption} />
    case 'video': return <VideoBlock url={block.url} caption={block.caption} />
    case 'link': return <LinkBlock url={block.url} title={block.title} note={block.note} />
    case 'callout': return <Callout tone={block.tone} md={block.md} />
    case 'mindmap': return <div className="border border-line rounded-overlay p-4"><MindMap root={block.root} /></div>
    case 'steps': return <Steps items={block.items} />
    case 'flashcards': return <Flashcards cards={block.cards} />
    case 'quiz': return block.questions.length ? <InteractiveQuiz intro={block.intro} questions={block.questions} /> : null
  }
}

function ImageBlock({ src, caption }: { src?: string; caption: string }) {
  const t = useTranslations('common.lessonView')
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  if (!src) return <div className="h-40 rounded-overlay bg-elevated animate-pulse" aria-label={t('imageLoading')} />
  return (
    <figure className="space-y-2">
      <button type="button" onClick={() => setOpen(true)} className="eq-focus group relative block w-full rounded-overlay overflow-hidden border border-line bg-elevated">
        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
        <img src={src} alt={caption || t('image')} className="w-full max-h-[36rem] object-contain" loading="lazy" />
        <span className="absolute top-2 end-2 p-1.5 rounded-control bg-surface text-fg-2 opacity-0 group-hover:opacity-100 transition-opacity"><ZoomIn className="w-4 h-4" /></span>
      </button>
      {caption && <figcaption className="text-meta text-fg-3 text-center">{caption}</figcaption>}
      {open && (
        <div role="dialog" aria-modal="true" aria-label={caption || t('image')} onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 cursor-zoom-out">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={caption || t('image')} className="max-w-full max-h-full object-contain" />
          <button type="button" aria-label={t('close')} className="absolute top-4 end-4 p-2 rounded-full bg-surface text-fg"><X className="w-5 h-5" /></button>
        </div>
      )}
    </figure>
  )
}

function VideoBlock({ url, caption }: { url: string; caption: string }) {
  const t = useTranslations('common.lessonView')
  const v = parseVideoUrl(url)
  if (!v) return url ? <p className="text-meta text-fg-3">{t('videoUnsupported')}</p> : null
  return (
    <figure className="space-y-2">
      <div className="aspect-video rounded-overlay overflow-hidden border border-line bg-black">
        {v.kind === 'file'
          ? <video src={v.url} controls preload="metadata" className="w-full h-full" />
          : <iframe src={v.embedUrl} title={caption || t('video')} className="w-full h-full" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen loading="lazy" />}
      </div>
      {caption && <figcaption className="text-meta text-fg-3 text-center">{caption}</figcaption>}
    </figure>
  )
}

function LinkBlock({ url, title, note }: { url: string; title: string; note: string }) {
  if (!url) return null
  let host = ''
  try { host = new URL(url).hostname.replace(/^www\./, '') } catch { return null }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer nofollow"
      className="eq-focus flex items-start gap-3 p-3 rounded-overlay border border-line hover:border-accent bg-surface transition-colors">
      <span className="shrink-0 w-9 h-9 rounded-control bg-accent-subtle text-accent flex items-center justify-center"><ExternalLink className="w-4 h-4" /></span>
      <span className="min-w-0">
        <span className="block text-body-sm font-medium text-fg truncate">{title || host}</span>
        {note && <span className="block text-meta text-fg-2">{note}</span>}
        <span className="block text-label text-fg-3" dir="ltr">{host}</span>
      </span>
    </a>
  )
}

const TONE: Record<CalloutTone, { box: string; icon: ReactNode }> = {
  info: { box: 'border-info bg-info-subtle', icon: <Info className="w-4 h-4 text-info" /> },
  tip: { box: 'border-success bg-success-subtle', icon: <Lightbulb className="w-4 h-4 text-success" /> },
  warning: { box: 'border-warning bg-warning-subtle', icon: <AlertTriangle className="w-4 h-4 text-warning" /> },
  remember: { box: 'border-accent bg-accent-subtle', icon: <Bookmark className="w-4 h-4 text-accent" /> },
}

function Callout({ tone, md }: { tone: CalloutTone; md: string }) {
  const t = useTranslations('common.lessonView.tones')
  if (!md.trim()) return null
  return (
    <aside className={cn('border-s-4 rounded-control px-4 py-3', TONE[tone].box)}>
      <p className="flex items-center gap-2 text-label font-semibold text-fg mb-1">{TONE[tone].icon}{t(tone)}</p>
      <div className="text-body-sm text-fg-2"><Markdown content={md} /></div>
    </aside>
  )
}

// Concept tree, top-down, every branch collapsible. Connectors are drawn in
// CSS (.eq-tree in globals.css) with logical properties, so RTL just works.
const BRANCH = ['border-accent', 'border-success', 'border-warning', 'border-info']

export function MindMap({ root, onPick }: { root: MapNode; onPick?: (id: string) => void }) {
  // A wide map starts scrolled to its centre (the central idea), in either direction.
  const center = (el: HTMLDivElement | null) => {
    if (!el || el.scrollWidth <= el.clientWidth) return
    const mid = (el.scrollWidth - el.clientWidth) / 2
    el.scrollLeft = getComputedStyle(el).direction === 'rtl' ? -mid : mid
  }
  return (
    <div ref={center} className="overflow-x-auto pb-2">
      <ul className="eq-tree mx-auto w-max min-w-full">
        <MapItem node={root} depth={0} branch={0} onPick={onPick} />
      </ul>
    </div>
  )
}

function MapItem({ node, depth, branch, onPick }: { node: MapNode; depth: number; branch: number; onPick?: (id: string) => void }) {
  const [open, setOpen] = useState(depth < 2)
  const has = node.children.length > 0
  const label = node.label || '…'
  return (
    <li>
      <span className="inline-flex items-center gap-1">
        <button type="button"
          onClick={() => (onPick && depth === 1 ? onPick(node.id) : has && setOpen(o => !o))}
          className={cn('eq-focus px-3 py-1.5 rounded-control border-2 text-body-sm max-w-56 text-center transition-colors',
            depth === 0 ? 'bg-accent text-on-accent border-accent font-semibold'
              : depth === 1 ? cn('bg-surface text-fg font-medium hover:bg-elevated', BRANCH[branch % BRANCH.length])
                : cn('bg-canvas text-fg-2 hover:text-fg', BRANCH[branch % BRANCH.length]))}>
          {label}
        </button>
        {has && depth > 0 && (
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={label}
            className="eq-focus w-5 h-5 rounded-full border border-line-strong text-fg-3 flex items-center justify-center">
            <ChevronDown className={cn('w-3 h-3 transition-transform', !open && 'rotate-90')} />
          </button>
        )}
      </span>
      {has && open && (
        <ul>
          {node.children.map((c, i) => <MapItem key={c.id} node={c} depth={depth + 1} branch={depth === 0 ? i : branch} onPick={onPick} />)}
        </ul>
      )}
    </li>
  )
}

function Steps({ items }: { items: { id: string; title: string; md: string }[] }) {
  const [open, setOpen] = useState<string | null>(items[0]?.id ?? null)
  return (
    <ol className="relative space-y-2 border-s-2 border-line ms-3">
      {items.map((it, i) => {
        const isOpen = open === it.id
        return (
          <li key={it.id} className="ps-6 relative">
            <span className={cn('absolute -start-[0.9rem] top-1 w-7 h-7 rounded-full flex items-center justify-center text-label num border-2',
              isOpen ? 'bg-accent text-on-accent border-accent' : 'bg-surface text-fg-2 border-line-strong')}>{i + 1}</span>
            <button type="button" onClick={() => setOpen(isOpen ? null : it.id)} aria-expanded={isOpen}
              className="eq-focus w-full text-start py-1.5 text-body font-medium text-fg flex items-center justify-between gap-2">
              {it.title}
              {it.md && <ChevronDown className={cn('w-4 h-4 text-fg-3 transition-transform', isOpen && 'rotate-180')} />}
            </button>
            {isOpen && it.md && <div className="pb-2 text-body-sm text-fg-2"><Markdown content={it.md} /></div>}
          </li>
        )
      })}
    </ol>
  )
}

function Flashcards({ cards }: { cards: { id: string; front: string; back: string; hint: string }[] }) {
  const t = useTranslations('common.lessonView')
  const [flipped, setFlipped] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setFlipped(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-meta text-fg-3">{t('flipHint')}</p>
        {flipped.size > 0 && (
          <button type="button" onClick={() => setFlipped(new Set())} className="eq-focus inline-flex items-center gap-1 text-meta text-fg-3 hover:text-fg">
            <RotateCcw className="w-3.5 h-3.5" /> {t('resetCards')}
          </button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(c => <Flashcard key={c.id} card={c} flipped={flipped.has(c.id)} onFlip={() => toggle(c.id)} />)}
      </div>
    </div>
  )
}

function Flashcard({ card, flipped, onFlip }: { card: { front: string; back: string; hint: string }; flipped: boolean; onFlip: () => void }) {
  const t = useTranslations('common.lessonView')
  const [showHint, setShowHint] = useState(false)
  return (
    <div className={cn('relative min-h-32 rounded-overlay border-2 transition-colors', flipped ? 'border-success bg-success-subtle' : 'border-line-strong bg-surface')}>
      <button type="button" onClick={onFlip} aria-pressed={flipped} className="eq-focus w-full h-full min-h-32 p-4 flex flex-col items-center justify-center text-center gap-1">
        {!flipped
          ? <span className="text-h3 text-fg">{card.front}</span>
          : <>
              <span className="text-label text-fg-3">{card.front}</span>
              <span className="text-body-sm text-fg">{card.back}</span>
              {card.hint && showHint && <span className="text-body-sm text-success font-medium" dir="auto">{card.hint}</span>}
            </>}
      </button>
      <div className="absolute top-2 end-2 flex gap-1">
        <button type="button" onClick={() => speak(card.front)} aria-label={t('listen')} title={t('listen')}
          className="eq-focus w-7 h-7 rounded-full bg-accent-subtle text-accent flex items-center justify-center"><Volume2 className="w-3.5 h-3.5" /></button>
        {flipped && card.hint && !showHint && (
          <button type="button" onClick={() => setShowHint(true)} aria-label={t('translate')} title={t('translate')}
            className="eq-focus w-7 h-7 rounded-full bg-elevated text-fg-2 flex items-center justify-center"><Languages className="w-3.5 h-3.5" /></button>
        )}
      </div>
    </div>
  )
}
