// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'

// Live-channel join tickets on the Neon trial (step 13): the ticket route asks
// exam_topic_role() as the caller, exactly the old Realtime rule — the exam's
// own teacher, or a student with an attempt IN PROGRESS. A student who has not
// started (or another institution's teacher) gets no ticket. Runs with
// `npm run test:neon`.

type Who = { id: string } | null
const who = vi.hoisted(() => ({ user: null as Who }))
vi.mock('@/lib/auth/current', async () => ({
  ...(await vi.importActual<object>('@/lib/auth/current')),
  currentUser: async () => (who.user ? { ...who.user, role: null, tenant_id: null } : null),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))

const READY = !!(process.env.NEON_GATEWAY_DATABASE_URL && process.env.NEON_DATABASE_URL)
vi.setConfig({ testTimeout: 120_000 })

describe.skipIf(!READY)('live tickets on the trial', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const tag = `lt${Date.now()}`
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const ids = { A: '', B: '', tA: '', tB: '', sIn: '', sOut: '', gA: '', exam: '' }

  async function person(role: string, tenant: string) {
    const [u] = await owner`insert into ba."user" (name, email, "emailVerified") values (${role}, ${role + Math.random().toString(36).slice(2, 7) + tag + '@lt-test.test'}, true) returning id`
    await owner`update public.users set role = ${role}, tenant_id = ${tenant} where id = ${u.id}`
    return u.id as string
  }

  beforeAll(async () => {
    process.env.LIVE_SIGNING_SECRET = 'trial-live-signing-secret-at-least-32-chars'
    ids.A = (await owner`insert into public.tenants (name, slug, code) values ('LTA', ${tag + 'a'}, ${code()}) returning id`)[0].id
    ids.B = (await owner`insert into public.tenants (name, slug, code) values ('LTB', ${tag + 'b'}, ${code()}) returning id`)[0].id
    ids.tA = await person('teacher', ids.A)
    ids.tB = await person('teacher', ids.B)
    ids.sIn = await person('student', ids.A)
    ids.sOut = await person('student', ids.A)
    ids.gA = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.A}, ${ids.tA}, 'G') returning id`)[0].id
    await owner`insert into public.group_students (group_id, student_id) values (${ids.gA}, ${ids.sIn}), (${ids.gA}, ${ids.sOut})`
    ids.exam = (await owner`insert into public.exams (tenant_id, teacher_id, group_id, title, questions, duration_minutes, is_published, proctoring_enabled)
      values (${ids.A}, ${ids.tA}, ${ids.gA}, 'Live', '[]', 30, true, true) returning id`)[0].id
    await owner`insert into public.exam_submissions (tenant_id, exam_id, student_id, status, answers) values (${ids.A}, ${ids.exam}, ${ids.sIn}, 'in_progress', '{}')`
  }, 120_000)
  afterAll(async () => {
    await owner`delete from public.exam_submissions where tenant_id = ${ids.A}`
    await owner`delete from public.exams where tenant_id = ${ids.A}`
    await owner`delete from public.groups where tenant_id = ${ids.A}`
    await owner`delete from ba."user" where email like ${'%' + tag + '%'}`
    await owner`delete from public.tenants where id in (${ids.A}, ${ids.B})`
    await owner.end()
  }, 120_000)

  const ask = async (userId: string, topic: string) => {
    who.user = { id: userId }
    const { GET } = await import('@/app/api/live/ticket/route')
    const res = await GET(new Request(`http://x/api/live/ticket?topic=${encodeURIComponent(topic)}`))
    return { status: res.status, body: res.status === 200 ? await res.json() as { role: string } : null }
  }

  it('the exam\'s teacher gets a teacher ticket for both topics', async () => {
    expect((await ask(ids.tA, `exam-live:${ids.exam}`)).body?.role).toBe('teacher')
    expect((await ask(ids.tA, `exam-thumbs:${ids.exam}`)).body?.role).toBe('teacher')
  })

  it('a student with an attempt in progress gets a student ticket', async () => {
    expect((await ask(ids.sIn, `exam-live:${ids.exam}`)).body?.role).toBe('student')
  })

  it('a student who has not started, and another institution\'s teacher, get none', async () => {
    expect((await ask(ids.sOut, `exam-live:${ids.exam}`)).status).toBe(403)
    expect((await ask(ids.tB, `exam-live:${ids.exam}`)).status).toBe(403)
  })
})
