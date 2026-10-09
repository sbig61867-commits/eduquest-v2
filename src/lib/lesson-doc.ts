// A lesson as composable blocks (owner, 2026-10-09).
//
// Stored in the existing `lessons.content` TEXT column as JSON (no migration):
//   {"eqLesson":2,"sections":[{ id, title, blocks:[…] }]}
// Anything else in that column is a legacy Markdown lesson and is converted on
// read by markdownToLessonDoc — so every old lesson (and every AI draft, which
// is still produced as Markdown) opens in the builder and the interactive view.
//
// Images are NOT URLs: an image block stores a path in the private exam-files
// bucket (<tenant>/lessons/<teacher>/<uuid>.<ext>); /api/lessons/media signs it
// for whoever may read the lesson. Nothing here may carry raw HTML.

export type CalloutTone = 'info' | 'tip' | 'warning' | 'remember'

export interface MapNode { id: string; label: string; children: MapNode[] }
export interface QuizQuestion { text: string; options: { letter: string; label: string }[]; answer: string }

export type LessonBlock =
  | { id: string; type: 'text'; md: string }
  | { id: string; type: 'image'; path: string; caption: string }
  | { id: string; type: 'video'; url: string; caption: string }
  | { id: string; type: 'link'; url: string; title: string; note: string }
  | { id: string; type: 'callout'; tone: CalloutTone; md: string }
  | { id: string; type: 'mindmap'; root: MapNode }
  | { id: string; type: 'steps'; items: { id: string; title: string; md: string }[] }
  | { id: string; type: 'flashcards'; cards: { id: string; front: string; back: string; hint: string }[] }
  | { id: string; type: 'quiz'; intro: string; questions: QuizQuestion[] }

export type BlockType = LessonBlock['type']
export interface LessonSection { id: string; title: string; blocks: LessonBlock[] }
export interface LessonDoc { eqLesson: 2; sections: LessonSection[] }

export const BLOCK_TYPES: BlockType[] = ['text', 'image', 'video', 'link', 'callout', 'mindmap', 'steps', 'flashcards', 'quiz']
export const CALLOUT_TONES: CalloutTone[] = ['info', 'tip', 'warning', 'remember']

export const LIMITS = { sections: 30, blocks: 60, text: 20000, short: 300, mapNodes: 120, items: 60, questions: 60 } as const

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
}

export function emptyBlock(type: BlockType): LessonBlock {
  const id = newId()
  switch (type) {
    case 'text': return { id, type, md: '' }
    case 'image': return { id, type, path: '', caption: '' }
    case 'video': return { id, type, url: '', caption: '' }
    case 'link': return { id, type, url: '', title: '', note: '' }
    case 'callout': return { id, type, tone: 'tip', md: '' }
    case 'mindmap': return { id, type, root: { id: newId(), label: '', children: [{ id: newId(), label: '', children: [] }] } }
    case 'steps': return { id, type, items: [{ id: newId(), title: '', md: '' }] }
    case 'flashcards': return { id, type, cards: [{ id: newId(), front: '', back: '', hint: '' }] }
    case 'quiz': return { id, type, intro: '', questions: [{ text: '', options: [{ letter: 'A', label: '' }, { letter: 'B', label: '' }], answer: 'A' }] }
  }
}

export function emptyDoc(title = ''): LessonDoc {
  return { eqLesson: 2, sections: [{ id: newId(), title, blocks: [emptyBlock('text')] }] }
}

export function isLessonDocText(content: string | null | undefined): boolean {
  return !!content && content.trimStart().startsWith('{"eqLesson"')
}

export function serializeLessonDoc(doc: LessonDoc): string {
  return JSON.stringify({ eqLesson: 2, sections: doc.sections })
}

/** Any stored content → a document (JSON as is, legacy Markdown converted). */
export function parseLessonContent(content: string | null | undefined): LessonDoc {
  const text = content ?? ''
  if (isLessonDocText(text)) {
    try {
      const doc = sanitizeLessonDoc(JSON.parse(text))
      if (doc) return doc
    } catch { /* fall through: show it as text rather than nothing */ }
  }
  return markdownToLessonDoc(text)
}

// ── Validation (server and client share it) ─────────────────────────────────

