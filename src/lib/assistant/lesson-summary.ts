import { parseLessonContent, type LessonBlock, type LessonDoc, type MapNode } from '@/lib/lesson-doc'
import { ANSWER_LABEL_RE } from '@/content/assistant/patterns'

// ── Structured lesson summary (no AI provider) ────────────────────
// Built from the lesson's own blocks: section titles, the opening idea of each
// section, the teacher's "remember"/"tip" callouts, steps, bold key terms,
// flashcard terms and the mind map. Nothing leaves the server, so it works
// while no provider is approved for institutional content (privacy.ts).
//
// Never read: quiz `answer` fields (only the question count is reported), and
// any sentence that carries an answer label ("الإجابة:", "Answer:") is dropped.

export const SUMMARY_LIMITS = { sections: 8, points: 8, terms: 12, concepts: 8, sentence: 220 } as const

export interface SectionGist { title: string; gist: string }

export interface LessonSummary {
  title: string
  /** Rounded up, at least 1. */
  readingMinutes: number
  sectionCount: number
  sections: SectionGist[]
  keyPoints: string[]
  terms: string[]
  /** Mind map: the root and its first-level branches. */
  concepts: { root: string; branches: string[] } | null
  practice: { quizQuestions: number; flashcards: number }
}

/** Markdown → one line of plain text (no links, images, emphasis or headings). */
export function plainText(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, m => m.replace(/`/g, ''))
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~)(.+?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim()
}

/** First sentence (Arabic or Latin punctuation), capped. Empty when it is an answer line. */
export function firstSentence(md: string, max: number = SUMMARY_LIMITS.sentence): string {
  for (const line of md.split(/\n+/)) {
    if (ANSWER_LABEL_RE.test(line)) continue
    const text = plainText(line)
    if (!text) continue
    const m = text.match(/^.+?[.!?؟。](?=\s|$)/)
    const sentence = (m ? m[0] : text).trim()
    return sentence.length > max ? sentence.slice(0, max - 1).trimEnd() + '…' : sentence
  }
  return ''
}

/** **bold** terms in a Markdown block, in order. */
export function boldTerms(md: string): string[] {
  const out: string[] = []
  for (const m of md.matchAll(/\*\*([^*\n]{2,60})\*\*/g)) {
    const term = plainText(m[1]).replace(/[:：\-–—]+$/, '').trim()
    if (term && !ANSWER_LABEL_RE.test(term + ':')) out.push(term)
  }
  return out
}

function wordCount(doc: LessonDoc): number {
  let words = 0
  const add = (s: string) => { words += s.split(/\s+/).filter(Boolean).length }
  for (const s of doc.sections) {
    add(s.title)
    for (const b of s.blocks) {
      if (b.type === 'text' || b.type === 'callout') add(b.md)
      else if (b.type === 'steps') b.items.forEach(i => { add(i.title); add(i.md) })
      else if (b.type === 'flashcards') b.cards.forEach(c => { add(c.front); add(c.back) })
      else if (b.type === 'quiz') b.questions.forEach(q => add(q.text))
    }
  }
  return words
}

function pushUnique(list: string[], value: string, cap: number) {
  const v = value.trim()
  if (!v || list.length >= cap) return
  const key = v.toLowerCase()
  if (!list.some(x => x.toLowerCase() === key)) list.push(v)
}

const POINT_TONES = new Set(['remember', 'tip', 'info'])

function gistOf(blocks: LessonBlock[]): string {
  for (const b of blocks) {
    if (b.type === 'text' || b.type === 'callout') {
      const s = firstSentence(b.md)
      if (s) return s
    }
    if (b.type === 'steps' && b.items[0]) {
      const s = firstSentence(b.items[0].md) || plainText(b.items[0].title)
      if (s) return s
    }
  }
  return ''
}

function mindMap(root: MapNode): { root: string; branches: string[] } | null {
  const label = plainText(root.label)
  const branches: string[] = []
  for (const c of root.children) pushUnique(branches, plainText(c.label), SUMMARY_LIMITS.concepts)
  return label || branches.length ? { root: label, branches } : null
}

export function summarizeLesson(title: string, content: string | null | undefined): LessonSummary {
  const doc = parseLessonContent(content)
  const sections: SectionGist[] = []
  const keyPoints: string[] = []
  const terms: string[] = []
  let concepts: LessonSummary['concepts'] = null
  let quizQuestions = 0
  let flashcards = 0

  for (const section of doc.sections) {
    const gist = gistOf(section.blocks)
    const sectionTitle = plainText(section.title)
    if ((sectionTitle || gist) && sections.length < SUMMARY_LIMITS.sections) sections.push({ title: sectionTitle, gist })

    for (const b of section.blocks) {
      switch (b.type) {
        case 'text':
          boldTerms(b.md).forEach(t => pushUnique(terms, t, SUMMARY_LIMITS.terms))
          break
        case 'callout':
          if (POINT_TONES.has(b.tone)) pushUnique(keyPoints, firstSentence(b.md), SUMMARY_LIMITS.points)
          boldTerms(b.md).forEach(t => pushUnique(terms, t, SUMMARY_LIMITS.terms))
          break
        case 'steps':
          b.items.forEach(i => pushUnique(keyPoints, plainText(i.title) || firstSentence(i.md), SUMMARY_LIMITS.points))
          break
        case 'flashcards':
          flashcards += b.cards.length
          b.cards.forEach(c => pushUnique(terms, plainText(c.front), SUMMARY_LIMITS.terms))
          break
        case 'mindmap':
          concepts ??= mindMap(b.root)
          break
        case 'quiz':
          // Count only: question text, options and answers are never summarised.
          quizQuestions += b.questions.length
          break
        default:
          break
      }
    }
  }

  return {
    title: plainText(title),
    readingMinutes: Math.max(1, Math.ceil(wordCount(doc) / 180)),
    sectionCount: doc.sections.length,
    sections,
    keyPoints,
    terms,
    concepts,
    practice: { quizQuestions, flashcards },
  }
}
