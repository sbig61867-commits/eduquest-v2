import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  normaliseForMatch,
  matchLessonTitle,
  wantsAccountOverview,
  loadAccountText,
} from '@/lib/assistant/student-context'

// A chainable fake: every builder method returns the same chain, and awaiting
// it yields the table's data. No network, no real client.
function fakeClient(tables: Record<string, unknown>, rpcs: Record<string, unknown>): SupabaseClient {
  const chain = (data: unknown): unknown => {
    const p: unknown = new Proxy({}, {
      get: (_t, key) => (key === 'then'
        ? (resolve: (v: unknown) => unknown) => resolve({ data, error: null })
        : () => p),
    })
    return p
  }
  return {
    from: (table: string) => chain(tables[table] ?? null),
    rpc: (name: string) => chain(rpcs[name] ?? null),
  } as unknown as SupabaseClient
}

describe('normaliseForMatch', () => {
  it('folds Arabic letter variants, tatweel and diacritics', () => {
    expect(normaliseForMatch('الإجابة')).toBe(normaliseForMatch('الاجابة'))
    expect(normaliseForMatch('مَكتبة')).toBe(normaliseForMatch('مكتبه'))
    expect(normaliseForMatch('الـجابة')).toBe(normaliseForMatch('الجابه'))
  })
})

describe('matchLessonTitle', () => {
  const lessons = [
    { id: 'a', title: 'Cells' },
    { id: 'b', title: 'Cell division' },
    { id: 'c', title: 'Ok' },
  ]

  it('picks the longest title that appears in the message', () => {
    expect(matchLessonTitle('explain cell division please', lessons)).toBe('b')
  })

  it('matches Arabic titles regardless of letter variants', () => {
    const ar = [{ id: 'x', title: 'الإنسان والبيئة' }]
    expect(matchLessonTitle('لخّص درس الانسان والبيئه', ar)).toBe('x')
  })

  it('never matches a title shorter than three characters', () => {
    expect(matchLessonTitle('ok, what now?', lessons)).toBeNull()
  })

  it('returns null when nothing matches', () => {
    expect(matchLessonTitle('what is photosynthesis?', lessons)).toBeNull()
  })
})

describe('wantsAccountOverview', () => {
  it('is true for account and overview questions', () => {
    expect(wantsAccountOverview('اعطني موجز كامل عن حسابي')).toBe(true)
    expect(wantsAccountOverview('what is my homework?')).toBe(true)
    expect(wantsAccountOverview('ما الجديد عندي؟')).toBe(true)
  })

  it('is false for a plain content question', () => {
    expect(wantsAccountOverview('اشرح الدرس الأول')).toBe(false)
  })
})

describe('loadAccountText', () => {
  const visibleExam = { id: 'e1', title: 'Midterm', type: 'exam', duration_minutes: 60, starts_at: null, ends_at: null, is_published: true, group_name: 'G1', course_title: null, lesson_id: null, question_count: 3, has_manual_questions: false, total_points: 10 }

  it('lists lessons, exams, visible grades and announcements, bounded', async () => {
    const client = fakeClient(
      {
        lessons: [{ title: 'Cells', groups: { name: 'G1' } }],
        exam_submissions: [{ exam_id: 'e1', score: 8, max_score: 10, grading_status: 'graded', submitted_at: '2026-10-01' }],
      },
      {
        get_student_exam_list: [visibleExam],
        get_student_announcements: [{ title: 'Welcome', body: 'x'.repeat(300), created_at: '2026-10-01T00:00:00Z' }],
      },
    )
    const text = await loadAccountText(client, 'stu-1')
    expect(text).toContain('Cells (G1)')
    expect(text).toContain('Midterm')
    expect(text).toContain('Midterm: 8/10')
    expect(text).toContain('Welcome')
    expect(text!.length).toBeLessThan(600)
  })

  it('drops an exam row that carries questions (it is refused, never trimmed)', async () => {
    const client = fakeClient(
      {},
      { get_student_exam_list: [{ ...visibleExam, title: 'Hidden', questions: [{ text: 'q', correct_answer: 'B' }] }, visibleExam] },
    )
    const text = await loadAccountText(client, 'stu-1')
    expect(text).not.toContain('Hidden')
    expect(text).toContain('Midterm')
  })

  it('returns null when an announcement body fails the answer policy (fail closed)', async () => {
    const client = fakeClient({}, { get_student_announcements: [{ title: 'Quiz', body: 'Solution: x=2', created_at: '2026-10-01' }] })
    expect(await loadAccountText(client, 'stu-1')).toBeNull()
  })

  it('returns null when the student has nothing to show', async () => {
    expect(await loadAccountText(fakeClient({}, {}), 'stu-1')).toBeNull()
  })
})