const str = (v: unknown, max: number = LIMITS.short): string => (typeof v === 'string' ? v.slice(0, max) : '')
const idOf = (v: unknown): string => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : newId())

export function isSafeHttpsUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 2000) return false
  try { return new URL(v).protocol === 'https:' } catch { return false }
}

function sanitizeNode(v: unknown, budget: { n: number }, depth: number): MapNode | null {
  if (!v || typeof v !== 'object' || budget.n <= 0 || depth > 6) return null
  budget.n--
  const o = v as Record<string, unknown>
  const children = Array.isArray(o.children)
    ? o.children.map(c => sanitizeNode(c, budget, depth + 1)).filter((c): c is MapNode => !!c)
    : []
  return { id: idOf(o.id), label: str(o.label), children }
}

function sanitizeBlock(v: unknown): LessonBlock | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const id = idOf(o.id)
  switch (o.type) {
    case 'text': return { id, type: 'text', md: str(o.md, LIMITS.text) }
    case 'image': return { id, type: 'image', path: str(o.path, 300), caption: str(o.caption) }
    case 'video': return { id, type: 'video', url: isSafeHttpsUrl(o.url) ? o.url : '', caption: str(o.caption) }
    case 'link': return { id, type: 'link', url: isSafeHttpsUrl(o.url) ? o.url : '', title: str(o.title), note: str(o.note, 1000) }
    case 'callout': return { id, type: 'callout', tone: CALLOUT_TONES.includes(o.tone as CalloutTone) ? o.tone as CalloutTone : 'info', md: str(o.md, LIMITS.text) }
    case 'mindmap': {
      const root = sanitizeNode(o.root, { n: LIMITS.mapNodes }, 0)
      return root ? { id, type: 'mindmap', root } : null
    }
    case 'steps': {
      const items = (Array.isArray(o.items) ? o.items : []).slice(0, LIMITS.items).map(i => {
        const r = (i ?? {}) as Record<string, unknown>
        return { id: idOf(r.id), title: str(r.title), md: str(r.md, 4000) }
      })
      return { id, type: 'steps', items }
    }
    case 'flashcards': {
      const cards = (Array.isArray(o.cards) ? o.cards : []).slice(0, LIMITS.items).map(c => {
        const r = (c ?? {}) as Record<string, unknown>
        return { id: idOf(r.id), front: str(r.front), back: str(r.back, 1000), hint: str(r.hint) }
      })
      return { id, type: 'flashcards', cards }
    }
    case 'quiz': {
      const questions = (Array.isArray(o.questions) ? o.questions : []).slice(0, LIMITS.questions).map(q => {
        const r = (q ?? {}) as Record<string, unknown>
        const options = (Array.isArray(r.options) ? r.options : []).slice(0, 6).map(op => {
          const p = (op ?? {}) as Record<string, unknown>
          return { letter: str(p.letter, 2), label: str(p.label, 1000) }
        })
        return { text: str(r.text, 2000), options, answer: str(r.answer, 2000) }
      })
      return { id, type: 'quiz', intro: str(o.intro, 2000), questions }
    }
    default: return null
  }
}

/** Untrusted JSON → a well-formed document, or null when it is not one. */
export function sanitizeLessonDoc(v: unknown): LessonDoc | null {
  if (!v || typeof v !== 'object' || (v as { eqLesson?: unknown }).eqLesson !== 2) return null
  const raw = (v as { sections?: unknown }).sections
  if (!Array.isArray(raw)) return null
  const sections = raw.slice(0, LIMITS.sections).map(s => {
    const r = (s ?? {}) as Record<string, unknown>
    const blocks = (Array.isArray(r.blocks) ? r.blocks : []).slice(0, LIMITS.blocks)
      .map(sanitizeBlock).filter((b): b is LessonBlock => !!b)
    return { id: idOf(r.id), title: str(r.title), blocks }
  })
  return { eqLesson: 2, sections }
}

export function imagePaths(doc: LessonDoc): string[] {
  return doc.sections.flatMap(s => s.blocks.flatMap(b => (b.type === 'image' && b.path ? [b.path] : [])))
}

