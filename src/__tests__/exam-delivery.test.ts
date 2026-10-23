// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { studentQuestions } from '@/lib/exam-delivery'

// The list is read as the student on the SQL layer: each statement is recorded.
const db = vi.hoisted(() => ({ calls: [] as { text: string; ctx: unknown }[], reply: [] as unknown[] | Error }))
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => {
  db.calls.push({ text: q.text, ctx: q.ctx })
  return db.reply
}))
import { loadStudentExamList } from '@/lib/data/student-exams'

/**
 * Batch 1 (PERFORMANCE_CONTRACT.md P3): the exam list carries metadata only;
 * questions leave the server for a student only from /api/exam/start.
 */

const teacherQuestions = [
  { id: 'q1', type: 'mcq', text: 'Two plus two', options: ['3', '4'], correct_answer: '4', points: 2 },
  { id: 'q2', type: 'true_false', text: 'The sky is blue', correct_answer: 'True', points: 1 },
  { id: 'q3', type: 'essay', text: 'Explain', correct_answer: '', points: 5 },
]

describe('studentQuestions — what /api/exam/start hands the student', () => {
  it('drops the answer key and nothing else, in the teacher order', () => {
    const out = studentQuestions(teacherQuestions)
    expect(out.map(q => q.id)).toEqual(['q1', 'q2', 'q3'])
    expect(JSON.stringify(out)).not.toContain('correct_answer')
    expect(out[0]).toEqual({ id: 'q1', type: 'mcq', text: 'Two plus two', options: ['3', '4'], points: 2 })
  })

  it('never mutates the stored questions', () => {
    const copy = structuredClone(teacherQuestions)
    studentQuestions(copy)
    expect(copy).toEqual(teacherQuestions)
  })

  it('tolerates a missing or malformed questions column', () => {
    expect(studentQuestions(null)).toEqual([])
    expect(studentQuestions({ q: 1 })).toEqual([])
    expect(studentQuestions([null, 'x', 3, ['a']])).toEqual([])
  })
})

describe('loadStudentExamList', () => {
  const row = { id: 'e1', title: 'Midterm', question_count: 3, has_manual_questions: true, total_points: '8' }

  beforeEach(() => { db.calls = []; db.reply = [] })

  it('reads get_student_exam_list as the student and never returns questions', async () => {
    db.reply = [row]
    const { data, error } = await loadStudentExamList('stu-1')
    expect(db.calls).toEqual([{ text: 'select * from public.get_student_exam_list()', ctx: { as: 'user', userId: 'stu-1' } }])
    expect(error).toBeNull()
    expect(data[0]).toMatchObject({ id: 'e1', question_count: 3, total_points: 8 })
    expect(JSON.stringify(data)).not.toContain('"questions":')
  })

  it('an error returns an empty list with the error; the old feed is never called', async () => {
    db.reply = Object.assign(new Error('denied'), { code: '42501' })
    const { data, error } = await loadStudentExamList('stu-1')
    expect(data).toEqual([])
    expect(error).toMatchObject({ message: 'denied' })
    expect(db.calls).toHaveLength(1)
  })
})
