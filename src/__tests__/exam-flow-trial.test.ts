// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'

// A student's exam end to end on the Neon trial: start → draft → submit →
// no second submit, through the real routes, SQL layer, RLS and the
// start_exam_attempt / finalize_exam_submission functions. Only "who is
// signed in" comes from the test. The answer key must never reach the
// student, and the roster and the institution are enforced.
// Runs with `npm run test:neon`.

const who = vi.hoisted(() => ({ ctx: null as null | { sub: string; tenant_id: string | null } }))
vi.mock('@/lib/auth/current', () => ({
  currentCtx: async () => (who.ctx ? { ...who.ctx, email: null, role: 'student', is_active: true, must_change_password: false } : null),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/exam-files', () => ({ signFileMap: async () => ({}) }))
// no per-test throttling on the trial
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ allowed: true, remaining: 1, resetAt: 0 }) }))

const READY = !!(process.env.NEON_GATEWAY_DATABASE_URL && process.env.NEON_DATABASE_URL)

describe.skipIf(!READY)('exam flow on the trial', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const tag = `ef${Date.now()}`
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const ids = { A: '', B: '', teacher: '', student: '', outsider: '', foreign: '', group: '', exam: '', draftExam: '' }
  const QUESTIONS = [
    { id: 'q1', type: 'mcq', text: 'Two plus two', options: ['3', '4'], correct_answer: '4', points: 2 },
    { id: 'q2', type: 'mcq', text: 'Capital', options: ['A', 'B'], correct_answer: 'B', points: 3 },
  ]

  async function person(role: string, tenant: string) {
    const [u] = await owner`insert into ba."user" (name, email, "emailVerified") values (${role}, ${role + Math.random().toString(36).slice(2, 7) + tag + '@ef-test.test'}, true) returning id`
    await owner`update public.users set role = ${role}, tenant_id = ${tenant} where id = ${u.id}`
    return u.id as string
  }
  const as = (student: string, tenant: string | null) => { who.ctx = { sub: student, tenant_id: tenant } }
  const call = async (route: 'start' | 'draft' | 'submit', body: unknown) => {
    const mod = route === 'start' ? await import('@/app/api/exam/start/route')
      : route === 'draft' ? await import('@/app/api/exam/draft/route') : await import('@/app/api/exam/submit/route')
    const res = await mod.POST(new Request(`https://eduquest.test/api/exam/${route}`, { method: 'POST', body: JSON.stringify(body) }))
    return { status: res.status, text: await res.text() }
  }

  beforeAll(async () => {
    ids.A = (await owner`insert into public.tenants (name, slug, code) values ('EA', ${tag + 'a'}, ${code()}) returning id`)[0].id
    ids.B = (await owner`insert into public.tenants (name, slug, code) values ('EB', ${tag + 'b'}, ${code()}) returning id`)[0].id
    ids.teacher = await person('teacher', ids.A)
    ids.student = await person('student', ids.A)
    ids.outsider = await person('student', ids.A)
    ids.foreign = await person('student', ids.B)
    ids.group = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.A}, ${ids.teacher}, 'G') returning id`)[0].id
    await owner`insert into public.group_students (group_id, student_id) values (${ids.group}, ${ids.student})`
    ids.exam = (await owner`insert into public.exams (tenant_id, teacher_id, group_id, title, duration_minutes, questions, is_published, type)
      values (${ids.A}, ${ids.teacher}, ${ids.group}, 'Exam', 30, ${owner.json(QUESTIONS)}, true, 'exam') returning id`)[0].id
  }, 90_000)
  afterAll(async () => {
    await owner`delete from public.exam_submissions where exam_id = ${ids.exam}`
    await owner`delete from public.exams where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.groups where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from ba."user" where email like ${'%' + tag + '%'}`
    await owner`delete from public.tenants where id in (${ids.A}, ${ids.B})`
    await owner.end()
  }, 90_000)

  it('a student outside the group is refused, without a question', async () => {
    as(ids.outsider, ids.A)
    const { status, text } = await call('start', { examId: ids.exam })
    expect(status).toBe(403)
    expect(text).not.toContain('Two plus two')
  }, 60_000)

  it('a student of another institution does not even see the exam', async () => {
    as(ids.foreign, ids.B)
    const { status, text } = await call('start', { examId: ids.exam })
    expect(status).toBe(404)
    expect(text).not.toContain('Two plus two')
  }, 60_000)

  it('the student starts: questions arrive without the answer key; a second start resumes', async () => {
    as(ids.student, ids.A)
    const first = await call('start', { examId: ids.exam })
    expect(first.status).toBe(200)
    expect(first.text).not.toContain('correct_answer')
    const body = JSON.parse(first.text)
    expect(body.questions.map((q: { id: string }) => q.id)).toEqual(['q1', 'q2'])
    expect(body.resumed).toBe(false)
    const again = JSON.parse((await call('start', { examId: ids.exam })).text)
    expect(again).toMatchObject({ resumed: true, startedAt: body.startedAt })
  }, 60_000)

  it('the draft is saved server-side and comes back on resume', async () => {
    as(ids.student, ids.A)
    expect((await call('draft', { examId: ids.exam, answers: { q1: '4' } })).status).toBe(200)
    const resumed = JSON.parse((await call('start', { examId: ids.exam })).text)
    expect(resumed.answers_draft).toEqual({ q1: '4' })
  }, 60_000)

  it('another student cannot write into this attempt (the draft touches only the caller\'s own row)', async () => {
    as(ids.outsider, ids.A)
    await call('draft', { examId: ids.exam, answers: { q1: 'hijacked' } })
    const [s] = await owner`select answers_draft from public.exam_submissions where exam_id = ${ids.exam} and student_id = ${ids.student}`
    expect(s.answers_draft).toEqual({ q1: '4' })
  }, 60_000)

  it('submit: the server grades (the client sends no score) and the result is published', async () => {
    as(ids.student, ids.A)
    const { status, text } = await call('submit', { examId: ids.exam, answers: { q1: '4', q2: 'A' } })
    expect(status).toBe(200)
    expect(JSON.parse(text)).toEqual({ score: 2, maxScore: 5, published: true })
    const [s] = await owner`select status, score, max_score from public.exam_submissions where exam_id = ${ids.exam} and student_id = ${ids.student}`
    // the owner client reads numeric columns as text
    expect({ status: s.status, score: Number(s.score), max_score: Number(s.max_score) }).toEqual({ status: 'submitted', score: 2, max_score: 5 })
  }, 60_000)

  it('a second submit and a new start are refused', async () => {
    as(ids.student, ids.A)
    expect((await call('submit', { examId: ids.exam, answers: { q1: '4', q2: 'B' } })).status).toBe(409)
    expect((await call('start', { examId: ids.exam })).status).toBe(409)
    const [s] = await owner`select score from public.exam_submissions where exam_id = ${ids.exam} and student_id = ${ids.student}`
    expect(Number(s.score)).toBe(2)
  }, 60_000)
})
