import { describe, expect, it } from 'vitest'
import {
  emptyDoc, imagePaths, isLessonDocText, lessonOutline, lessonPlainText, markdownToLessonDoc, parseLessonContent,
  sanitizeLessonDoc, serializeLessonDoc,
} from '@/lib/lesson-doc'
import { isOwnLessonImage } from '@/lib/exam-files'

const AI_LESSON = `## المفاهيم

\`\`\`mindmap
- البناء الضوئي
  - المدخلات
    - ضوء
  - المخرجات
\`\`\`

شرح عام.

### الكلوروفيل
صبغة خضراء.

> **تذكّر:** يحدث في البلاستيدات.

\`\`\`steps
1. امتصاص الضوء — في الكلوروفيل
2. إنتاج الجلوكوز — في دورة كالفن
\`\`\`

## Vocabulary
- **leaf** — the green part of a plant ||ورقة||
- **root** — the part under the ground ||جذر||

## اختبر نفسك

### Q1
ما لون الكلوروفيل؟
- A) أحمر
- B) أخضر
**Answer:** B

### Which gas do plants release?
- A) Oxygen
- B) Helium
Answer: A
`

describe('markdownToLessonDoc', () => {
  const doc = markdownToLessonDoc(AI_LESSON)

  it('splits ## sections', () => {
    expect(doc.sections.map(s => s.title)).toEqual(['المفاهيم', 'Vocabulary', 'اختبر نفسك'])
  })

  it('turns fences, callouts and ### headings into separate blocks', () => {
    const types = doc.sections[0].blocks.map(b => b.type)
    expect(types).toEqual(['mindmap', 'text', 'text', 'callout', 'steps'])
    const map = doc.sections[0].blocks[0]
    expect(map.type === 'mindmap' && map.root.label).toBe('البناء الضوئي')
    expect(map.type === 'mindmap' && map.root.children.map(c => c.label)).toEqual(['المدخلات', 'المخرجات'])
    const callout = doc.sections[0].blocks[3]
    expect(callout.type === 'callout' && callout.tone).toBe('remember')
    const steps = doc.sections[0].blocks[4]
    expect(steps.type === 'steps' && steps.items.map(i => i.title)).toEqual(['امتصاص الضوء', 'إنتاج الجلوكوز'])
  })

  it('turns vocabulary lines into flashcards (VOCAB_RE contract)', () => {
    const b = doc.sections[1].blocks[0]
    expect(b.type).toBe('flashcards')
    expect(b.type === 'flashcards' && b.cards[0]).toMatchObject({ front: 'leaf', back: 'the green part of a plant', hint: 'ورقة' })
  })

  it('turns both question shapes into one quiz block', () => {
    const b = doc.sections[2].blocks[0]
    expect(b.type).toBe('quiz')
    if (b.type !== 'quiz') return
    expect(b.questions).toHaveLength(2)
    expect(b.questions[0]).toMatchObject({ text: 'ما لون الكلوروفيل؟', answer: 'B' })
    expect(b.questions[1].text).toBe('Which gas do plants release?')
  })

  it('keeps a plain Markdown lesson as one section of text', () => {
    const d = markdownToLessonDoc('Just a paragraph.')
    expect(d.sections).toHaveLength(1)
    expect(d.sections[0].blocks[0]).toMatchObject({ type: 'text', md: 'Just a paragraph.' })
  })
})

describe('stored format', () => {
  it('round-trips through JSON and is recognised', () => {
    const doc = markdownToLessonDoc(AI_LESSON)
    const text = serializeLessonDoc(doc)
    expect(isLessonDocText(text)).toBe(true)
    expect(parseLessonContent(text)).toEqual(doc)
    expect(isLessonDocText('## Markdown')).toBe(false)
  })

  it('sanitize drops unknown blocks, non-https links and stray fields', () => {
    const doc = sanitizeLessonDoc({
      eqLesson: 2,
      sections: [{ id: 's1', title: 'T', evil: 1, blocks: [
        { id: 'a', type: 'script', src: 'x' },
        { id: 'b', type: 'link', url: 'javascript:alert(1)', title: 'x', note: '' },
        { id: 'c', type: 'video', url: 'http://youtube.com/watch?v=abc', caption: '' },
        { id: 'd', type: 'text', md: 'ok', html: '<b>' },
      ] }],
    })!
    expect(doc.sections[0].blocks.map(b => b.type)).toEqual(['link', 'video', 'text'])
    expect(doc.sections[0].blocks[0]).toMatchObject({ url: '' })
    expect(doc.sections[0].blocks[1]).toMatchObject({ url: '' })
    expect(doc.sections[0].blocks[2]).toEqual({ id: 'd', type: 'text', md: 'ok' })
    expect(sanitizeLessonDoc({ eqLesson: 1, sections: [] })).toBeNull()
  })

  it('lists image paths and gives list excerpts without JSON', () => {
    const doc = emptyDoc('Intro')
    doc.sections[0].blocks = [{ id: 'i', type: 'image', path: 't/lessons/u/x.png', caption: 'My summary' }, { id: 't', type: 'text', md: '**Hello**' }]
    expect(imagePaths(doc)).toEqual(['t/lessons/u/x.png'])
    const plain = lessonPlainText(serializeLessonDoc(doc))
    expect(plain).toBe('Intro My summary Hello')
  })

  it('outlines sections and ### headings for the lesson map', () => {
    const o = lessonOutline(markdownToLessonDoc(AI_LESSON), 'Lesson')
    expect(o.children.map(c => c.label)).toEqual(['المفاهيم', 'Vocabulary', 'اختبر نفسك'])
    expect(o.children[0].children.map(c => c.label)).toContain('الكلوروفيل')
  })
})

describe('isOwnLessonImage', () => {
  const tenant = '11111111-1111-1111-1111-111111111111'
  const teacher = '22222222-2222-2222-2222-222222222222'
  const file = '33333333-3333-3333-3333-333333333333.webp'
  it('accepts only the author\'s own lesson uploads', () => {
    expect(isOwnLessonImage(`${tenant}/lessons/${teacher}/${file}`, tenant, teacher)).toBe(true)
    expect(isOwnLessonImage(`${tenant}/tasks/${teacher}/${file}`, tenant, teacher)).toBe(false)
    expect(isOwnLessonImage(`${tenant}/lessons/other/${file}`, tenant, teacher)).toBe(false)
    expect(isOwnLessonImage(`x/${tenant}/lessons/${teacher}/${file}`, tenant, teacher)).toBe(false)
    expect(isOwnLessonImage(`${tenant}/lessons/${teacher}/../${file}`, tenant, teacher)).toBe(false)
  })
})

describe('cn keeps a colour next to a D3 type-size token', async () => {
  const { cn } = await import('@/lib/utils')
  it('text-fg survives text-body-sm, and sizes still override each other', () => {
    expect(cn('text-fg text-body-sm')).toBe('text-fg text-body-sm')
    expect(cn('text-meta', 'text-h2')).toBe('text-h2')
    expect(cn('text-fg-3', 'text-fg')).toBe('text-fg')
  })
})
