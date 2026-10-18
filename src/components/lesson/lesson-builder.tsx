'use client'

import { useRef, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import {
  ArrowDown, ArrowUp, Copy, Trash2, Plus, Type, Image as ImageIcon, Video, Link2, Lightbulb, Network, ListOrdered,
  Layers, HelpCircle, Upload, X, ChevronLeft, ChevronRight,
} from 'lucide-react'
import {
  BLOCK_TYPES, CALLOUT_TONES, emptyBlock, newId, type BlockType, type LessonBlock, type LessonDoc, type LessonSection,
  type MapNode, type QuizQuestion,
} from '@/lib/lesson-doc'
import { parseVideoUrl } from '@/lib/video-embed'
import { prepareImageForUpload } from '@/lib/prepare-image'
import { BlockView } from './lesson-view'
import { cn } from '@/lib/utils'
import { confirmDialog } from '@/lib/confirm-dialog'
import { richTextFits } from '@/lib/lesson-rich-text'
import { TEMPLATES, templateBlock } from '@/lib/lesson-templates'
import { ImproveBlock } from './improve-block'

// The word-processor field loads only when a teacher edits text (TipTap).
const RichTextField = dynamic(() => import('./rich-text-field'), {
  ssr: false,
  loading: () => <div className="min-h-24 rounded-control border border-line-strong bg-canvas" />,
})

// Block-based lesson editor (owner, 2026-10-09): sections → blocks that can be
// added anywhere, moved, duplicated and removed. Image blocks hold the
// teacher's own image as is (a summary they designed elsewhere). The document
// is lifted to the caller, which saves it as JSON through PATCH /api/lessons.

export const BLOCK_ICON: Record<BlockType, ReactNode> = {
  text: <Type className="w-4 h-4" />,
  image: <ImageIcon className="w-4 h-4" />,
  video: <Video className="w-4 h-4" />,
  link: <Link2 className="w-4 h-4" />,
  callout: <Lightbulb className="w-4 h-4" />,
  mindmap: <Network className="w-4 h-4" />,
  steps: <ListOrdered className="w-4 h-4" />,
  flashcards: <Layers className="w-4 h-4" />,
  quiz: <HelpCircle className="w-4 h-4" />,
}

const FIELD = 'w-full px-3 py-2 rounded-control bg-canvas border border-line-strong text-fg text-body-sm placeholder:text-fg-3 focus:outline-none focus:border-accent'
const ICON_BTN = 'eq-focus w-7 h-7 rounded-control flex items-center justify-center text-fg-3 hover:text-fg hover:bg-elevated disabled:opacity-30 disabled:pointer-events-none'

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list
  const next = [...list]
  const [x] = next.splice(from, 1)
  next.splice(to, 0, x)
  return next
}

function cloneBlock(b: LessonBlock): LessonBlock {
  const copy = JSON.parse(JSON.stringify(b)) as LessonBlock
  copy.id = newId()
  return copy
}

interface Props {
  doc: LessonDoc
  onChange: (doc: LessonDoc) => void
  /** Sent with "improve this block" so the AI knows the lesson. */
  lessonTitle?: string
  imageUrls: Record<string, string>
  onImageUploaded: (path: string, url: string) => void
}

