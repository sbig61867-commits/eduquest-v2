// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactElement } from 'react'

/**
 * Batch 1, course flow: the course player's quiz / task items read the
 * metadata-only student exam list; the questions come later from
 * /api/exam/start (exam-start-questions.test.ts, "course exam flow").
 */

const rpcCalls: string[] = []
const LIST = [
  { id: 'ex-quiz', course_id: 'course-1', title: 'Unit quiz', type: 'exam', question_count: 4, has_manual_questions: false, total_points: 4 },
  { id: 'ex-task', course_id: 'course-1', title: 'Unit task', type: 'homework', question_count: 2, has_manual_questions: true, total_points: 10 },
  // Linked from this course's item but belonging to another course: not available here.
  { id: 'ex-foreign', course_id: 'course-2', title: 'Elsewhere', type: 'exam', question_count: 9, has_manual_questions: false, total_points: 9 },
]
const UNITS = [{
  id: 'u1', title: 'Unit 1', order_index: 0, is_published: true,
  unit_items: [
    { id: 'i-quiz', type: 'quiz', title: 'Quiz', content: { exam_id: 'ex-quiz' }, order_index: 0, is_published: true },
    { id: 'i-task', type: 'task', title: 'Task', content: { exam_id: 'ex-task' }, order_index: 1, is_published: true },
    { id: 'i-foreign', type: 'quiz', title: 'Foreign', content: { exam_id: 'ex-foreign' }, order_index: 2, is_published: true },
  ],
}]
const TABLES: Record<string, { one?: unknown; many?: unknown[] }> = {
  course_enrollments: { one: { course_id: 'course-1' } },
  courses: { one: { id: 'course-1', title: 'English', description: null, language: 'en', has_levels: false, is_published: true, users: { full_name: 'T' } } },
  users: { one: { tenant_id: 'tenant-1' } },
  course_levels: { many: [] },
  course_units: { many: UNITS },
  student_progress: { many: [] },
  exam_submissions: { many: [{ exam_id: 'ex-quiz', status: 'submitted', score: 4, max_score: 4, grading_status: 'published' }] },
}

vi.mock('@/lib/supabase/server', () => ({
  getAuthUser: async () => ({ id: 'student-1', tenant_id: 'tenant-1' }),
  createClient: async () => ({
    from: (table: string) => {
      const result = { data: TABLES[table]?.many ?? [] }
      const chain: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
        maybeSingle: async () => ({ data: TABLES[table]?.one ?? null }),
        single: async () => ({ data: TABLES[table]?.one ?? null }),
      }
      for (const m of ['select', 'eq', 'is', 'in', 'order']) chain[m] = () => chain
      return chain
    },
    rpc: async (name: string) => { rpcCalls.push(name); return { data: LIST, error: null } },
  }),
}))
vi.mock('@/lib/settings', () => ({ getExamPolicies: async () => ({ violation_warning_threshold: 5 }) }))
vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('redirect') }, notFound: () => { throw new Error('notFound') } }))
vi.mock('@/components/shared/page-title', () => ({ PageTitle: () => null }))
vi.mock('@/app/(student)/student/courses/[id]/course-player-client', () => ({ CoursePlayerClient: () => null }))

import StudentCoursePlayerPage from '@/app/(student)/student/courses/[id]/page'

type PlayerProps = { assessments: Record<string, { exam: Record<string, unknown> }>; completedIds: string[] }

async function playerProps(): Promise<PlayerProps> {
  const page = await StudentCoursePlayerPage({ params: Promise.resolve({ id: 'course-1' }) }) as ReactElement<{ children: ReactElement[] }>
  const player = page.props.children.find(c => (c.props as Partial<PlayerProps>).assessments)!
  return player.props as unknown as PlayerProps
}

beforeEach(() => { rpcCalls.length = 0 })

describe('course player assessments', () => {
  it('reads the metadata-only list, never the question feed', async () => {
    await playerProps()
    expect(rpcCalls).toEqual(['get_student_exam_list'])
  })

  it('serves each linked quiz / task of THIS course as metadata — counts, no questions', async () => {
    const { assessments } = await playerProps()
    expect(Object.keys(assessments).sort()).toEqual(['ex-quiz', 'ex-task'])
    expect(assessments['ex-quiz'].exam).toMatchObject({ question_count: 4, type: 'exam' })
    expect(assessments['ex-task'].exam).toMatchObject({ question_count: 2, type: 'homework' })
    for (const a of Object.values(assessments)) expect('questions' in a.exam).toBe(false)
  })

  it('an exam of another course linked from this course is not available here', async () => {
    const { assessments } = await playerProps()
    expect(assessments['ex-foreign']).toBeUndefined()
  })

  it('a handed-in quiz still counts as done for course progress', async () => {
    const { completedIds } = await playerProps()
    expect(completedIds).toContain('i-quiz')
    expect(completedIds).not.toContain('i-task')
  })
})
