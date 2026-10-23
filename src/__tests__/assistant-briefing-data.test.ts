// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// loadAssistantBriefing on the SQL layer: ONE unit read as the student (RLS),
// named columns, bounded lists, the student's own submissions only.

type Q = { text: string; values: unknown[]; ctx: { as: string; userId?: string } }
const state = vi.hoisted(() => ({ calls: [] as Q[], rows: {} as Record<string, unknown[]> }))
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => {
  state.calls.push(q as Q)
  if (q.text === 'select * from public.get_student_exam_list()') return state.rows.exams ?? []
  if (q.text.startsWith('select l.id, l.title, l.created_at')) return state.rows.lessons ?? []
  if (q.text.startsWith('select id, title, created_at from public.get_student_announcements()')) return state.rows.announcements ?? []
  if (q.text.startsWith('select exam_id from public.exam_submissions')) return state.rows.subs ?? []
  if (q.text.startsWith('select l.id, l.title from public.lessons l')) return state.rows.linked ?? []
  return new Error('unexpected statement: ' + q.text)
}))

import { loadAssistantBriefing, ASSISTANT_LESSON_LIMIT } from '@/lib/data/assistant-nudges'

const NOW = new Date('2026-10-15T09:00:00Z')
const exam = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: `T-${id}`, type: 'exam', is_published: true, starts_at: null, ends_at: '2026-10-16T09:00:00Z', lesson_id: null, total_points: 0, ...over,
})

beforeEach(() => { state.calls = []; state.rows = {} })

describe('loadAssistantBriefing', () => {
  it('one unit read as the student; lessons by named columns, published, live, in active groups, bounded', async () => {
    await loadAssistantBriefing('stu-1', NOW)
    expect(state.calls).toHaveLength(5)
    expect(state.calls.every(c => c.ctx.as === 'user' && c.ctx.userId === 'stu-1')).toBe(true)
    const lessons = state.calls.find(c => c.text.startsWith('select l.id, l.title, l.created_at'))!
    expect(lessons.text).toContain('where l.is_published and l.deleted_at is null and g.is_active')
    expect(lessons.values).toEqual([ASSISTANT_LESSON_LIMIT])
  })

  it('counts only this student\'s submitted work for listed exams, and drops unpublished exams', async () => {
    state.rows.exams = [exam('a'), exam('b'), exam('hidden', { is_published: false })]
    state.rows.subs = [{ exam_id: 'a' }, { exam_id: 'not-listed' }]
    const { data } = await loadAssistantBriefing('stu-1', NOW)
    const subs = state.calls.find(c => c.text.startsWith('select exam_id from public.exam_submissions'))!
    expect(subs.text).toContain("where student_id = $ and status = 'submitted'")
    expect(subs.values[0]).toBe('stu-1')
    expect(data.nudges.filter(n => n.kind === 'due').map(n => n.id)).toEqual(['due:b'])
  })

  it('titles of lessons linked from homework fill in what the latest lessons lack', async () => {
    state.rows.exams = [exam('a', { lesson_id: 'L-known' }), exam('b', { lesson_id: 'L-other' }), exam('c', { lesson_id: 'L-other' })]
    state.rows.lessons = [{ id: 'L-known', title: 'معروف', created_at: '2026-09-01T00:00:00Z' }]
    state.rows.linked = [{ id: 'L-other', title: 'مرتبط' }, { id: 'L-known', title: 'not this one' }]
    const { data } = await loadAssistantBriefing('stu-1', NOW)
    expect(data.plan.map(p => p.lesson)).toEqual(['معروف', 'مرتبط', 'مرتبط'])
    expect(data.lessons).toEqual([{ id: 'L-known', title: 'معروف', created_at: '2026-09-01T00:00:00Z' }])
  })

  it('a failed read is reported and yields an empty briefing, never a partial one', async () => {
    state.rows.exams = new Error('boom') as unknown as unknown[]
    const { data, error } = await loadAssistantBriefing('stu-1', NOW)
    expect(error).toEqual({ message: 'boom' })
    expect(data).toEqual({ nudges: [], plan: [], lessons: [] })
  })
})