export function LessonBuilder({ doc, onChange, lessonTitle = '', imageUrls, onImageUploaded }: Props) {
  const t = useTranslations('common.lessonBuilder')
  const [active, setActive] = useState(0)
  const idx = Math.min(active, doc.sections.length - 1)
  const section = doc.sections[idx]

  const setSections = (sections: LessonSection[]) => onChange({ ...doc, sections })
  const setSection = (s: LessonSection) => setSections(doc.sections.map((x, i) => (i === idx ? s : x)))
  const setBlocks = (blocks: LessonBlock[]) => setSection({ ...section, blocks })

  function addSection() {
    setSections([...doc.sections, { id: newId(), title: '', blocks: [emptyBlock('text')] }])
    setActive(doc.sections.length)
  }
  async function removeSection() {
    if (doc.sections.length <= 1) { setSection({ ...section, blocks: [] }); return }
    if (!(await confirmDialog(t('confirmRemoveSection')))) return
    setSections(doc.sections.filter((_, i) => i !== idx))
    setActive(Math.max(0, idx - 1))
  }
  function moveSection(dir: -1 | 1) {
    setSections(move(doc.sections, idx, idx + dir))
    setActive(Math.max(0, Math.min(doc.sections.length - 1, idx + dir)))
  }
  const insertBlock = (at: number, block: LessonBlock) => {
    const blocks = [...section.blocks]
    blocks.splice(at, 0, block)
    setBlocks(blocks)
  }

  return (
    <div className="space-y-4">
      {/* Sections */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-label text-fg-3">{t('sections')}</span>
        {doc.sections.map((s, i) => (
          <button key={s.id} type="button" onClick={() => setActive(i)}
            className={cn('eq-focus px-3 py-1.5 rounded-control text-body-sm border transition-colors max-w-48 truncate',
              i === idx ? 'bg-accent text-on-accent border-accent' : 'border-line-strong text-fg-2 hover:text-fg')}>
            <span className="num me-1 opacity-70">{i + 1}.</span>{s.title || t('untitledSection')}
          </button>
        ))}
        <button type="button" onClick={addSection}
          className="eq-focus inline-flex items-center gap-1 px-3 py-1.5 rounded-control border border-dashed border-line-strong text-body-sm text-fg-2 hover:text-fg hover:border-accent">
          <Plus className="w-4 h-4" /> {t('addSection')}
        </button>
      </div>

      <div className="border border-line rounded-overlay bg-surface">
        <div className="flex items-center gap-2 p-3 border-b border-line">
          <input value={section.title} onChange={e => setSection({ ...section, title: e.target.value })}
            placeholder={t('sectionTitlePlaceholder')} dir="auto"
            className="flex-1 min-w-0 bg-transparent text-h3 text-fg placeholder:text-fg-3 focus:outline-none" />
          <button type="button" className={ICON_BTN} onClick={() => moveSection(-1)} disabled={idx === 0} aria-label={t('moveSectionBack')} title={t('moveSectionBack')}>
            <ChevronRight className="w-4 h-4 ltr:rotate-180" />
          </button>
          <button type="button" className={ICON_BTN} onClick={() => moveSection(1)} disabled={idx === doc.sections.length - 1} aria-label={t('moveSectionForward')} title={t('moveSectionForward')}>
            <ChevronLeft className="w-4 h-4 ltr:rotate-180" />
          </button>
          <button type="button" className={cn(ICON_BTN, 'hover:text-danger')} onClick={() => void removeSection()} aria-label={t('removeSection')} title={t('removeSection')}>
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 space-y-1">
          <Inserter onPick={block => insertBlock(0, block)} />
          {section.blocks.map((b, i) => (
            <div key={b.id}>
              <BlockCard
                block={b}
                lessonTitle={lessonTitle}
                first={i === 0}
                last={i === section.blocks.length - 1}
                imageUrls={imageUrls}
                onImageUploaded={onImageUploaded}
                onChange={nb => setBlocks(section.blocks.map(x => (x.id === b.id ? nb : x)))}
                onMove={dir => setBlocks(move(section.blocks, i, i + dir))}
                onDuplicate={() => { const bl = [...section.blocks]; bl.splice(i + 1, 0, cloneBlock(b)); setBlocks(bl) }}
                onRemove={() => setBlocks(section.blocks.filter(x => x.id !== b.id))}
              />
              <Inserter onPick={block => insertBlock(i + 1, block)} />
            </div>
          ))}
          {section.blocks.length === 0 && <p className="text-center text-meta text-fg-3 py-6">{t('emptySection')}</p>}
        </div>
      </div>
    </div>
  )
}

// "+" between blocks → the block palette.
function Inserter({ onPick }: { onPick: (block: LessonBlock) => void }) {
  const t = useTranslations('common.lessonBuilder')
  const tt = useTranslations('common.lessonBuilder.templates')
  const [open, setOpen] = useState(false)
  return (
    <div className="relative py-1">
      <div className="flex items-center gap-2 group">
        <div className="flex-1 border-t border-dashed border-line opacity-0 group-hover:opacity-100 transition-opacity" />
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
          className={cn('eq-focus inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-label transition-colors',
            open ? 'border-accent text-accent bg-accent-subtle' : 'border-line text-fg-3 hover:text-accent hover:border-accent')}>
          {open ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />} {t('addBlock')}
        </button>
        <div className="flex-1 border-t border-dashed border-line opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      {open && (
        <div className="mt-2 space-y-2 p-2 rounded-overlay border border-line bg-canvas">
          <p className="text-label text-fg-3 px-1">{tt('heading')}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {TEMPLATES.map(key => (
              <button key={key} type="button" onClick={() => { onPick(templateBlock(key, k => tt(k))); setOpen(false) }}
                className="eq-focus flex items-center gap-2 p-2 rounded-control text-start border border-line hover:bg-elevated">
                <span className="text-body-sm font-medium text-fg">{tt(`${key}.name`)}</span>
              </button>
            ))}
          </div>
          <p className="text-label text-fg-3 px-1 pt-1">{tt('blocks')}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {BLOCK_TYPES.map(type => (
            <button key={type} type="button" onClick={() => { onPick(emptyBlock(type)); setOpen(false) }}
              className="eq-focus flex items-start gap-2 p-2 rounded-control text-start hover:bg-elevated">
              <span className="shrink-0 w-8 h-8 rounded-control bg-accent-subtle text-accent flex items-center justify-center">{BLOCK_ICON[type]}</span>
              <span className="min-w-0">
                <span className="block text-body-sm font-medium text-fg">{t(`types.${type}.name`)}</span>
                <span className="block text-label text-fg-3">{t(`types.${type}.desc`)}</span>
              </span>
            </button>
          ))}
        </div>
        </div>
      )}
    </div>
  )
}

