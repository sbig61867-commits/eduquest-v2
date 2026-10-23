// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Batch 1: /api/exam/start is the only way a student receives an exam's
 * questions. They come back — answer key stripped — only after every check
 * passed and the attempt exists; every refusal carries no question and no
 * draft. The roster check is the real isOnExamRoster (group, course,
 * individual task). The fake database below applies the route's own filters
 * (id, is_published, deleted_at), so a filter the route forgets is a test
 * failure, not a silent pass.
 *
 * Every refusal is checked twice: as a fresh start and as a resume (an
 * attempt already in progress — refresh, reload, second device).
 */

type Exam = {
  id: string; tenant_id: string; group_id: string | null; course_id: string | null
  assigned_student_id: string | null; starts_at: string | null; ends_at: string | null
  seb_config_key: string | null; questions: unknown; is_published: boolean; deleted_at: string | null
}

const QUESTIONS = [
  { id: 'q1', type: 'mcq', text: 'Two plus two', options: ['3', '4'], correct_answer: '4', points: 1 },
  { id: 'q2', type: 'essay', text: 'Explain', correct_answer: '', points: 3 },
]

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const EXAM = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'

const state = vi.hoisted(() => ({
  user: { id: 'student-a' } as { id: string } | null,
  exam: null as Exam | null,
  groupMembers: new Set<string>(),   // `${group}:${student}`
  enrolments: new Set<string>(),     // `${course}:${student}`
  rpc: { data: null as unknown, error: null as null | { message: string; code?: string } },
  rpcCalls: 0,
}))
const db = vi.hoisted(() => ({ answer: (_q: SqlCall): unknown[] | Error => [] }))

// The student's session: their institution comes from the signed context.
vi.mock('@/lib/auth/current', () => ({
  currentCtx: async () => (state.user ? { sub: state.user.id, email: null, role: 'student', tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', is_active: true, must_change_password: false } : null),
}))
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => db.answer(q)))
vi.mock('@/lib/exam-files', () => ({ signFileMap: async (m: Record<string, string> | null) => (m ? { q2: 'https://signed/q2' } : {}) }))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))

import { POST } from '@/app/api/exam/start/route'
import { pgError, type SqlCall } from './helpers/fake-sql'

db.answer = q => {
  if (q.text.startsWith('select e.id, e.tenant_id')) {
    const e = state.exam
    const student = state.user?.id ?? ''
    // what the real statement selects: published, not archived, in the student's institution
    if (!e || e.id !== q.values[q.values.length - 1] || !e.is_published || e.deleted_at !== null || e.tenant_id !== q.ctx.tenantId) return []
    const onRoster = (e.assigned_student_id === null || e.assigned_student_id === student) && (
      e.group_id ? state.groupMembers.has(`${e.group_id}:${student}`)
        : e.course_id ? state.enrolments.has(`${e.course_id}:${student}`) : false)
    return [{ ...e, on_roster: onRoster, group_active: true, in_progress: false }]
  }
  if (q.text.startsWith('select public.start_exam_attempt')) {
    state.rpcCalls++
    // an error without a code stays without one
    return state.rpc.error ? pgError(state.rpc.error.message, state.rpc.error.code ?? '') : [{ r: state.rpc.data }]
  }
  if (q.text.startsWith('select answer_files')) return [{ answer_files: { q2: 'path/q2.webp' } }]
  throw new Error('unexpected statement: ' + q.text)
}

const start = (examId = EXAM) => POST(new Request('https://eduquest.test/api/exam/start', {
  method: 'POST', body: JSON.stringify({ examId }),
}))

const groupExam = (over: Partial<Exam> = {}): Exam => ({
  id: EXAM, tenant_id: TENANT_A, group_id: 'group-a', course_id: null, assigned_student_id: null,
  starts_at: null, ends_at: null, seb_config_key: null, questions: QUESTIONS, is_published: true, deleted_at: null, ...over,
})

