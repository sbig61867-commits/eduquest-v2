import { describe, expect, it } from 'vitest'
import { markdownToRich, richTextFits, richToMarkdown } from '@/lib/lesson-rich-text'

// The rich field must never change what a lesson says: Markdown in, the same
// Markdown out, for everything the student view renders.

const roundTrip = (md: string) => richToMarkdown(markdownToRich(md))

describe('lesson rich text ⇄ Markdown', () => {
  it.each([
    ['paragraph', 'Photosynthesis turns light into energy.'],
    ['bold, italic, highlight, code', 'The **leaf** is *green*, the answer is ==is==, run `npm test`.'],
    ['heading', '### Key ideas'],
    ['bullet list', '- Rouge\n- Bleu\n- Vert'],
    ['numbered list', '1. Read\n2. Answer\n3. Check'],
    ['quote', '> Remember the rule.'],
    ['Arabic with French', 'اللون الأحمر **Rouge** (روج)'],
    ['several blocks', '### Colours\n\nThree colours today.\n\n- Rouge\n- Bleu\n\n> Say them aloud.'],
  ])('%s survives the editor unchanged', (_label, md) => {
    expect(roundTrip(md)).toBe(md)
  })

  it('normalises spacing between blocks (one blank line)', () => {
    expect(roundTrip('First.\n\n\n\nSecond.')).toBe('First.\n\nSecond.')
  })

  it('keeps spaces outside the markers', () => {
    const doc = { type: 'doc' as const, content: [{ type: 'paragraph' as const, content: [
      { type: 'text' as const, text: 'a ' }, { type: 'text' as const, text: 'bold ', marks: [{ type: 'bold' as const }] }, { type: 'text' as const, text: 'word' },
    ] }] }
    expect(richToMarkdown(doc)).toBe('a **bold** word')
  })

  it('never outputs HTML, even from text that looks like it', () => {
    const md = roundTrip('<b>not html</b> & <script>x</script>')
    expect(md).toBe('<b>not html</b> & <script>x</script>') // stays text: the renderer escapes it
  })

  it('tables and code fences keep the plain editor', () => {
    expect(richTextFits('| a | b |\n|---|---|\n| 1 | 2 |')).toBe(false)
    expect(richTextFits('```\ncode\n```')).toBe(false)
    expect(richTextFits('- a list\n\n**bold**')).toBe(true)
  })

  it('an empty block is a single empty paragraph', () => {
    expect(markdownToRich('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
    expect(richToMarkdown(markdownToRich(''))).toBe('')
  })
})