interface CardProps {
  block: LessonBlock
  lessonTitle: string
  first: boolean
  last: boolean
  imageUrls: Record<string, string>
  onImageUploaded: (path: string, url: string) => void
  onChange: (b: LessonBlock) => void
  onMove: (dir: -1 | 1) => void
  onDuplicate: () => void
  onRemove: () => void
}

function BlockCard({ block, lessonTitle, first, last, imageUrls, onImageUploaded, onChange, onMove, onDuplicate, onRemove }: CardProps) {
  const t = useTranslations('common.lessonBuilder')
  // View = edit (2026-10-18): a block with content shows as the student sees it;
  // clicking it opens the editor. A new, empty block opens straight in the editor.
  const [preview, setPreview] = useState(() => hasContent(block))
  const colourable = block.type === 'text' || block.type === 'callout'
  return (
    <section className="rounded-overlay border border-line-strong bg-canvas">
      <header className="flex items-center gap-1 px-2 py-1.5 border-b border-line">
        <span className="text-accent">{BLOCK_ICON[block.type]}</span>
        <span className="text-label font-medium text-fg-2 me-auto ms-1">{t(`types.${block.type}.name`)}</span>
        {(block.type === 'text' || block.type === 'callout') && (
          <ImproveBlock block={block} lessonTitle={lessonTitle} onAccept={md => onChange({ ...block, md })} />
        )}
        {colourable && <ToneMenu block={block} onChange={onChange} />}
        <button type="button" onClick={() => setPreview(p => !p)} aria-pressed={!preview}
          className={cn('eq-focus px-2 h-7 rounded-control text-label', !preview ? 'bg-accent-subtle text-accent' : 'text-fg-3 hover:text-fg')}>
          {preview ? t('edit') : t('done')}
        </button>
        <button type="button" className={ICON_BTN} disabled={first} onClick={() => onMove(-1)} aria-label={t('moveUp')} title={t('moveUp')}><ArrowUp className="w-4 h-4" /></button>
        <button type="button" className={ICON_BTN} disabled={last} onClick={() => onMove(1)} aria-label={t('moveDown')} title={t('moveDown')}><ArrowDown className="w-4 h-4" /></button>
        <button type="button" className={ICON_BTN} onClick={onDuplicate} aria-label={t('duplicate')} title={t('duplicate')}><Copy className="w-4 h-4" /></button>
        <button type="button" className={cn(ICON_BTN, 'hover:text-danger')} onClick={onRemove} aria-label={t('remove')} title={t('remove')}><Trash2 className="w-4 h-4" /></button>
      </header>
      <div className="p-3">
        {preview
          ? (
            <div role="button" tabIndex={0} onClick={() => setPreview(false)} onKeyDown={e => { if (e.key === 'Enter') setPreview(false) }}
              title={t('clickToEdit')} aria-label={t('clickToEdit')}
              className="eq-focus block w-full text-start rounded-control hover:bg-elevated cursor-text">
              <BlockView block={block} urls={imageUrls} />
            </div>
          )
          : <BlockEditor block={block} onChange={onChange} imageUrls={imageUrls} onImageUploaded={onImageUploaded} />}
      </div>
    </section>
  )
}