/** Plain text for list excerpts (no JSON leaks into the lessons list). */
export function lessonPlainText(content: string | null | undefined): string {
  if (!isLessonDocText(content)) return (content ?? '').replace(/[#*`]/g, '')
  const doc = parseLessonContent(content)
  return doc.sections.flatMap(s => [s.title, ...s.blocks.map(b =>
    b.type === 'text' || b.type === 'callout' ? b.md : b.type === 'image' || b.type === 'video' ? b.caption : b.type === 'link' ? b.title : '')])
    .join(' ').replace(/[#*`=]/g, '').replace(/\s+/g, ' ').trim()
}

// ── Legacy / AI Markdown → document ─────────────────────────────────────────

export const VOCAB_RE = /^[-*]\s+\*\*(.+?)\*\*\s*[—–:-]\s*(.+?)(?:\s*\|\|(.+?)\|\|)?\s*$/
const ANSWER_RE = /^(?:\*\*)?\s*(?:Answer|الإجابة|الاجابة|الجواب)\s*(?:\*\*)?\s*[::]\s*(?:\*\*)?\s*(.+?)(?:\*\*)?\s*$/i
const OPTION_RE = /^[-*]?\s*(?:\*\*)?([A-Da-dأ-د])(?:\*\*)?[).\-–]\s+(.+)$/

export function parseQuizMarkdown(body: string): { intro: string; questions: QuizQuestion[] } {
  const parts = body.split(/^###\s+/m)
  const questions: QuizQuestion[] = []
  for (const part of parts.slice(1)) {
    const lines = part.split('\n')
    const textLines: string[] = []
    const options: { letter: string; label: string }[] = []
    let answer = ''
    for (const line of lines.slice(1)) {
      const ans = line.match(ANSWER_RE)
      if (ans) { answer = ans[1].trim(); continue }
      const opt = line.match(OPTION_RE)
      if (opt) { options.push({ letter: opt[1].toUpperCase(), label: opt[2].trim() }); continue }
      if (options.length === 0) textLines.push(line)
    }
    // "### Q1" headings only number the question; "### <question text>" (the
    // topic generator's shape) carries the question itself.
    const heading = lines[0].trim()
    const body = textLines.join('\n').trim()
    const numbered = /^(?:Q|س|سؤال)?\s*\d+[.):]?$/i.test(heading)
    const text = numbered ? body : [heading, body].filter(Boolean).join('\n')
    if (text && answer) questions.push({ text, options, answer })
  }
  return { intro: parts[0].trim(), questions }
}

/** "- a\n  - b" outline (from a ```mindmap fence) → tree; the first top line is the root. */
export function outlineToMap(outline: string, fallbackRoot: string): MapNode {
  const root: MapNode = { id: newId(), label: fallbackRoot, children: [] }
  const stack: { indent: number; node: MapNode }[] = []
  let rootTaken = false
  for (const raw of outline.split('\n')) {
    const m = raw.match(/^(\s*)[-*+]\s+(.+)$/) ?? raw.match(/^(\s*)(\S.*)$/)
    if (!m) continue
    const indent = m[1].replace(/\t/g, '  ').length
    const label = m[2].replace(/[*_`#]/g, '').trim().slice(0, LIMITS.short)
    if (!label) continue
    if (!rootTaken && indent === 0 && stack.length === 0) { root.label = label; rootTaken = true; stack.push({ indent: -1, node: root }); continue }
    if (stack.length === 0) stack.push({ indent: -1, node: root })
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop()
    const node: MapNode = { id: newId(), label, children: [] }
    stack[stack.length - 1].node.children.push(node)
    stack.push({ indent, node })
  }
  return root
}

const CALLOUT_RE = /^>\s*\*\*\s*(Note|Tip|Warning|Remember|ملاحظة|نصيحة|تنبيه|تذكر|تذكّر)\s*[:：]?\s*\*\*\s*[:：]?\s*(.*)$/i
function toneOf(word: string): CalloutTone {
  const w = word.toLowerCase()
  if (/tip|نصيحة/.test(w)) return 'tip'
  if (/warn|تنبيه/.test(w)) return 'warning'
  if (/remember|تذك/.test(w)) return 'remember'
  return 'info'
}

function sectionBodyToBlocks(body: string): LessonBlock[] {
  const quiz = parseQuizMarkdown(body)
  if (quiz.questions.length > 0) return [{ id: newId(), type: 'quiz', intro: quiz.intro, questions: quiz.questions }]

  const blocks: LessonBlock[] = []
  let text: string[] = []
  const flushText = () => {
    const md = text.join('\n').trim()
    if (md) blocks.push({ id: newId(), type: 'text', md })
    text = []
  }
  const lines = body.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // ```mindmap / ```steps fences emitted by the lesson prompt.
    const fence = line.trim().match(/^```(mindmap|steps)\s*$/i)
    if (fence) {
      const inner: string[] = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) inner.push(lines[i++])
      flushText()
      if (fence[1].toLowerCase() === 'mindmap') blocks.push({ id: newId(), type: 'mindmap', root: outlineToMap(inner.join('\n'), '') })
      else {
        const items = inner.map(l => l.replace(/^\s*(?:\d+[.)]|[-*])\s*/, '').trim()).filter(Boolean).map(l => {
          const [title, ...rest] = l.split(/\s*[—–:]\s+/)
          return { id: newId(), title: title.replace(/\*\*/g, ''), md: rest.join(' — ') }
        })
        if (items.length) blocks.push({ id: newId(), type: 'steps', items })
      }
      continue
    }
    const vocab = line.match(VOCAB_RE)
    if (vocab) {
      flushText()
      const card = { id: newId(), front: vocab[1].trim(), back: vocab[2].trim(), hint: vocab[3]?.trim() ?? '' }
      const last = blocks[blocks.length - 1]
      if (last?.type === 'flashcards') last.cards.push(card)
      else blocks.push({ id: newId(), type: 'flashcards', cards: [card] })
      continue
    }
    const callout = line.match(CALLOUT_RE)
    if (callout) {
      flushText()
      const md = [callout[2]]
      while (i + 1 < lines.length && /^>\s?/.test(lines[i + 1])) md.push(lines[++i].replace(/^>\s?/, ''))
      blocks.push({ id: newId(), type: 'callout', tone: toneOf(callout[1]), md: md.join('\n').trim() })
      continue
    }
    // A ### heading starts a new text block, so the teacher can move parts around.
    if (/^###\s+/.test(line) && text.some(l => l.trim())) flushText()
    text.push(line)
  }
  flushText()
  return blocks
}

export function markdownToLessonDoc(content: string): LessonDoc {
  const sections: LessonSection[] = []
  const preamble: string[] = []
  let current: { title: string; lines: string[] } | null = null
  const all: { title: string; lines: string[] }[] = []
  let inCode = false
  for (const line of content.split('\n')) {
    if (/^```/.test(line.trim())) inCode = !inCode
    const m = !inCode && line.match(/^##\s+(.+)$/)
    if (m) { current = { title: m[1].replace(/[#*_`]/g, '').trim(), lines: [] }; all.push(current) }
    else if (current) current.lines.push(line)
    else preamble.push(line)
  }
  const pre = preamble.join('\n').trim()
  if (pre) {
    if (all.length) all[0].lines.unshift(pre, '')
    else all.push({ title: '', lines: [pre] })
  }
  for (const s of all) {
    const blocks = sectionBodyToBlocks(s.lines.join('\n'))
    sections.push({ id: newId(), title: s.title, blocks: blocks.length ? blocks : [] })
  }
  if (sections.length === 0) return emptyDoc()
  return { eqLesson: 2, sections }
}

/** The lesson's own concept tree, for the map view: an authored mind map if any, else sections › headings. */
export function lessonOutline(doc: LessonDoc, title: string): MapNode {
  return {
    id: 'root',
    label: title,
    children: doc.sections.map(s => ({
      id: s.id,
      label: s.title,
      children: s.blocks.flatMap(b => {
        if (b.type === 'text') {
          return [...b.md.matchAll(/^###\s+(.+)$/gm)].map((m, i) => ({ id: `${b.id}-${i}`, label: m[1].replace(/[*_`]/g, '').trim(), children: [] }))
        }
        if (b.type === 'steps') return b.items.slice(0, 8).map(it => ({ id: it.id, label: it.title, children: [] }))
        return []
      }).slice(0, 10),
    })),
  }
}
