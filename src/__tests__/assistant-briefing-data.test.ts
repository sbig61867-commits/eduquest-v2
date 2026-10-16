import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// loadAssistantBriefing: named columns, bounded lists, everything through the
// caller's session, and the student's own submissions only.

const state = vi.hoisted(() => ({
  exams: [] as Record<string, unknown>[],
  calls: [] as { table: string; ops: unknown[][] }[],
  rows: {} as Record<string, unknown[]>,
}))

vi.mock('@/lib/data/student-exams', () => ({
  loadStudentExamList: async () => ({ data: state.exams, error: null }),
}))

import { loadAssistantBriefing, ASSISTANT_LESSON_LIMIT } from '@/lib/data/assistant-nudges'

function makeDb() {
  return {
    from(table: string) {
      const entry = { table, ops: [] as unknown[][] }
      state.calls.push(entry)
      const key = () => (table === 'lessons' && entry.ops.some(o => o[0] === 'in') ? 'linkedLessons' : table)
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) {
        b[m] = (...args: unknown[]) => { entry.ops.push([m, ...args]); return b }
      }
      b.then = (res: (v: unknown) => void) => res({ data: state.rows[key()] ?? [], error: null })
      return b
    },
    rpc: async (fn: string) => ({ data: fn === 'get_student_announcements' ? state.rows.announcements ?? [] : null, error: null }),
  } as unknown as SupabaseClient
}

const NOW = new Date('2026-10-15T09:00:00Z')
const exam = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: `T-${id}`, type: 'exam', is_published: true, starts_at: null, ends_at: '2026-10-16T09:00:00Z', lesson_id: null, ...over,
})

beforeEach(() => {
  state.exams = []
  state.calls = []
  state.rows = {}
})

describe('loadAssistantBriefing', () => {
  it('reads lessons by named columns, published, live, in active groups, bounded', async () => {
    await loadAssistantBriefing(makeDb(), 'stu-1', NOW)
    const lessons = state.calls.find(c => c.table === 'lessons')!
    expect(lessons.ops).toEqual([
      ['select', 'id, title, created_at, groups!inner(is_active)'],
      ['eq', 'is_published', true],
      ['is', 'deleted_at', null],
      ['eq', 'groups.is_active', true],
      ['order', 'created_at', { ascending: false }],
      ['limit', ASSISTANT_LESSON_LIMIT],
    ])
    // No exams → no submissions read.
    expect(state.calls.some(c => c.table === 'exam_submissions')).toBe(false)
  })

  it('reads only this student\'s submitted work for the listed exams, and drops unpublished exams', async () => {
    state.exams = [exam('a'), exam('b'), exam('hidden', { is_published: false })]
    state.rows.exam_submissions = [{ exam_id: 'a' }]
    const { data } = await loadAssistantBriefing(makeDb(), 'stu-1', NOW)
    const subs = state.calls.find(c => c.table === 'exam_submissions')!
    expect(subs.ops).toEqual([
      ['select', 'exam_id'],
      ['eq', 'student_id', 'stu-1'],
      ['eq', 'status', 'submitted'],
      ['in', 'exam_id', ['a', 'b']],
      ['limit', 2],
    ])
    expect(data.nudges.filter(n => n.kind === 'due').map(n => n.id)).toEqual(['due:b'])
  })

  it('fetches titles of linked lessons it does not already have, in one bounded read', async () => {
    state.exams = [exam('a', { lesson_id: 'L-known' }), exam('b', { lesson_id: 'L-other' }), exam('c', { lesson_id: 'L-other' })]
    state.rows.lessons = [{ id: 'L-known', title: 'معروف', created_at: '2026-09-01T00:00:00Z' }]
    state.rows.linkedLessons = [{ id: 'L-other', title: 'مرتبط' }]
    const { data } = await loadAssistantBriefing(makeDb(), 'stu-1', NOW)
    const linked = state.calls.filter(c => c.table === 'lessons' && c.ops.some(o => o[0] === 'in'))
    expect(linked).toHaveLength(1)
    expect(linked[0].ops).toEqual([
      ['select', 'id, title'],
      ['in', 'id', ['L-other']],
      ['eq', 'is_published', true],
      ['is', 'deleted_at', null],
      ['limit', 1],
    ])
    expect(data.plan.map(p => p.lesson)).toEqual(['معروف', 'مرتبط', 'مرتبط'])
    expect(data.lessons).toEqual([{ id: 'L-known', title: 'معروف', created_at: '2026-09-01T00:00:00Z' }])
  })
})