const FRESH = { data: { started_at: '2026-09-30T10:00:00.000Z', resumed: false, answers_draft: {} }, error: null }
const RESUMED = { data: { started_at: '2026-09-30T09:00:00.000Z', resumed: true, answers_draft: { q1: '4' } }, error: null }

/** A refused request: the status and code, and nothing of the exam in the body. */
async function expectRefused(status: number, code: string, { rpcRuns = false } = {}) {
  const res = await start()
  expect(res.status).toBe(status)
  const text = await res.text()
  expect(JSON.parse(text)).toMatchObject({ code })
  for (const leak of ['questions', 'Two plus two', 'Explain', 'correct_answer', 'answers_draft', 'startedAt']) {
    expect(text).not.toContain(leak)
  }
  if (!rpcRuns) expect(state.rpcCalls).toBe(0)
}

beforeEach(() => {
  state.user = { id: 'student-a' }
  state.exam = groupExam()
  state.groupMembers = new Set(['group-a:student-a'])
  state.enrolments = new Set()
  state.rpc = FRESH
  state.rpcCalls = 0
})

describe('start: the questions arrive only with a started attempt', () => {
  it('returns the questions without the answer key, in the teacher order', async () => {
    const res = await start()
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain('correct_answer')
    const body = JSON.parse(text)
    expect(body.questions.map((q: { id: string }) => q.id)).toEqual(['q1', 'q2'])
    expect(body.questions[0]).toEqual({ id: 'q1', type: 'mcq', text: 'Two plus two', options: ['3', '4'], points: 1 })
    expect(body).toMatchObject({ startedAt: '2026-09-30T10:00:00.000Z', resumed: false })
    expect(state.rpcCalls).toBe(1)
  })

  it('resume (refresh / reload / second device): same questions, the server draft and the original start time', async () => {
    state.rpc = RESUMED
    const body = await (await start()).json()
    expect(body).toMatchObject({ resumed: true, startedAt: '2026-09-30T09:00:00.000Z', answers_draft: { q1: '4' } })
    expect(body.questions.map((q: { id: string }) => q.id)).toEqual(['q1', 'q2'])
    expect(JSON.stringify(body)).not.toContain('correct_answer')
  })

  it('an individual task resumed by its student also returns their uploaded answer photos', async () => {
    state.exam = groupExam({ assigned_student_id: 'student-a' })
    state.rpc = RESUMED
    const body = await (await start()).json()
    expect(body.answer_files).toEqual({ q2: 'https://signed/q2' })
    expect(body.questions).toHaveLength(2)
  })
})

describe('course exam flow (quiz / task in the course player)', () => {
  beforeEach(() => { state.exam = groupExam({ group_id: null, course_id: 'course-a' }) })

  it('an enrolled student starts it and receives the questions', async () => {
    state.enrolments = new Set(['course-a:student-a'])
    const res = await start()
    expect(res.status).toBe(200)
    expect((await res.json()).questions).toHaveLength(2)
  })

  it('a student not enrolled in the course is refused, with no question', async () => {
    await expectRefused(403, 'notEnrolledInExam')
  })
})

