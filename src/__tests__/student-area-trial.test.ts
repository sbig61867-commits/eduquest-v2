// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'

// The student area on the Neon trial, with two institutions: the exam list,
// the lesson pages, the course list with progress, the timetable, the
// assistant briefing, the quick-access panel and a lesson's body — all read
// as the student (RLS). A student sees their own groups' published content
// only, never another institution's, and an archived group disappears.
// Runs with `npm run test:neon`.

type Who = { sub: string; role: string; tenant_id: string | null }
const who = vi.hoisted(() => ({ ctx: null as null | Who }))
vi.mock('@/lib/auth/current', async () => ({
  ...(await vi.importActual<object>('@/lib/auth/current')),
  currentCtx: async () => (who.ctx ? { ...who.ctx, email: null, is_active: true, must_change_password: false } : null),
  currentUser: async () => (who.ctx ? { id: who.ctx.sub, role: who.ctx.role, tenant_id: who.ctx.tenant_id } : null),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))

const READY = !!(process.env.NEON_GATEWAY_DATABASE_URL && process.env.NEON_DATABASE_URL)
// Each statement crosses the link from this PC to Frankfurt.
vi.setConfig({ testTimeout: 120_000 })

describe.skipIf(!READY)('the student area on the trial', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const tag = `sa${Date.now()}`
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const ids = { A: '', B: '', tA: '', tB: '', sA: '', sB: '', gA: '', gOld: '', gB: '', lA: '', lDraft: '', lOld: '', lB: '', course: '', exam: '', examB: '' }

  async function person(role: string, tenant: string) {
    const [u] = await owner`insert into ba."user" (name, email, "emailVerified") values (${role}, ${role + Math.random().toString(36).slice(2, 7) + tag + '@sa-test.test'}, true) returning id`
    await owner`update public.users set role = ${role}, tenant_id = ${tenant} where id = ${u.id}`
    return u.id as string
  }
  const as = (sub: string, tenant: string) => { who.ctx = { sub, role: 'student', tenant_id: tenant } }

  beforeAll(async () => {
    ids.A = (await owner`insert into public.tenants (name, slug, code) values ('SA', ${tag + 'a'}, ${code()}) returning id`)[0].id
    ids.B = (await owner`insert into public.tenants (name, slug, code) values ('SB', ${tag + 'b'}, ${code()}) returning id`)[0].id
    ids.tA = await person('teacher', ids.A)
    ids.tB = await person('teacher', ids.B)
    ids.sA = await person('student', ids.A)
    ids.sB = await person('student', ids.B)
    ids.gA = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.A}, ${ids.tA}, 'GA') returning id`)[0].id
    ids.gOld = (await owner`insert into public.groups (tenant_id, teacher_id, name, is_active) values (${ids.A}, ${ids.tA}, 'Archived', false) returning id`)[0].id
    ids.gB = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.B}, ${ids.tB}, 'GB') returning id`)[0].id
    await owner`insert into public.group_students (group_id, student_id) values (${ids.gA}, ${ids.sA}), (${ids.gOld}, ${ids.sA}), (${ids.gB}, ${ids.sB})`
    ids.lA = (await owner`insert into public.lessons (tenant_id, teacher_id, group_id, title, content, is_published) values (${ids.A}, ${ids.tA}, ${ids.gA}, 'Cells', 'About cells', true) returning id`)[0].id
    ids.lDraft = (await owner`insert into public.lessons (tenant_id, teacher_id, group_id, title, is_published) values (${ids.A}, ${ids.tA}, ${ids.gA}, 'Draft', false) returning id`)[0].id
    ids.lOld = (await owner`insert into public.lessons (tenant_id, teacher_id, group_id, title, is_published) values (${ids.A}, ${ids.tA}, ${ids.gOld}, 'Old group', true) returning id`)[0].id
    ids.lB = (await owner`insert into public.lessons (tenant_id, teacher_id, group_id, title, content, is_published) values (${ids.B}, ${ids.tB}, ${ids.gB}, 'Other institution', 'Secret', true) returning id`)[0].id
    ids.exam = (await owner`insert into public.exams (tenant_id, teacher_id, group_id, title, questions, duration_minutes, is_published)
      values (${ids.A}, ${ids.tA}, ${ids.gA}, 'Quiz A', ${owner.json([{ id: 'q1', type: 'mcq', text: 'x', options: ['a'], correct_answer: 'a', points: 3 }])}, 30, true) returning id`)[0].id
    ids.examB = (await owner`insert into public.exams (tenant_id, teacher_id, group_id, title, questions, duration_minutes, is_published)
      values (${ids.B}, ${ids.tB}, ${ids.gB}, 'Quiz B', '[]', 30, true) returning id`)[0].id
    ids.course = (await owner`insert into public.courses (tenant_id, teacher_id, title, is_published, has_levels) values (${ids.A}, ${ids.tA}, 'Course A', true, false) returning id`)[0].id
    await owner`insert into public.course_enrollments (course_id, student_id, tenant_id) values (${ids.course}, ${ids.sA}, ${ids.A})`
  }, 120_000)
  afterAll(async () => {
    await owner`delete from public.exams where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.lessons where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.courses where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.groups where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from ba."user" where email like ${'%' + tag + '%'}`
    await owner`delete from public.tenants where id in (${ids.A}, ${ids.B})`
    await owner.end()
  }, 90_000)

  it('the exam list: the student\'s own published exams, metadata only — never another institution\'s', async () => {
    const { loadStudentExamList } = await import('@/lib/data/student-exams')
    const { data, error } = await loadStudentExamList(ids.sA)
    expect(error).toBeNull()
    expect(data.map(e => e.id)).toEqual([ids.exam])
    expect(data[0]).toMatchObject({ title: 'Quiz A', question_count: 1, total_points: 3 })
    expect(JSON.stringify(data)).not.toContain('correct_answer')
  })

  it('lessons: published, in active groups only — the archived group and the draft disappear', async () => {
    const { loadStudentLessons } = await import('@/lib/data/student-lessons')
    const { data } = await loadStudentLessons(ids.sA, [ids.gA, ids.gOld, ids.gB], '1')
    expect(data.rows.map(r => r.id)).toEqual([ids.lA])
    expect(data.rows[0].groups).toEqual({ name: 'GA' })
    // another institution's group in the list adds nothing (RLS)
    expect(data.total).toBe(1)
  })

  it('a lesson body: own lesson yes; archived group, another institution\'s lesson and a draft no', async () => {
    const { GET } = await import('@/app/api/student/lesson-body/route')
    const body = async (id: string) => { const r = await GET(new Request(`http://x/api/student/lesson-body?id=${id}`)); return { status: r.status, body: await r.json() } }
    as(ids.sA, ids.A)
    expect((await body(ids.lA)).body).toEqual({ content: 'About cells' })
    expect((await body(ids.lOld)).status).toBe(404)
    expect((await body(ids.lB)).status).toBe(404)
    expect((await body(ids.lDraft)).status).toBe(404)
  })

  it('courses with progress; the quick-access panel; the briefing — each the student\'s own', async () => {
    const { loadStudentCourseList } = await import('@/lib/data/student-courses')
    const list = await loadStudentCourseList(ids.sA)
    expect(list.courses.map(c => c.id)).toEqual([ids.course])
    expect(list.progressMap[ids.course]).toMatchObject({ total: 0, completed: 0 })
    as(ids.sA, ids.A)
    const { GET } = await import('@/app/api/student/quick-access/route')
    const panel = await (await GET()).json()
    expect(panel.courses.map((c: { id: string }) => c.id)).toEqual([ids.course])
    expect(panel.lessons.map((l: { id: string }) => l.id)).toEqual([ids.lA])
    expect(panel.exams.map((e: { id: string }) => e.id)).toEqual([ids.exam])
    const { loadAssistantBriefing } = await import('@/lib/data/assistant-nudges')
    const { data, error } = await loadAssistantBriefing(ids.sA)
    expect(error).toBeNull()
    expect(data.lessons.map(l => l.id)).toEqual([ids.lA])
  })

  it('the other institution\'s student sees only their own', async () => {
    const { loadStudentExamList } = await import('@/lib/data/student-exams')
    expect((await loadStudentExamList(ids.sB)).data.map(e => e.id)).toEqual([ids.examB])
    const { loadStudentCourseList } = await import('@/lib/data/student-courses')
    expect((await loadStudentCourseList(ids.sB)).courses).toEqual([])
    as(ids.sB, ids.B)
    const { GET } = await import('@/app/api/student/quick-access/route')
    const panel = await (await GET()).json()
    expect(panel.lessons.map((l: { id: string }) => l.id)).toEqual([ids.lB])
  })
})
