// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'

// The teacher, centre and admin page loaders on the Neon trial (step 9), with
// two institutions and a second teacher in the first: each loader reads as the
// caller (RLS) and sees only what the old pages showed — a teacher their own
// groups, lessons and proctored submissions (never a colleague's or another
// institution's), an admin their own institution's people and groups. A guessed
// id of another institution returns nothing. The routes that replaced the
// browser's direct reads and writes (exam questions, course builder, student
// progress, live-wall names) are called as their users too. Runs with
// `npm run test:neon`.

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

describe.skipIf(!READY)('staff page loaders on the trial', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const tag = `sp${Date.now()}`
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const ids = { A: '', B: '', aA: '', tA: '', tA2: '', tB: '', sA: '', sB: '', gA: '', gA2: '', gB: '', lA: '', lA2: '', lB: '', exam: '', examB: '', session: '', course: '' }

  async function person(role: string, tenant: string, name = role) {
    const [u] = await owner`insert into ba."user" (name, email, "emailVerified") values (${name}, ${role + Math.random().toString(36).slice(2, 7) + tag + '@sp-test.test'}, true) returning id`
    await owner`update public.users set role = ${role}, tenant_id = ${tenant}, full_name = ${name} where id = ${u.id}`
    return u.id as string
  }

  beforeAll(async () => {
    ids.A = (await owner`insert into public.tenants (name, slug, code) values ('SPA', ${tag + 'a'}, ${code()}) returning id`)[0].id
    ids.B = (await owner`insert into public.tenants (name, slug, code) values ('SPB', ${tag + 'b'}, ${code()}) returning id`)[0].id
    ids.aA = await person('university_admin', ids.A, 'Admin A')
    ids.tA = await person('teacher', ids.A, 'Teacher A')
    ids.tA2 = await person('teacher', ids.A, 'Teacher A2')
    ids.tB = await person('teacher', ids.B, 'Teacher B')
    ids.sA = await person('student', ids.A, 'Student A')
    ids.sB = await person('student', ids.B, 'Student B')
    ids.gA = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.A}, ${ids.tA}, 'GA') returning id`)[0].id
    ids.gA2 = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.A}, ${ids.tA2}, 'GA2') returning id`)[0].id
    ids.gB = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.B}, ${ids.tB}, 'GB') returning id`)[0].id
    await owner`insert into public.group_students (group_id, student_id) values (${ids.gA}, ${ids.sA}), (${ids.gB}, ${ids.sB})`
    ids.lA = (await owner`insert into public.lessons (tenant_id, teacher_id, group_id, title, content, is_published) values (${ids.A}, ${ids.tA}, ${ids.gA}, 'Own lesson', 'Body A', true) returning id`)[0].id
    ids.lA2 = (await owner`insert into public.lessons (tenant_id, teacher_id, group_id, title, is_published) values (${ids.A}, ${ids.tA2}, ${ids.gA2}, 'Colleague lesson', true) returning id`)[0].id
    ids.lB = (await owner`insert into public.lessons (tenant_id, teacher_id, group_id, title, is_published) values (${ids.B}, ${ids.tB}, ${ids.gB}, 'Other institution', true) returning id`)[0].id
    const Q = [{ id: 'q1', type: 'mcq', text: 'x', options: ['a', 'b'], correct_answer: 'a', points: 20 }]
    ids.exam = (await owner`insert into public.exams (tenant_id, teacher_id, group_id, title, questions, duration_minutes, is_published, proctoring_enabled)
      values (${ids.A}, ${ids.tA}, ${ids.gA}, 'Final A', ${owner.json(Q)}, 60, true, true) returning id`)[0].id
    ids.examB = (await owner`insert into public.exams (tenant_id, teacher_id, group_id, title, questions, duration_minutes, is_published, proctoring_enabled)
      values (${ids.B}, ${ids.tB}, ${ids.gB}, 'Final B', ${owner.json(Q)}, 60, true, true) returning id`)[0].id
    await owner`insert into public.exam_submissions (tenant_id, exam_id, student_id, status, answers, score, max_score, submitted_at, proctoring_events)
      values (${ids.A}, ${ids.exam}, ${ids.sA}, 'submitted', ${owner.json({ q1: 'a' })}, 15, 20, now(), ${owner.json([{ type: 'tab_switch', timestamp: 1 }])})`
    await owner`insert into public.exam_submissions (tenant_id, exam_id, student_id, status, answers, score, max_score, submitted_at, proctoring_events)
      values (${ids.B}, ${ids.examB}, ${ids.sB}, 'submitted', ${owner.json({ q1: 'a' })}, 20, 20, now(), ${owner.json([])})`
    ids.session = (await owner`insert into public.attendance_sessions (tenant_id, group_id, session_date) values (${ids.A}, ${ids.gA}, current_date) returning id`)[0].id
    await owner`insert into public.attendance_records (session_id, student_id, tenant_id, status) values (${ids.session}, ${ids.sA}, ${ids.A}, 'present')`
    ids.course = (await owner`insert into public.courses (tenant_id, teacher_id, title, is_published, has_levels) values (${ids.A}, ${ids.tA}, 'Course A', true, true) returning id`)[0].id
    await owner`insert into public.course_enrollments (course_id, student_id, tenant_id) values (${ids.course}, ${ids.sA}, ${ids.A})`
  }, 180_000)
  afterAll(async () => {
    await owner`delete from public.attendance_sessions where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.exam_submissions where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.exams where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.lessons where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.courses where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from public.groups where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from ba."user" where email like ${'%' + tag + '%'}`
    await owner`delete from public.tenants where id in (${ids.A}, ${ids.B})`
    await owner.end()
  }, 120_000)

  it('teacher lessons: own lessons only — never a colleague\'s or another institution\'s', async () => {
    const { loadTeacherLessons } = await import('@/lib/data/teacher-lessons-load')
    const { data, error } = await loadTeacherLessons(ids.tA, '1')
    expect(error).toBeNull()
    expect(data.rows.map(r => r.id)).toEqual([ids.lA])
    expect(data.rows[0].groups).toEqual({ name: 'GA' })
    expect(Object.keys(data.rows[0])).not.toContain('content')
  })

  it('teacher records: the own group with roster, marks, the exam and its graded submission; a colleague\'s or another institution\'s group is null', async () => {
    const { loadGroupData, loadGroupCards } = await import('@/lib/data/teacher-records')
    const g = await loadGroupData(ids.tA, ids.gA)
    expect(g!.members.map(m => m.studentId)).toEqual([ids.sA])
    expect(g!.assessments.map(a => a.id)).toEqual([ids.exam])
    expect(g!.submissions).toMatchObject([{ studentId: ids.sA, score: 15, maxScore: 20 }])
    expect(g!.marks).toMatchObject([{ studentId: ids.sA, status: 'present' }])
    expect(JSON.stringify(g)).not.toContain('correct_answer')
    expect(await loadGroupData(ids.tA, ids.gA2)).toBeNull()
    expect(await loadGroupData(ids.tA, ids.gB)).toBeNull()
    const cards = await loadGroupCards(ids.tA, Date.now())
    expect(cards.map(c => c.group.id)).toEqual([ids.gA])
    expect(cards[0]).toMatchObject({ students: 1, exams: 1, avg: 75, attendanceRate: 100 })
  })

  it('teacher proctoring: own proctored submissions with the flagged count; the other institution\'s teacher sees only theirs', async () => {
    const { loadProctoringPage } = await import('@/lib/data/proctoring')
    const a = await loadProctoringPage(ids.tA, '1')
    expect(a.error).toBeNull()
    expect(a.data).toMatchObject({ total: 1, flagged: 1, page: 1 })
    expect(a.data.rows[0]).toMatchObject({ exams: { title: 'Final A' }, users: { full_name: 'Student A' } })
    expect(JSON.stringify(a.data)).not.toContain('correct_answer')
    const b = await loadProctoringPage(ids.tB, '1')
    expect(b.data).toMatchObject({ total: 1, flagged: 0 })
    expect(b.data.rows[0].exams).toEqual({ title: 'Final B' })
    expect((await loadProctoringPage(ids.tA2, '1')).data.total).toBe(0)
  })

  it('people lists (admin): the own institution\'s students / teachers; another institution\'s id returns nothing', async () => {
    const { listStudents, listTeachers, listCenterTeachers } = await import('@/lib/data/people')
    const s = await listStudents(ids.aA, ids.A)
    expect(s.error).toBeNull()
    expect(s.data.rows.map(r => r.id)).toEqual([ids.sA])
    const t = await listTeachers(ids.aA, ids.A, { search: 'Teacher' })
    expect(t.data.rows.map(r => r.id).sort()).toEqual([ids.tA, ids.tA2].sort())
    expect((await listStudents(ids.aA, ids.B)).data.rows).toEqual([])
    const ct = await listCenterTeachers(ids.aA, ids.A)
    // GA is a university group; Course A (created for the builder tests) is a centre item.
    expect(ct.data.rows.find(r => r.id === ids.tA)!.footprint).toEqual({ universityGroups: 1, centreItems: 1 })
  })

  it('centre groups page (as the admin): the institution\'s groups and picker; another institution\'s id returns nothing', async () => {
    const { loadCenterGroupsPage } = await import('@/lib/data/center-groups')
    const a = await loadCenterGroupsPage(ids.aA, ids.A, '1')
    expect(a.rows.map(r => r.id).sort()).toEqual([ids.gA, ids.gA2].sort())
    expect(a).toMatchObject({ active: 2, archived: 0, total: 2 })
    expect(a.transferOptions.map(o => o.id).sort()).toEqual([ids.gA, ids.gA2].sort())
    const b = await loadCenterGroupsPage(ids.aA, ids.B, '1')
    expect(b.rows).toEqual([])
    expect(b.transferOptions).toEqual([])
  })

  it('admin settings, announcements and the metadata-only content feeds read as the admin', async () => {
    const { getTenantSettings } = await import('@/lib/data/tenant-settings')
    expect(await getTenantSettings(ids.aA, ids.A)).toMatchObject({ structure_mode: 'flat' })
    const { loadAnnouncementsPage } = await import('@/lib/announcements-data')
    const ann = await loadAnnouncementsPage(ids.aA, ids.A)
    expect(ann.allowed).toBe(true)
    expect(ann.groups.map(g => g.id).sort()).toEqual([ids.gA, ids.gA2].sort())
    const { loadAdminContentCounts, loadAdminLessonsPage } = await import('@/lib/data/admin-content')
    const { counts, error } = await loadAdminContentCounts(ids.aA)
    expect(error).toBeNull()
    expect(counts).toMatchObject({ lessons: 2, exams: 1 })
    const lessons = await loadAdminLessonsPage(ids.aA, 1, counts.lessons)
    expect(lessons.data.rows.map(r => r.id).sort()).toEqual([ids.lA, ids.lA2].sort())
    expect(JSON.stringify(lessons.data)).not.toContain('Body A')
  })

  it('a teacher reading the admin feeds gets nothing (the feeds are admin-only)', async () => {
    const { loadAdminContentCounts } = await import('@/lib/data/admin-content')
    const { counts } = await loadAdminContentCounts(ids.tA)
    expect(counts).toEqual({ lessons: 0, publishedLessons: 0, exams: 0, homework: 0, submissions: 0 })
  })

  const as = (sub: string, role: string, tenant: string) => { who.ctx = { sub, role, tenant_id: tenant } }
  const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  it('GET /api/exams?id=: the questions to the exam\'s own teacher only — a colleague or another institution gets 404', async () => {
    const { GET } = await import('@/app/api/exams/route')
    const get = async () => GET(new Request(`http://x/api/exams?id=${ids.exam}`))
    as(ids.tA, 'teacher', ids.A)
    const own = await get()
    expect(own.status).toBe(200)
    expect((await own.json()).questions).toHaveLength(1)
    as(ids.tA2, 'teacher', ids.A)
    expect((await get()).status).toBe(404)
    as(ids.tB, 'teacher', ids.B)
    expect((await get()).status).toBe(404)
    as(ids.sA, 'student', ids.A)
    expect((await get()).status).toBe(404)
  })

  it('POST /api/proctoring/live-names: only the exam\'s own teacher, only students taking that exam', async () => {
    const { POST } = await import('@/app/api/proctoring/live-names/route')
    const ask = async () => (await POST(new Request('http://x', json({ exam_id: ids.exam, ids: [ids.sA, ids.sB, ids.tA2] })))).json()
    as(ids.tA, 'teacher', ids.A)
    expect((await ask()).names).toEqual([{ id: ids.sA, full_name: 'Student A' }])
    as(ids.tA2, 'teacher', ids.A)
    expect((await ask()).names).toEqual([])
    as(ids.tB, 'teacher', ids.B)
    expect((await ask()).names).toEqual([])
  })

  it('course builder: the owner adds a level, unit and item and edits / deletes them; a colleague or another institution cannot', async () => {
    const { POST, PATCH, DELETE } = await import('@/app/api/courses/structure/route')
    as(ids.tA, 'teacher', ids.A)
    const level = await (await POST(new Request('http://x', json({ kind: 'level', course_id: ids.course, title: 'Level 1', order_index: 0 })))).json()
    expect(level).toMatchObject({ title: 'Level 1', course_units: [] })
    const unit = await (await POST(new Request('http://x', json({ kind: 'unit', course_id: ids.course, level_id: level.id, title: 'Unit 1' })))).json()
    expect(unit).toMatchObject({ title: 'Unit 1', level_id: level.id, unit_items: [] })
    const item = await (await POST(new Request('http://x', json({ kind: 'item', course_id: ids.course, unit_id: unit.id, title: 'Item 1', type: 'text', content: { body: 'x' } })))).json()
    expect(item).toMatchObject({ title: 'Item 1', type: 'text' })
    const [{ tenant_id }] = await owner`select tenant_id from public.unit_items where id = ${item.id}`
    expect(tenant_id).toBe(ids.A)

    // A colleague in the same institution: refused on every write, nothing changes.
    as(ids.tA2, 'teacher', ids.A)
    expect((await POST(new Request('http://x', json({ kind: 'level', course_id: ids.course, title: 'Intruder' })))).status).toBe(403)
    expect((await PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ id: item.id, title: 'Hacked', type: 'text', content: { body: 'y' } }) }))).status).toBe(404)
    expect((await DELETE(new Request(`http://x?kind=level&id=${level.id}`, { method: 'DELETE' }))).status).toBe(404)
    // Another institution's teacher, sending A's ids: the same.
    as(ids.tB, 'teacher', ids.B)
    expect((await POST(new Request('http://x', json({ kind: 'item', course_id: ids.course, unit_id: unit.id, title: 'X', type: 'text', content: {} })))).status).toBe(403)
    expect((await DELETE(new Request(`http://x?kind=item&id=${item.id}`, { method: 'DELETE' }))).status).toBe(404)
    const [{ n }] = await owner`select count(*)::int n from public.course_levels where course_id = ${ids.course}`
    expect(n).toBe(1)
    const [still] = await owner`select title from public.unit_items where id = ${item.id}`
    expect(still.title).toBe('Item 1')

    // The owner edits, and the enrolled student marks the item done (next test).
    as(ids.tA, 'teacher', ids.A)
    const edited = await (await PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ id: item.id, title: 'Item 1b', type: 'text', content: { body: 'z' } }) }))).json()
    expect(edited.title).toBe('Item 1b')
    // Published all the way up, as the student player requires (unit_items_select).
    await owner`update public.unit_items set is_published = true where id = ${item.id}`
    await owner`update public.course_units set is_published = true where id = ${unit.id}`
    await owner`update public.course_levels set is_published = true where id = ${level.id}`
  })

  it('POST /api/student/progress: the enrolled student marks an item (twice is a no-op); a student of another institution cannot', async () => {
    const [{ id: itemId }] = await owner`select id from public.unit_items where course_id = ${ids.course} limit 1`
    const { POST } = await import('@/app/api/student/progress/route')
    as(ids.sA, 'student', ids.A)
    expect((await POST(new Request('http://x', json({ item_ids: [itemId] })))).status).toBe(200)
    expect((await POST(new Request('http://x', json({ item_ids: [itemId] })))).status).toBe(200)
    const rows = await owner`select student_id, tenant_id from public.student_progress where unit_item_id = ${itemId}`
    expect(rows).toEqual([{ student_id: ids.sA, tenant_id: ids.A }])
    as(ids.sB, 'student', ids.B)
    expect((await POST(new Request('http://x', json({ item_ids: [itemId] })))).status).toBe(403)
    const [{ n }] = await owner`select count(*)::int n from public.student_progress where unit_item_id = ${itemId}`
    expect(n).toBe(1)

    const { DELETE } = await import('@/app/api/courses/structure/route')
    as(ids.tA, 'teacher', ids.A)
    const [{ id: levelId }] = await owner`select id from public.course_levels where course_id = ${ids.course}`
    expect((await DELETE(new Request(`http://x?kind=level&id=${levelId}`, { method: 'DELETE' }))).status).toBe(200)
    const [{ m }] = await owner`select count(*)::int m from public.course_levels where course_id = ${ids.course}`
    expect(m).toBe(0)
  })
})
