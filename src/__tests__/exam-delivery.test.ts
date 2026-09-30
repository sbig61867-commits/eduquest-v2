// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { studentQuestions } from '@/lib/exam-delivery'
import { loadStudentExamList, metaFromLegacyRow } from '@/lib/data/student-exams'

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

describe('the list facts replace the questions', () => {
  it('counts, flags hand-graded questions and totals points like the old callers did', () => {
    const meta = metaFromLegacyRow({ id: 'e1', questions: teacherQuestions } as unknown as Parameters<typeof metaFromLegacyRow>[0])
    expect(meta).toMatchObject({ question_count: 3, has_manual_questions: true, total_points: 8 })
    expect('questions' in meta).toBe(false)
  })

  it('an all-automatic exam has no hand-graded questions; no questions means zero', () => {
    const auto = metaFromLegacyRow({ id: 'e2', questions: teacherQuestions.slice(0, 2) } as unknown as Parameters<typeof metaFromLegacyRow>[0])
    expect(auto.has_manual_questions).toBe(false)
    const empty = metaFromLegacyRow({ id: 'e3', questions: null } as unknown as Parameters<typeof metaFromLegacyRow>[0])
    expect(empty).toMatchObject({ question_count: 0, has_manual_questions: false, total_points: 0 })
  })
})

describe('loadStudentExamList', () => {
  const row = { id: 'e1', title: 'Midterm', question_count: 3, has_manual_questions: true, total_points: '8' }

  it('reads get_student_exam_list and never returns questions', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [row], error: null })
    const { data, error } = await loadStudentExamList({ rpc } as never)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('get_student_exam_list')
    expect(error).toBeNull()
    expect(data[0]).toMatchObject({ id: 'e1', question_count: 3, total_points: 8 })
    expect(JSON.stringify(data)).not.toContain('"questions":')
  })

  it('before the migration: falls back to the old feed and strips the questions here', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'not found' } })
      .mockResolvedValueOnce({ data: [{ id: 'e1', title: 'Midterm', questions: teacherQuestions }], error: null })
    const { data } = await loadStudentExamList({ rpc } as never)
    expect(rpc).toHaveBeenLastCalledWith('get_student_exams')
    expect(data[0]).toMatchObject({ id: 'e1', question_count: 3, has_manual_questions: true, total_points: 8 })
    expect(JSON.stringify(data)).not.toContain('Two plus two')
  })

  it('any other error returns an empty list with the error, and does not fall back', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } })
    const { data, error } = await loadStudentExamList({ rpc } as never)
    expect(data).toEqual([])
    expect(error).toMatchObject({ message: 'denied' })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
