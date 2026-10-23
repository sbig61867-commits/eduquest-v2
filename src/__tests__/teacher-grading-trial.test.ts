// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'

// Teacher grading end to end on the Neon trial, with two institutions:
// homework (create/list/edit/delete), grading a submission, the grade export,
// and proctoring appeals (file, resolve, report). Real routes, SQL layer, RLS
// and database functions; only "who is signed in" comes from the test. Every
// cross-teacher and cross-institution attempt must be refused and change nothing.
// Runs with `npm run test:neon`.

type Who = { sub: string; role: string; tenant_id: string }
const who = vi.hoisted(() => ({ ctx: null as null | Who }))
vi.mock('@/lib/auth/current', () => ({
  currentCtx: async () => (who.ctx ? { ...who.ctx, email: null, is_active: true, must_change_password: false } : null),
  currentUser: async () => (who.ctx ? { id: who.ctx.sub, role: who.ctx.role, tenant_id: who.ctx.tenant_id } : null),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ allowed: true, remaining: 1, resetAt: 0 }) }))
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (k: string, v?: Record<string, unknown>) => (v ? `${k}:${JSON.stringify(v)}` : k),
  getLocale: async () => 'en',
}))

const READY = !!(process.env.NEON_GATEWAY_DATABASE_URL && process.env.NEON_DATABASE_URL)