function BlockEditor({ block, onChange, imageUrls, onImageUploaded }: {
  block: LessonBlock; onChange: (b: LessonBlock) => void; imageUrls: Record<string, string>; onImageUploaded: (path: string, url: string) => void
}) {
  const t = useTranslations('common.lessonBuilder')
  switch (block.type) {
    case 'text':
      return (
        <div className="space-y-1">
          {richTextFits(block.md)
            ? <RichTextField value={block.md} onChange={md => onChange({ ...block, md })} placeholder={t('textPlaceholder')} />
            : <>
                <textarea value={block.md} onChange={e => onChange({ ...block, md: e.target.value })} rows={Math.min(18, Math.max(4, block.md.split('\n').length + 1))}
                  dir="auto" placeholder={t('textPlaceholder')} className={cn(FIELD, 'resize-y font-mono')} />
                <p className="text-label text-fg-3">{t('plainHint')}</p>
              </>}
        </div>
      )
    case 'image':
      return <ImageEditor block={block} onChange={onChange} url={imageUrls[block.path]} onUploaded={onImageUploaded} />
    case 'video': {
      const ok = !block.url || !!parseVideoUrl(block.url)
      return (
        <div className="space-y-2">
          <input value={block.url} onChange={e => onChange({ ...block, url: e.target.value.trim() })} placeholder={t('videoUrlPlaceholder')} dir="ltr" className={FIELD} />
          {!ok && <p className="text-label text-danger">{t('videoInvalid')}</p>}
          <input value={block.caption} onChange={e => onChange({ ...block, caption: e.target.value })} placeholder={t('captionPlaceholder')} dir="auto" className={FIELD} />
          {block.url && ok && <BlockView block={block} urls={{}} />}
        </div>
      )
    }
    case 'link': {
      const bad = !!block.url && !/^https:\/\//i.test(block.url)
      return (
        <div className="space-y-2">
          <input value={block.url} onChange={e => onChange({ ...block, url: e.target.value.trim() })} placeholder="https://…" dir="ltr" className={FIELD} />
          {bad && <p className="text-label text-danger">{t('linkInvalid')}</p>}
          <input value={block.title} onChange={e => onChange({ ...block, title: e.target.value })} placeholder={t('linkTitlePlaceholder')} dir="auto" className={FIELD} />
          <input value={block.note} onChange={e => onChange({ ...block, note: e.target.value })} placeholder={t('linkNotePlaceholder')} dir="auto" className={FIELD} />
        </div>
      )
    }
    case 'callout':
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {CALLOUT_TONES.map(tone => (
              <button key={tone} type="button" onClick={() => onChange({ ...block, tone })}
                className={cn('eq-focus px-3 py-1 rounded-control border text-label', block.tone === tone ? 'border-accent bg-accent-subtle text-accent' : 'border-line-strong text-fg-3 hover:text-fg')}>
                {t(`tones.${tone}`)}
              </button>
            ))}
          </div>
          {richTextFits(block.md)
            ? <RichTextField value={block.md} onChange={md => onChange({ ...block, md })} placeholder={t('calloutPlaceholder')} />
            : <textarea value={block.md} onChange={e => onChange({ ...block, md: e.target.value })} rows={3} dir="auto" placeholder={t('calloutPlaceholder')} className={cn(FIELD, 'resize-y')} />}
        </div>
      )
    case 'mindmap':
      return (
        <div className="space-y-2">
          <p className="text-label text-fg-3">{t('mindmapHint')}</p>
          <NodeEditor node={block.root} depth={0} onChange={root => onChange({ ...block, root })} />
        </div>
      )
    case 'steps':
      return (
        <ListEditor
          items={block.items}
          onChange={items => onChange({ ...block, items })}
          make={() => ({ id: newId(), title: '', md: '' })}
          addLabel={t('addStep')}
          render={(it, set, i) => (
            <div className="flex-1 space-y-1">
              <input value={it.title} onChange={e => set({ ...it, title: e.target.value })} placeholder={t('stepTitlePlaceholder', { n: i + 1 })} dir="auto" className={FIELD} />
              <textarea value={it.md} onChange={e => set({ ...it, md: e.target.value })} rows={2} placeholder={t('stepBodyPlaceholder')} dir="auto" className={cn(FIELD, 'resize-y')} />
            </div>
          )}
        />
      )
    case 'flashcards':
      return (
        <ListEditor
          items={block.cards}
          onChange={cards => onChange({ ...block, cards })}
          make={() => ({ id: newId(), front: '', back: '', hint: '' })}
          addLabel={t('addCard')}
          render={(c, set) => (
            <div className="flex-1 grid gap-1 sm:grid-cols-3">
              <input value={c.front} onChange={e => set({ ...c, front: e.target.value })} placeholder={t('cardFront')} dir="auto" className={FIELD} />
              <input value={c.back} onChange={e => set({ ...c, back: e.target.value })} placeholder={t('cardBack')} dir="auto" className={FIELD} />
              <input value={c.hint} onChange={e => set({ ...c, hint: e.target.value })} placeholder={t('cardHint')} dir="auto" className={FIELD} />
            </div>
          )}
        />
      )
    case 'quiz':
      return (
        <div className="space-y-2">
          <input value={block.intro} onChange={e => onChange({ ...block, intro: e.target.value })} placeholder={t('quizIntroPlaceholder')} dir="auto" className={FIELD} />
          <ListEditor
            items={block.questions.map((q, i) => ({ ...q, id: String(i) }))}
            onChange={qs => onChange({ ...block, questions: qs.map(q => ({ text: q.text, options: q.options, answer: q.answer })) })}
            make={() => ({ id: newId(), text: '', options: [{ letter: 'A', label: '' }, { letter: 'B', label: '' }], answer: 'A' })}
            addLabel={t('addQuestion')}
            render={(q, set, i) => <QuestionEditor q={q} n={i + 1} onChange={nq => set({ ...nq, id: q.id })} />}
          />
        </div>
      )
  }
}

