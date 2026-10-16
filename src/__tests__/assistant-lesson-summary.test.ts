import { describe, it, expect } from 'vitest'
import { summarizeLesson, firstSentence, boldTerms, plainText, SUMMARY_LIMITS } from '@/lib/assistant/lesson-summary'
import { serializeLessonDoc, type LessonSection } from '@/lib/lesson-doc'

// The lesson summary is built from the lesson's own blocks, with no AI provider.
// Quiz answers must never reach it.

const doc = (sections: LessonSection[]) => serializeLessonDoc({ eqLesson: 2, sections })

const LESSON = doc([
  {
    id: 's1', title: 'ما **الكسر**؟',
    blocks: [
      { id: 'b1', type: 'text', md: 'الكسر جزء من كل. نكتبه بسطًا ومقامًا.\n\nالمقام هو **عدد الأجزاء** و**البسط** ما نأخذه.' },
      { id: 'b2', type: 'callout', tone: 'remember', md: 'لا يكون المقام صفرًا أبدًا. هذه قاعدة.' },
      { id: 'b3', type: 'callout', tone: 'warning', md: 'خطأ شائع: جمع المقامات.' },
    ],
  },
  {
    id: 's2', title: 'جمع الكسور',
    blocks: [
      { id: 'b4', type: 'steps', items: [
        { id: 'i1', title: 'وحّد المقامات', md: 'اضرب كل كسر.' },
        { id: 'i2', title: 'اجمع البسوط', md: '' },
      ] },
      { id: 'b5', type: 'flashcards', cards: [
        { id: 'c1', front: 'المقام', back: 'الرقم السفلي', hint: '' },
        { id: 'c2', front: 'البسط', back: 'الرقم العلوي', hint: '' },
      ] },
      { id: 'b6', type: 'mindmap', root: { id: 'r', label: 'الكسور', children: [
        { id: 'r1', label: 'البسط', children: [] },
        { id: 'r2', label: 'المقام', children: [{ id: 'r21', label: 'لا يساوي صفرًا', children: [] }] },
      ] } },
      { id: 'b7', type: 'quiz', intro: 'اختبر نفسك', questions: [
        { text: 'كم يساوي ½ + ¼؟', options: [{ letter: 'أ', label: 'ثلاثة أرباع السر' }, { letter: 'ب', label: 'نصف' }], answer: 'SECRET-ANSWER-ثلاثة أرباع' },
        { text: 'هل المقام صفر؟', options: [], answer: 'SECRET-ANSWER-لا' },
      ] },
    ],
  },
  {
    id: 's3', title: 'تمرين محلول',
    blocks: [{ id: 'b8', type: 'text', md: 'الإجابة: 3/4 لأن المقام المشترك 4.\nنراجع الخطوات معًا.' }],
  },
])

describe('summarizeLesson', () => {
  const s = summarizeLesson('**الكسور** العادية', LESSON)

  it('gives each section its title and opening idea', () => {
    expect(s.title).toBe('الكسور العادية')
    expect(s.sectionCount).toBe(3)
    expect(s.sections[0]).toEqual({ title: 'ما الكسر؟', gist: 'الكسر جزء من كل.' })
    expect(s.sections[1]).toEqual({ title: 'جمع الكسور', gist: 'اضرب كل كسر.' })
  })

  it('skips answer lines when picking a section\'s opening idea', () => {
    expect(s.sections[2]).toEqual({ title: 'تمرين محلول', gist: 'نراجع الخطوات معًا.' })
  })

  it('keeps the teacher\'s reminders and steps as key points, not warnings', () => {
    expect(s.keyPoints).toEqual(['لا يكون المقام صفرًا أبدًا.', 'وحّد المقامات', 'اجمع البسوط'])
  })

  it('collects bold terms and flashcard fronts once each', () => {
    expect(s.terms).toEqual(['عدد الأجزاء', 'البسط', 'المقام'])
  })

  it('keeps the mind map root and its first branches', () => {
    expect(s.concepts).toEqual({ root: 'الكسور', branches: ['البسط', 'المقام'] })
  })

  it('counts practice without reading the quiz', () => {
    expect(s.practice).toEqual({ quizQuestions: 2, flashcards: 2 })
    const json = JSON.stringify(s)
    expect(json).not.toContain('SECRET-ANSWER')
    expect(json).not.toContain('ثلاثة أرباع السر')
    expect(json).not.toContain('كم يساوي')
    expect(json).not.toContain('3/4')
  })

  it('reports at least one minute of reading', () => {
    expect(s.readingMinutes).toBe(1)
    const long = doc([{ id: 'x', title: 't', blocks: [{ id: 'y', type: 'text', md: 'كلمة '.repeat(400) }] }])
    expect(summarizeLesson('t', long).readingMinutes).toBe(3)
  })

  it('handles legacy Markdown and empty content', () => {
    const legacy = summarizeLesson('قديم', '## المقدمة\nهذه فكرة أولى. وثانية.\n\n> [!remember]\n> تذكر **القاعدة**.')
    expect(legacy.sections[0]?.gist).toBe('هذه فكرة أولى.')
    expect(summarizeLesson('فارغ', null)).toMatchObject({ title: 'فارغ', readingMinutes: 1, keyPoints: [], terms: [], concepts: null })
  })

  it('respects its caps', () => {
    const many = doc(Array.from({ length: 12 }, (_, i) => ({
      id: `s${i}`, title: `قسم ${i}`,
      blocks: [{ id: `b${i}`, type: 'callout' as const, tone: 'tip' as const, md: `نقطة رقم ${i}. **مصطلح ${i}** و**آخر ${i}**` }],
    })))
    const r = summarizeLesson('t', many)
    expect(r.sections).toHaveLength(SUMMARY_LIMITS.sections)
    expect(r.keyPoints).toHaveLength(SUMMARY_LIMITS.points)
    expect(r.terms).toHaveLength(SUMMARY_LIMITS.terms)
  })
})

describe('text helpers', () => {
  it('strips Markdown to plain text', () => {
    expect(plainText('## عنوان **غامق** و[رابط](https://x.test) ![صورة](a.png)')).toBe('عنوان غامق ورابط')
  })

  it('cuts at the first Arabic or Latin sentence end and caps the length', () => {
    expect(firstSentence('ما الكسر؟ جزء من كل.')).toBe('ما الكسر؟')
    expect(firstSentence('Answer: 4\nA fraction is a part. More.')).toBe('A fraction is a part.')
    expect(firstSentence('أ'.repeat(300), 20)).toHaveLength(20)
  })

  it('never treats an answer label as a term', () => {
    expect(boldTerms('**الإجابة** و**المقام**')).toEqual(['المقام'])
  })
})