describe.skipIf(!READY)('teacher grading on the trial', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const tag = `tg${Date.now()}`
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const ids = { A: '', B: '', tA: '', tA2: '', tB: '', aB: '', sA: '', gA: '', gA2: '', gB: '', lesson: '', hw: '', exam: '', sub: '', appeal: '' }
  const VIOLATION_AT = '2026-10-23T10:00:00.000Z'
  const QUESTIONS = [{ id: 'q1', type: 'essay', text: 'Explain', points: 10 }]

  async function person(role: string, tenant: string) {
    const [u] = await owner`insert into ba."user" (name, email, "emailVerified") values (${role}, ${role + Math.random().toString(36).slice(2, 7) + tag + '@tg-test.test'}, true) returning id`
    await owner`update public.users set role = ${role}, tenant_id = ${tenant}, full_name = ${role + ' ' + tag} where id = ${u.id}`
    return u.id as string
  }
  const as = (sub: string, role: string, tenant: string) => { who.ctx = { sub, role, tenant_id: tenant } }
  const send = async (mod: { [m: string]: unknown }, method: string, url: string, body?: unknown, params?: unknown) => {
    const handler = mod[method] as (r: Request, p?: unknown) => Promise<Response>
    const res = await handler(new Request(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), params)
    return { status: res.status, body: await res.json().catch(() => null) }
  }
  const homework = () => import('@/app/api/homework/route')
  const grading = () => import('@/app/api/homework/submissions/route')
  const appeals = () => import('@/app/api/appeals/route')
  const appeal = () => import('@/app/api/appeals/[id]/route')
  const report = () => import('@/app/api/appeals/report/route')
  const exportRoute = () => import('@/app/api/grades/export/route')

  beforeAll(async () => {
    ids.A = (await owner`insert into public.tenants (name, slug, code) values ('GA', ${tag + 'a'}, ${code()}) returning id`)[0].id
    ids.B = (await owner`insert into public.tenants (name, slug, code) values ('GB', ${tag + 'b'}, ${code()}) returning id`)[0].id
    ids.tA = await person('teacher', ids.A)
    ids.tA2 = await person('teacher', ids.A)
    ids.tB = await person('teacher', ids.B)
    ids.aB = await person('university_admin', ids.B)
    ids.sA = await person('student', ids.A)
    ids.gA = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.A}, ${ids.tA}, 'GA') returning id`)[0].id
    ids.gA2 = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.A}, ${ids.tA2}, 'GA2') returning id`)[0].id
    ids.gB = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.B}, ${ids.tB}, 'GB') returning id`)[0].id
    await owner`insert into public.group_students (group_id, student_id) values (${ids.gA}, ${ids.sA})`
    ids.lesson = (await owner`insert into public.lessons (tenant_id, teacher_id, group_id, title) values (${ids.A}, ${ids.tA}, ${ids.gA}, 'Lesson One') returning id`)[0].id
    // a proctored exam the student sat, with one recorded violation
    ids.exam = (await owner`insert into public.exams (tenant_id, teacher_id, group_id, title, questions, duration_minutes, is_published, proctoring_enabled)
      values (${ids.A}, ${ids.tA}, ${ids.gA}, 'Final', ${owner.json(QUESTIONS)}, 60, true, true) returning id`)[0].id
    ids.sub = (await owner`insert into public.exam_submissions (tenant_id, exam_id, student_id, status, answers, score, max_score, submitted_at, proctoring_events)
      values (${ids.A}, ${ids.exam}, ${ids.sA}, 'submitted', ${owner.json({ q1: 'because' })}, 0, 10, now(), ${owner.json([{ type: 'tab_switch', timestamp: VIOLATION_AT }])}) returning id`)[0].id
  }, 90_000)
  afterAll(async () => {
    await owner`delete from public.exam_appeals where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.grades where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.exam_submissions where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.exams where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.lessons where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.groups where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from ba."user" where email like ${'%' + tag + '%'}`
    await owner`delete from public.tenants where id in (${ids.A}, ${ids.B})`
    await owner.end()
  }, 90_000)

  it('homework: created on the own lesson and group, titled with the lesson; refused elsewhere', async () => {
    const hw = { lesson_id: '', group_id: ids.gA, title: 'Read chapter', questions: QUESTIONS, due_date: null }
    as(ids.tA2, 'teacher', ids.A)
    expect((await send(await homework(), 'POST', 'http://x/api/homework', { ...hw, lesson_id: ids.lesson })).status).toBe(403)
    as(ids.tB, 'teacher', ids.B)
    expect((await send(await homework(), 'POST', 'http://x/api/homework', { ...hw, lesson_id: ids.lesson })).status).toBe(403)
    as(ids.tA, 'teacher', ids.A)
    expect((await send(await homework(), 'POST', 'http://x/api/homework', { ...hw, lesson_id: ids.lesson, group_id: ids.gA2 })).status).toBe(403)
    expect((await send(await homework(), 'POST', 'http://x/api/homework', { ...hw, lesson_id: ids.lesson, group_id: ids.gB })).status).toBe(404)
    const ok = await send(await homework(), 'POST', 'http://x/api/homework', { ...hw, lesson_id: ids.lesson })
    expect(ok.status).toBe(201)
    expect(ok.body).toMatchObject({ title: 'Read chapter — Lesson One', type: 'homework', is_published: true, auto_publish: true })
    ids.hw = ok.body.id
    const list = await send(await homework(), 'GET', `http://x/api/homework?lesson_id=${ids.lesson}`)
    expect(list.body).toHaveLength(1)
    expect(list.body[0].exam_submissions).toEqual([{ count: 0 }])
    const [n] = await owner`select count(*)::int n from public.exams where type = 'homework' and tenant_id in (${ids.A}, ${ids.B})`
    expect(n.n).toBe(1)
  }, 90_000)

  it('homework edit and delete: only the owner', async () => {
    as(ids.tB, 'teacher', ids.B)
    expect((await send(await homework(), 'PATCH', 'http://x/api/homework', { id: ids.hw, title: 'Hacked' })).status).toBe(403)
    as(ids.tA2, 'teacher', ids.A)
    expect((await send(await homework(), 'DELETE', 'http://x/api/homework', { id: ids.hw })).status).toBe(403)
    as(ids.tA, 'teacher', ids.A)
    expect((await send(await homework(), 'PATCH', 'http://x/api/homework', { id: ids.hw, is_published: false })).body).toMatchObject({ is_published: false, title: 'Read chapter — Lesson One' })
    expect((await send(await homework(), 'DELETE', 'http://x/api/homework', { id: ids.hw })).body).toMatchObject({ ok: true, mode: 'archive' })
  }, 90_000)

  it('grading: the owner grades within the maximum; a colleague and another institution cannot', async () => {
    // the grading view lists the lesson's homework; the exam sat here is graded the same way
    as(ids.tA, 'teacher', ids.A)
    expect((await send(await grading(), 'GET', `http://x/api/homework/submissions?lesson_id=${ids.lesson}`)).body).toEqual({ homework: [] })
    as(ids.tA2, 'teacher', ids.A)
    expect((await send(await grading(), 'PATCH', 'http://x/api/homework/submissions', { id: ids.sub, score: 10 })).status).toBe(403)
    as(ids.tB, 'teacher', ids.B)
    expect((await send(await grading(), 'PATCH', 'http://x/api/homework/submissions', { id: ids.sub, score: 10 })).status).toBe(403)
    as(ids.tA, 'teacher', ids.A)
    expect((await send(await grading(), 'PATCH', 'http://x/api/homework/submissions', { id: ids.sub, score: 11 })).status).toBe(400)
    const ok = await send(await grading(), 'PATCH', 'http://x/api/homework/submissions', { id: ids.sub, score: 8, grading_status: 'published', teacher_comment: ' Good ' })
    expect(ok.status).toBe(200)
    const [s] = await owner`select score::float8 score, is_graded, grading_status, teacher_comment from public.exam_submissions where id = ${ids.sub}`
    expect(s).toEqual({ score: 8, is_graded: true, grading_status: 'published', teacher_comment: 'Good' })
  }, 90_000)

  it('grade export: the owner gets the grade; a colleague and another institution do not', async () => {
    as(ids.tA, 'teacher', ids.A)
    const ok = await send(await exportRoute(), 'GET', `http://x/api/grades/export?group_id=${ids.gA}&format=json`)
    expect(ok.status).toBe(200)
    expect(ok.body.rows).toHaveLength(1)
    expect(Object.values(ok.body.rows[0])).toContain('8/10')
    as(ids.tA2, 'teacher', ids.A)
    expect((await send(await exportRoute(), 'GET', `http://x/api/grades/export?group_id=${ids.gA}&format=json`)).status).toBe(403)
    as(ids.tB, 'teacher', ids.B)
    expect((await send(await exportRoute(), 'GET', `http://x/api/grades/export?group_id=${ids.gA}&format=json`)).status).toBe(403)
  }, 90_000)

  it('appeals: only on a recorded violation, once; snapshots taken', async () => {
    as(ids.sA, 'student', ids.A)
    const body = { submissionId: ids.sub, violationType: 'tab_switch', violationAt: '2026-10-23T11:00:00.000Z', message: 'I did not switch tabs' }
    expect((await send(await appeals(), 'POST', 'http://x/api/appeals', body)).status).toBe(400)
    const ok = await send(await appeals(), 'POST', 'http://x/api/appeals', { ...body, violationAt: VIOLATION_AT })
    expect(ok.status).toBe(201)
    ids.appeal = ok.body.id
    expect((await send(await appeals(), 'POST', 'http://x/api/appeals', { ...body, violationAt: VIOLATION_AT })).status).toBe(409)
    const [a] = await owner`select teacher_id, group_name, exam_title, status from public.exam_appeals where id = ${ids.appeal}`
    expect(a).toEqual({ teacher_id: ids.tA, group_name: 'GA', exam_title: 'Final', status: 'pending' })
  }, 90_000)

  it('appeals resolve: not by a colleague or another institution\'s admin; the teacher once', async () => {
    const resolve = async () => send(await appeal(), 'PATCH', `http://x/api/appeals/${ids.appeal}`, { status: 'upheld', response: 'Agreed' }, { params: Promise.resolve({ id: ids.appeal }) })
    as(ids.tA2, 'teacher', ids.A)
    expect((await resolve()).status).toBe(403)
    as(ids.aB, 'university_admin', ids.B)
    expect((await resolve()).status).toBe(404)
    as(ids.tA, 'teacher', ids.A)
    expect((await resolve()).body).toEqual({ ok: true, status: 'upheld' })
    expect((await resolve()).status).toBe(409)
  }, 90_000)

  it('appeals report: each sees only their own scope', async () => {
    as(ids.tA, 'teacher', ids.A)
    expect((await send(await report(), 'GET', 'http://x/api/appeals/report')).body.count).toBe(1)
    as(ids.sA, 'student', ids.A)
    expect((await send(await report(), 'GET', 'http://x/api/appeals/report')).body.count).toBe(1)
    as(ids.tA2, 'teacher', ids.A)
    expect((await send(await report(), 'GET', 'http://x/api/appeals/report')).body.count).toBe(0)
    as(ids.aB, 'university_admin', ids.B)
    expect((await send(await report(), 'GET', 'http://x/api/appeals/report')).body.count).toBe(0)
  }, 90_000)
})