function ListEditor<T extends { id: string }>({ items, onChange, make, render, addLabel }: {
  items: T[]; onChange: (items: T[]) => void; make: () => T; addLabel: string
  render: (item: T, set: (item: T) => void, index: number) => ReactNode
}) {
  const t = useTranslations('common.lessonBuilder')
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={it.id} className="flex items-start gap-1">
          {render(it, v => onChange(items.map((x, j) => (j === i ? v : x))), i)}
          <div className="flex flex-col">
            <button type="button" className={ICON_BTN} disabled={i === 0} onClick={() => onChange(move(items, i, i - 1))} aria-label={t('moveUp')}><ArrowUp className="w-3.5 h-3.5" /></button>
            <button type="button" className={ICON_BTN} disabled={i === items.length - 1} onClick={() => onChange(move(items, i, i + 1))} aria-label={t('moveDown')}><ArrowDown className="w-3.5 h-3.5" /></button>
            <button type="button" className={cn(ICON_BTN, 'hover:text-danger')} onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={t('remove')}><X className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, make()])}
        className="eq-focus inline-flex items-center gap-1 text-body-sm text-accent hover:text-accent-hover"><Plus className="w-4 h-4" /> {addLabel}</button>
    </div>
  )
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

function QuestionEditor({ q, n, onChange }: { q: QuizQuestion; n: number; onChange: (q: QuizQuestion) => void }) {
  const t = useTranslations('common.lessonBuilder')
  const withOptions = q.options.length > 0
  const setOptions = (labels: string[]) => {
    const options = labels.map((label, i) => ({ letter: LETTERS[i], label }))
    onChange({ ...q, options, answer: options.some(o => o.letter === q.answer) ? q.answer : 'A' })
  }
  return (
    <div className="flex-1 space-y-2 p-2 rounded-control border border-line">
      <textarea value={q.text} onChange={e => onChange({ ...q, text: e.target.value })} rows={2} dir="auto"
        placeholder={t('questionPlaceholder', { n })} className={cn(FIELD, 'resize-y')} />
      <div className="flex gap-1">
        <button type="button" onClick={() => setOptions(withOptions ? q.options.map(o => o.label) : ['', ''])}
          className={cn('eq-focus px-2 py-0.5 rounded-control border text-label', withOptions ? 'border-accent text-accent bg-accent-subtle' : 'border-line-strong text-fg-3')}>{t('choices')}</button>
        <button type="button" onClick={() => onChange({ ...q, options: [], answer: '' })}
          className={cn('eq-focus px-2 py-0.5 rounded-control border text-label', !withOptions ? 'border-accent text-accent bg-accent-subtle' : 'border-line-strong text-fg-3')}>{t('written')}</button>
      </div>
      {withOptions ? (
        <div className="space-y-1">
          {q.options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <button type="button" onClick={() => onChange({ ...q, answer: o.letter })} aria-pressed={q.answer === o.letter} title={t('markCorrect')}
                className={cn('eq-focus shrink-0 w-7 h-7 rounded-full border-2 text-label font-bold', q.answer === o.letter ? 'border-success bg-success text-on-accent' : 'border-line-strong text-fg-3')}>
                {o.letter}
              </button>
              <input value={o.label} onChange={e => setOptions(q.options.map((x, j) => (j === i ? e.target.value : x.label)))} dir="auto" className={FIELD} />
              {q.options.length > 2 && (
                <button type="button" className={ICON_BTN} onClick={() => setOptions(q.options.filter((_, j) => j !== i).map(x => x.label))} aria-label={t('remove')}><X className="w-3.5 h-3.5" /></button>
              )}
            </div>
          ))}
          {q.options.length < LETTERS.length && (
            <button type="button" onClick={() => setOptions([...q.options.map(o => o.label), ''])} className="eq-focus text-label text-accent">+ {t('addOption')}</button>
          )}
          <p className="text-label text-fg-3">{t('markCorrectHint')}</p>
        </div>
      ) : (
        <input value={q.answer} onChange={e => onChange({ ...q, answer: e.target.value })} placeholder={t('modelAnswer')} dir="auto" className={FIELD} />
      )}
    </div>
  )
}

