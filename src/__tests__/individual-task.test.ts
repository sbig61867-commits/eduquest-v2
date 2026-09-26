import { describe, it, expect } from 'vitest'
import { parseTaskSuggestion, weaknessNote, writtenAnswersText } from '@/lib/individual-task'
import { isOwnTaskAttachment, isSafeQuestionId, sniffImageType, taskAttachmentPath, answerFilePath } from '@/lib/exam-files'
import { buildItems, summarize, isShared, type Assessment, type Submission } from '@/lib/teacher-records'

const TENANT = '11111111-1111-4111-8111-111111111111'
const TEACHER = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'
const FILE = '44444444-4444-4444-8444-444444444444'

describe('parseTaskSuggestion — only a well-formed draft reaches the teacher', () => {
  it('reads JSON wrapped in prose or a code fence', () => {
    const raw = 'Here you go:\n```json\n{"weaknesses":["tense mix-ups: \\"I go yesterday\\""],"title":"Rework","instructions":"Rewrite it.","questions":["Rewrite paragraph 2 in the past tense."]}\n```'
    expect(parseTaskSuggestion(raw)).toEqual({
      weaknesses: ['tense mix-ups: "I go yesterday"'],
      title: 'Rework',
      instructions: 'Rewrite it.',
      questions: ['Rewrite paragraph 2 in the past tense.'],
    })
  })

  it('caps list sizes and lengths, and drops non-strings', () => {
    const raw = JSON.stringify({
      weaknesses: ['a', 'b', 'c', 'd', 'e', 'f', 7, '  '],
      title: 'x'.repeat(500),
      questions: ['1', '2', '3', '4'],
    })
    const s = parseTaskSuggestion(raw)!
    expect(s.weaknesses).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(s.title).toHaveLength(120)
    expect(s.questions).toHaveLength(3)
    expect(s.instructions).toBe('')
  })

  it('rejects replies without weaknesses or questions, and non-JSON', () => {
    expect(parseTaskSuggestion('{"weaknesses":[],"questions":["q"]}')).toBeNull()
    expect(parseTaskSuggestion('{"weaknesses":["w"],"questions":[]}')).toBeNull()
    expect(parseTaskSuggestion('sorry, I cannot help')).toBeNull()
    expect(parseTaskSuggestion('{not json}')).toBeNull()
  })

  it('turns the weak points into the note the student reads', () => {
    expect(weaknessNote(['one', 'two'], 'Do it again.')).toBe('- one\n- two\n\nDo it again.')
    expect(weaknessNote(['one'], '')).toBe('- one')
  })

  it('sends the model only written answers, each with its question', () => {
    const qs = [
      { id: '1', text: 'Pick one', type: 'mcq' },
      { id: '2', text: 'Write about your day', type: 'essay' },
      { id: '3', text: 'Define X', type: 'short_answer' },
      { id: '4', text: 'Unanswered essay', type: 'essay' },
    ]
    expect(writtenAnswersText(qs, { '1': 'B', '2': ' I go school. ', '3': 'a thing' })).toEqual({
      question: 'Write about your day\n---\nDefine X',
      answer: 'I go school.\n---\na thing',
    })
  })
})

describe('exam-files — a path is only accepted where it belongs', () => {
  it('accepts only the teacher\'s own uploads in their own tenant', () => {
    const own = taskAttachmentPath(TENANT, TEACHER, FILE, 'webp')
    expect(isOwnTaskAttachment(own, TENANT, TEACHER)).toBe(true)
    expect(isOwnTaskAttachment(own, TENANT, OTHER)).toBe(false)                      // another teacher's file
    expect(isOwnTaskAttachment(own, OTHER, TEACHER)).toBe(false)                     // another tenant
    expect(isOwnTaskAttachment(answerFilePath(TENANT, FILE, OTHER, '1', 'jpg'), TENANT, TEACHER)).toBe(false) // a student's answer
    expect(isOwnTaskAttachment(`${TENANT}/tasks/${TEACHER}/../../x.png`, TENANT, TEACHER)).toBe(false)
    expect(isOwnTaskAttachment(`${TENANT}/tasks/${TEACHER}/${FILE}.svg`, TENANT, TEACHER)).toBe(false)
    expect(isOwnTaskAttachment(42, TENANT, TEACHER)).toBe(false)
  })

  it('keeps question ids path-safe', () => {
    expect(isSafeQuestionId('1')).toBe(true)
    expect(isSafeQuestionId('q_12-a')).toBe(true)
    expect(isSafeQuestionId('../x')).toBe(false)
    expect(isSafeQuestionId('a/b')).toBe(false)
    expect(isSafeQuestionId('')).toBe(false)
  })

  it('trusts the bytes, not the claimed type', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    const html = new TextEncoder().encode('<html><script>')
    expect(sniffImageType(png)).toBe('image/png')
    expect(sniffImageType(jpg)).toBe('image/jpeg')
    expect(sniffImageType(html)).toBeNull()
  })
})

describe('records — an individual task belongs to its one student', () => {
  const NOW = Date.parse('2026-09-26T12:00:00Z')
  const A = (id: string, over: Partial<Assessment> = {}): Assessment => ({
    id, kind: 'homework', title: id, lessonId: null, lessonTitle: null, createdAt: '2026-09-20T10:00:00Z',
    endsAt: null, maxPoints: 10, source: 'group', ...over,
  })
  const S = (examId: string, studentId: string, score: number, maxScore = 10): Submission => ({
    id: `s-${examId}-${studentId}`, examId, studentId, score, maxScore, gradingStatus: 'published',
    status: 'submitted', submittedAt: '2026-09-21T10:00:00Z', flagged: false,
  })
  const assessments = [
    A('shared'),
    A('mine', { assignedTo: 'amal' }),
    A('theirs', { assignedTo: 'omar' }),
    A('practice', { assignedTo: 'amal', countsTowardGrade: false, maxPoints: 0 }),
  ]

  it('shows a student their own individual tasks and never another student\'s', () => {
    const amal = buildItems(assessments, [], null, NOW, 'amal').map(i => i.assessment.id).sort()
    const omar = buildItems(assessments, [], null, NOW, 'omar').map(i => i.assessment.id).sort()
    expect(amal).toEqual(['mine', 'practice', 'shared'])
    expect(omar).toEqual(['shared', 'theirs'])
  })

  it('keeps a feedback-only task out of every average, but counts it as done', () => {
    const items = buildItems(assessments, [S('shared', 'amal', 6), S('mine', 'amal', 10), S('practice', 'amal', 0, 0)], null, NOW, 'amal')
    const practice = items.find(i => i.assessment.id === 'practice')!
    expect(practice.status).toBe('graded')
    expect(practice.pct).toBeNull()
    const s = summarize(items, [], null)
    expect(s.overallAvg).toBe(80)          // (60 + 100) / 2 — practice not included
    expect(s.homework.submitted).toBe(3)   // but it is handed in
  })

  it('marks which work was set for everyone', () => {
    expect(assessments.filter(isShared).map(a => a.id)).toEqual(['shared'])
  })
})
