// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'

// Teacher exam management end to end on the Neon trial, with two institutions:
// create, edit, results, individual task, delete — and proctoring events from
// the student side. Real routes, SQL layer, RLS and database functions; only
// "who is signed in" comes from the test. Every cross-teacher and
// cross-institution attempt must be refused and change nothing.
// Runs with `npm run test:neon`.

type Who = { sub: string; role: string; tenant_id: string }
const who = vi.hoisted(() => ({ ctx: null as null | Who }))
vi.mock('@/lib/auth/current', () => ({
  currentCtx: async () => (who.ctx ? { ...who.ctx, email: null, is_active: true, must_change_password: false } : null),
  currentUser: async () => (who.ctx ? { id: who.ctx.sub, role: who.ctx.role, tenant_id: who.ctx.tenant_id } : null),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ allowed: true, remaining: 1, resetAt: 0 }) }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))
// exam files are storage (step 11); results only sign what exists
vi.mock('@/lib/exam-files', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/exam-files')>()),
  signExamFiles: async () => [],
}))

const READY = !!(process.env.NEON_GATEWAY_DATABASE_URL && process.env.NEON_DATABASE_URL)

describe.skipIf(!READY)('teacher exam management on the trial', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const tag = `te${Date.now()}`
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const ids = { A: '', B: '', tA: '', tA2: '', tB: '', sA: '', sOut: '', gA: '', gA2: '', gB: '', exam: '' }
  const QUESTIONS = [{ id: 'q1', type: 'mcq', text: 'Two plus two', options: ['3', '4'], correct_answer: '4', points: 2 }]

  async function person(role: string, tenant: string) {
    const [u] = await owner`insert into ba."user" (name, email, "emailVerified") values (${role}, ${role + Math.random().toString(36).slice(2, 7) + tag + '@te-test.test'}, true) returning id`
    await owner`update public.users set role = ${role}, tenant_id = ${tenant} where id = ${u.id}`
    return u.id as string
  }
  const as = (sub: string, role: string, tenant: string) => { who.ctx = { sub, role, tenant_id: tenant } }
  const send = async (mod: { [m: string]: unknown }, method: string, url: string, body?: unknown) => {
    const handler = mod[method] as (r: Request) => Promise<Response>
    const res = await handler(new Request(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
    return { status: res.status, body: await res.json().catch(() => null) }
  }
  const exams = () => import('@/app/api/exams/route')
  const results = () => import('@/app/api/exams/results/route')
  const individual = () => import('@/app/api/exams/individual/route')

  beforeAll(async () => {
    ids.A = (await owner`insert into public.tenants (name, slug, code) values ('TA', ${tag + 'a'}, ${code()}) returning id`)[0].id
    ids.B = (await owner`insert into public.tenants (name, slug, code) values ('TB', ${tag + 'b'}, ${code()}) returning id`)[0].id
    ids.tA = await person('teacher', ids.A)
    ids.tA2 = await person('teacher', ids.A)
    ids.tB = await person('teacher', ids.B)
    ids.sA = await person('student', ids.A)
    ids.sOut = await person('student', ids.A)
    ids.gA = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.A}, ${ids.tA}, 'GA') returning id`)[0].id
    ids.gA2 = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.A}, ${ids.tA2}, 'GA2') returning id`)[0].id
    ids.gB = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.B}, ${ids.tB}, 'GB') returning id`)[0].id
    await owner`insert into public.group_students (group_id, student_id) values (${ids.gA}, ${ids.sA})`
  }, 90_000)
  afterAll(async () => {
    await owner`delete from public.exam_submissions where exam_id in (select id from public.exams where tenant_id in (${ids.A}, ${ids.B}))`
    await owner`delete from public.exams where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.groups where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from ba."user" where email like ${'%' + tag + '%'}`
    await owner`delete from public.tenants where id in (${ids.A}, ${ids.B})`
    await owner.end()
  }, 90_000)

  it('create: a teacher in their own group; not in a colleague\'s (403); not in another institution\'s (404)', async () => {
    as(ids.tA, 'teacher', ids.A)
    const ok = await send(await exams(), 'POST', 'http://x/api/exams', { title: 'Midterm', group_id: ids.gA, questions: QUESTIONS, proctoring_enabled: true })
    expect(ok.status).toBe(201)
    expect(ok.body.groups).toEqual({ name: 'GA' })
    ids.exam = ok.body.id
    expect((await send(await exams(), 'POST', 'http://x/api/exams', { title: 'X', group_id: ids.gA2, questions: QUESTIONS })).status).toBe(403)
    expect((await send(await exams(), 'POST', 'http://x/api/exams', { title: 'X', group_id: ids.gB, questions: QUESTIONS })).status).toBe(404)
    const [n] = await owner`select count(*)::int n from public.exams where tenant_id in (${ids.A}, ${ids.B})`
    expect(n.n).toBe(1)
  }, 90_000)

  it('a teacher demoted a moment ago cannot create, even with a fresh-looking session', async () => {
    await owner`update public.users set role = 'student' where id = ${ids.tA}`
    as(ids.tA, 'teacher', ids.A)
    const res = await send(await exams(), 'POST', 'http://x/api/exams', { title: 'Late', group_id: ids.gA, questions: QUESTIONS })
    await owner`update public.users set role = 'teacher' where id = ${ids.tA}`
    expect(res.status).toBe(403)
    const [n] = await owner`select count(*)::int n from public.exams where title = 'Late'`
    expect(n.n).toBe(0)
  }, 90_000)

  it('edit: the owner publishes; a colleague and another institution cannot touch it', async () => {
    as(ids.tA2, 'teacher', ids.A)
    expect((await send(await exams(), 'PATCH', 'http://x/api/exams', { id: ids.exam, title: 'Hacked' })).status).toBe(403)
    as(ids.tB, 'teacher', ids.B)
    expect((await send(await exams(), 'PATCH', 'http://x/api/exams', { id: ids.exam, title: 'Hacked' })).status).toBe(403)
    as(ids.tA, 'teacher', ids.A)
    const ok = await send(await exams(), 'PATCH', 'http://x/api/exams', { id: ids.exam, is_published: true })
    expect(ok.status).toBe(200)
    const [e] = await owner`select title, is_published from public.exams where id = ${ids.exam}`
    expect(e).toEqual({ title: 'Midterm', is_published: true })
  }, 90_000)

  it('proctoring events from the student land in the attempt; an outsider\'s are refused', async () => {
    as(ids.sA, 'student', ids.A)
    const start = await import('@/app/api/exam/start/route')
    expect((await send(start, 'POST', 'https://x/api/exam/start', { examId: ids.exam })).status).toBe(200)
    const events = await import('@/app/api/proctor/events/route')
    const ok = await send(events, 'POST', 'http://x/api/proctor/events', { examId: ids.exam, events: [{ type: 'tab_switch' }] })
    expect(ok.body).toMatchObject({ ok: true, appended: 1 })
    as(ids.sOut, 'student', ids.A)
    expect((await send(events, 'POST', 'http://x/api/proctor/events', { examId: ids.exam, events: [{ type: 'tab_switch' }] })).status).toBe(403)
    const [s] = await owner`select jsonb_array_length(proctoring_events) n from public.exam_submissions where exam_id = ${ids.exam} and student_id = ${ids.sA}`
    expect(s.n).toBe(1)
  }, 90_000)

  it('results: the owner sees the roster with names; a colleague and another institution do not', async () => {
    as(ids.sA, 'student', ids.A)
    const submit = await import('@/app/api/exam/submit/route')
    expect((await send(submit, 'POST', 'https://x/api/exam/submit', { examId: ids.exam, answers: { q1: '4' } })).status).toBe(200)
    as(ids.tA, 'teacher', ids.A)
    const ok = await send(await results(), 'GET', `http://x/api/exams/results?exam_id=${ids.exam}`)
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ title: 'Midterm', group_name: 'GA', roster_count: 1, submitted_count: 1, max_score: 2 })
    expect(ok.body.results[0]).toMatchObject({ student_id: ids.sA, submitted: true, score: 2, violations: 1 })
    expect(ok.body.results[0].name).not.toBe('unknown')
    as(ids.tA2, 'teacher', ids.A)
    expect((await send(await results(), 'GET', `http://x/api/exams/results?exam_id=${ids.exam}`)).status).toBe(403)
    as(ids.tB, 'teacher', ids.B)
    expect((await send(await results(), 'GET', `http://x/api/exams/results?exam_id=${ids.exam}`)).status).toBe(403)
  }, 90_000)

  it('individual task: only for a student of the teacher\'s own group, sourced from their own exam', async () => {
    as(ids.tA, 'teacher', ids.A)
    const task = { student_id: ids.sA, group_id: ids.gA, source_exam_id: ids.exam, title: 'Follow-up', questions: [{ text: 'Explain', type: 'essay' }] }
    expect((await send(await individual(), 'POST', 'http://x/api/exams/individual', { ...task, student_id: ids.sOut })).status).toBe(400)
    expect((await send(await individual(), 'POST', 'http://x/api/exams/individual', { ...task, group_id: ids.gA2 })).status).toBe(403)
    as(ids.tB, 'teacher', ids.B)
    expect((await send(await individual(), 'POST', 'http://x/api/exams/individual', task)).status).toBe(404)
    as(ids.tA, 'teacher', ids.A)
    const ok = await send(await individual(), 'POST', 'http://x/api/exams/individual', task)
    expect(ok.status).toBe(201)
    const [e] = await owner`select assigned_student_id, source_exam_id, type from public.exams where id = ${ok.body.id}`
    expect(e).toEqual({ assigned_student_id: ids.sA, source_exam_id: ids.exam, type: 'homework' })
  }, 90_000)

  it('delete: a colleague cannot; the owner archives (soft delete by default)', async () => {
    as(ids.tA2, 'teacher', ids.A)
    expect((await send(await exams(), 'DELETE', 'http://x/api/exams', { id: ids.exam })).status).toBe(403)
    as(ids.tA, 'teacher', ids.A)
    const ok = await send(await exams(), 'DELETE', 'http://x/api/exams', { id: ids.exam })
    expect(ok.status).toBe(200)
    expect(ok.body.mode).toBe('archive')
    const [e] = await owner`select deleted_at is not null as archived from public.exams where id = ${ids.exam}`
    expect(e.archived).toBe(true)
  }, 90_000)
})