function NodeEditor({ node, depth, onChange, onRemove }: { node: MapNode; depth: number; onChange: (n: MapNode) => void; onRemove?: () => void }) {
  const t = useTranslations('common.lessonBuilder')
  return (
    <div className={cn(depth > 0 && 'ps-4 border-s-2 border-line')}>
      <div className="flex items-center gap-1 py-0.5">
        <input value={node.label} onChange={e => onChange({ ...node, label: e.target.value })} dir="auto"
          placeholder={depth === 0 ? t('mapRootPlaceholder') : t('mapNodePlaceholder')}
          className={cn(FIELD, depth === 0 && 'font-semibold')} />
        {depth < 4 && (
          <button type="button" className={ICON_BTN} title={t('addBranch')} aria-label={t('addBranch')}
            onClick={() => onChange({ ...node, children: [...node.children, { id: newId(), label: '', children: [] }] })}><Plus className="w-4 h-4" /></button>
        )}
        {onRemove && <button type="button" className={cn(ICON_BTN, 'hover:text-danger')} onClick={onRemove} aria-label={t('remove')}><X className="w-4 h-4" /></button>}
      </div>
      {node.children.map((c, i) => (
        <NodeEditor key={c.id} node={c} depth={depth + 1}
          onChange={nc => onChange({ ...node, children: node.children.map((x, j) => (j === i ? nc : x)) })}
          onRemove={() => onChange({ ...node, children: node.children.filter((_, j) => j !== i) })} />
      ))}
    </div>
  )
}

