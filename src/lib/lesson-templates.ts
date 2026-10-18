// Ready-made blocks for the lesson editor (owner, 2026-10-18). Every template is
// an EXISTING block type with starter text, so a block the teacher adds looks
// exactly like the ones the AI generates, and storage, the student view and the
// server's validation are unchanged. The starter text comes from the editor's
// messages (the teacher's language) through `tr`.

import { newId, type LessonBlock } from './lesson-doc'

export const TEMPLATES = [
  'paragraph', 'definition', 'example', 'rule', 'warning', 'keyPoints', 'comparison', 'vocabulary', 'steps', 'practice',
] as const
export type TemplateKey = (typeof TEMPLATES)[number]

export function templateBlock(key: TemplateKey, tr: (k: string) => string): LessonBlock {
  const id = newId()
  const v = (k: string) => tr(`${key}.${k}`)
  switch (key) {
    case 'paragraph':
      return { id, type: 'text', md: '' }
    case 'definition':
      return { id, type: 'callout', tone: 'info', md: `**${v('term')}** — ${v('body')}` }
    case 'example':
      return { id, type: 'callout', tone: 'tip', md: `**${v('question')}** ${v('questionBody')}\n\n**${v('answer')}** ${v('answerBody')}` }
    case 'rule':
      return { id, type: 'callout', tone: 'remember', md: `**${v('title')}** ${v('body')}` }
    case 'warning':
      return { id, type: 'callout', tone: 'warning', md: v('body') }
    case 'keyPoints':
      return { id, type: 'text', md: `### ${v('title')}\n\n- ${v('one')}\n- ${v('two')}\n- ${v('three')}` }
    case 'comparison':
      return { id, type: 'text', md: `| ${v('aspect')} | ${v('first')} | ${v('second')} |\n|---|---|---|\n| ${v('row')} | … | … |\n| ${v('row')} | … | … |` }
    case 'vocabulary':
      return { id, type: 'flashcards', cards: [{ id: newId(), front: v('word'), back: v('meaning'), hint: v('pronunciation') }] }
    case 'steps':
      return { id, type: 'steps', items: [{ id: newId(), title: v('first'), md: '' }, { id: newId(), title: v('second'), md: '' }] }
    case 'practice':
      return { id, type: 'quiz', intro: '', questions: [{ text: v('question'), options: [{ letter: 'A', label: v('a') }, { letter: 'B', label: v('b') }], answer: 'A' }] }
  }
}