// The review's explicit matrix, as a fresh start AND as a resume.
describe.each([
  ['fresh start', FRESH],
  ['resume of an attempt in progress', RESUMED],
])('refused — %s — never a question, a draft or a start time', (_label, rpcReply) => {
  beforeEach(() => { state.rpc = rpcReply })

  it('before starts_at (the old list handed these questions out early)', async () => {
    state.exam = groupExam({ starts_at: new Date(Date.now() + 3_600_000).toISOString() })
    await expectRefused(403, 'examNotOpen')
  })

  it('unpublished', async () => {
    state.exam = groupExam({ is_published: false })
    await expectRefused(404, 'examNotFound')
  })

  it('deleted (archived): refused by the route before the database is asked', async () => {
    state.exam = groupExam({ deleted_at: '2026-09-30T08:00:00.000Z' })
    await expectRefused(404, 'examNotFound')
  })

  it('another institution: invisible from the student\'s institution, so not found', async () => {
    state.exam = groupExam({ tenant_id: TENANT_B, group_id: 'group-b' })
    await expectRefused(404, 'examNotFound')
  })

  it('another group of the same institution', async () => {
    state.exam = groupExam({ group_id: 'group-other' })
    await expectRefused(403, 'notEnrolledInExam')
  })

  it('another student: a classmate\'s individual task', async () => {
    state.exam = groupExam({ assigned_student_id: 'student-b' })
    await expectRefused(403, 'notEnrolledInExam')
  })

  it('another student: same institution, not on the exam\'s roster', async () => {
    state.user = { id: 'student-c' }
    await expectRefused(403, 'notEnrolledInExam')
  })

  it('after the window closed', async () => {
    state.exam = groupExam({ ends_at: new Date(Date.now() - 60_000).toISOString() })
    await expectRefused(403, 'examEnded')
  })

  it('signed out', async () => {
    state.user = null
    await expectRefused(401, 'unauthorized')
  })
})

describe('refused by the database itself (defense in depth), still without a question', () => {
  // start_exam_attempt raises by name: RAISE EXCEPTION → SQLSTATE P0001.
  const raised = (message: string) => ({ data: null, error: { code: 'P0001', message } })

  it('after submit (no retake): ALREADY_SUBMITTED → 409', async () => {
    state.rpc = raised('ALREADY_SUBMITTED')
    await expectRefused(409, 'examAlreadySubmitted', { rpcRuns: true })
  })

  it('deleted between the route read and the attempt: EXAM_NOT_FOUND → 404', async () => {
    state.rpc = raised('EXAM_NOT_FOUND')
    await expectRefused(404, 'examNotFound', { rpcRuns: true })
  })

  it('removed from the group or the institution meanwhile: NOT_ENROLLED / TENANT_MISMATCH → 403', async () => {
    state.rpc = raised('NOT_ENROLLED')
    await expectRefused(403, 'notEnrolledInExam', { rpcRuns: true })
    state.rpc = raised('TENANT_MISMATCH')
    await expectRefused(403, 'notEnrolledInExam', { rpcRuns: true })
  })

  it('the window checked again in the database: EXAM_NOT_OPEN / EXAM_CLOSED → 403', async () => {
    state.rpc = raised('EXAM_NOT_OPEN')
    await expectRefused(403, 'examNotOpen', { rpcRuns: true })
    state.rpc = raised('EXAM_CLOSED')
    await expectRefused(403, 'examEnded', { rpcRuns: true })
  })
})

describe('an unexpected database failure stays a 500 — never swallowed, never translated', () => {
  it('any other error', async () => {
    state.rpc = { data: null, error: { code: 'XX000', message: 'boom' } }
    await expectRefused(500, 'examStartFailed', { rpcRuns: true })
  })

  it('a raised message that is not one of the known refusals', async () => {
    state.rpc = { data: null, error: { code: 'P0001', message: 'SOMETHING_NEW' } }
    await expectRefused(500, 'examStartFailed', { rpcRuns: true })
  })

  it('a known name inside a longer message (no substring matching)', async () => {
    state.rpc = { data: null, error: { code: 'P0001', message: 'unexpected: NOT_ENROLLED lookup failed' } }
    await expectRefused(500, 'examStartFailed', { rpcRuns: true })
  })

  it('a known name under another SQLSTATE (e.g. a permission error)', async () => {
    state.rpc = { data: null, error: { code: '42501', message: 'EXAM_NOT_FOUND' } }
    await expectRefused(500, 'examStartFailed', { rpcRuns: true })
  })

  it('an error without a code', async () => {
    state.rpc = { data: null, error: { message: 'ALREADY_SUBMITTED' } }
    await expectRefused(500, 'examStartFailed', { rpcRuns: true })
  })
})