// The teacher's own image, uploaded as is (only shrunk if very large).
const LESSON_IMAGE = { maxSide: 2400, alwaysReencode: false, quality: 0.88 } as const

function ImageEditor({ block, onChange, url, onUploaded }: {
  block: Extract<LessonBlock, { type: 'image' }>; onChange: (b: LessonBlock) => void; url?: string; onUploaded: (path: string, url: string) => void
}) {
  const t = useTranslations('common.lessonBuilder')
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function upload(file: File) {
    setBusy(true); setError('')
    try {
      const ready = await prepareImageForUpload(file, LESSON_IMAGE)
      const fd = new FormData()
      fd.append('file', ready)
      const res = await fetch('/api/lessons/files', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.path) { setError(data.error ?? t('uploadFailed')); return }
      onUploaded(data.path, data.url ?? '')
      onChange({ ...block, path: data.path })
    } catch {
      setError(t('uploadFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {block.path && url ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed URL */}
          <img src={url} alt={block.caption} className="w-full max-h-80 object-contain rounded-control border border-line bg-elevated" />
          <button type="button" onClick={() => ref.current?.click()}
            className="eq-focus absolute top-2 end-2 px-2 py-1 rounded-control bg-surface border border-line text-label text-fg-2 hover:text-fg">{t('replaceImage')}</button>
        </div>
      ) : (
        <button type="button" onClick={() => ref.current?.click()} disabled={busy}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void upload(f) }}
          className="eq-focus w-full flex flex-col items-center gap-2 py-8 rounded-control border-2 border-dashed border-line-strong text-fg-3 hover:border-accent hover:text-accent transition-colors">
          <Upload className="w-6 h-6" />
          <span className="text-body-sm">{busy ? t('uploading') : t('uploadImage')}</span>
          <span className="text-label">{t('uploadImageHint')}</span>
        </button>
      )}
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
      {error && <p className="text-label text-danger">{error}</p>}
      <input value={block.caption} onChange={e => onChange({ ...block, caption: e.target.value })} placeholder={t('captionPlaceholder')} dir="auto" className={FIELD} />
    </div>
  )
}

/** True when a block already says something (it then opens in its student look). */
function hasContent(b: LessonBlock): boolean {
  switch (b.type) {
    case 'text': case 'callout': return b.md.trim().length > 0
    case 'image': return !!b.path
    case 'video': case 'link': return !!b.url
    case 'mindmap': return b.root.children.length > 0
    case 'steps': return b.items.some(i => i.title.trim() || i.md.trim())
    case 'flashcards': return b.cards.some(c => c.front.trim() || c.back.trim())
    case 'quiz': return b.questions.length > 0
  }
}

/**
 * Background colour of a text block, as the generated lessons use it: plain
 * text, or a coloured box (note, tip, warning, remember). Switches the block
 * between 'text' and 'callout' and keeps what it says.
 */
function ToneMenu({ block, onChange }: { block: LessonBlock; onChange: (b: LessonBlock) => void }) {
  const t = useTranslations('common.lessonBuilder')
  if (block.type !== 'text' && block.type !== 'callout') return null
  const current = block.type === 'callout' ? block.tone : 'none'
  return (
    <select
      aria-label={t('tone.label')}
      title={t('tone.label')}
      value={current}
      onChange={e => {
        const v = e.target.value
        onChange(v === 'none'
          ? { id: block.id, type: 'text', md: block.md }
          : { id: block.id, type: 'callout', tone: v as (typeof CALLOUT_TONES)[number], md: block.md })
      }}
      className="eq-focus h-7 rounded-control border border-line bg-canvas px-1 text-label text-fg-2"
    >
      <option value="none">{t('tone.none')}</option>
      {CALLOUT_TONES.map(tone => <option key={tone} value={tone}>{t(`tones.${tone}`)}</option>)}
    </select>
  )
}
