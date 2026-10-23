// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Direct account creation for a student (/api/admin/create-user): open to the
// institution's staff and, since 2026-09-29, to teachers — a teacher only ever
// creates students, only into one of their own groups. The profile, four-part
// name and group are written in one SQL unit, and any failure after the
// sign-in account exists removes it again.

const T1 = '11111111-1111-1111-1111-111111111111'
const T2 = '22222222-2222-2222-2222-222222222222'
const G1 = '33333333-3333-3333-3333-333333333333'
const NEW = '44444444-4444-4444-4444-444444444444'

const state = vi.hoisted(() => ({
  callerId: 'teacher-1',
  caller: { role: 'teacher', tenant_id: '11111111-1111-1111-1111-111111111111', permissions: null } as Record<string, unknown>,
  group: null as Record<string, unknown> | null,
  room: true,
  enrolError: null as { message: string } | null,
  created: [] as Record<string, unknown>[],
  deleted: [] as string[],
  provisioned: [] as unknown[][],
  saved: [] as string[],
  enrolled: [] as [string, string][],
}))

vi.mock('@/lib/auth', () => ({ getSessionUser: async () => ({ id: state.callerId }) }))
vi.mock('@/lib/auth/better', () => ({
  authCreateUser: async (args: Record<string, unknown>) => { state.created.push(args); return { id: '44444444-4444-4444-4444-444444444444', error: null } },
  authRemoveUser: async (id: string) => { state.deleted.push(id); return { error: null } },
}))
// The SQL layer, answered from the state above, statement by statement.
vi.mock('@/lib/db/sql', () => ({
  maybeOne: (rows: unknown[]) => rows[0] ?? null,
  run: async (_ctx: unknown, build: (sql: unknown) => { text: string; values: unknown[] }[]) => {
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => ({ text: strings.join('$').replace(/\s+/g, ' ').trim(), values })
    const qs = build(tag)
    if (state.enrolError && qs.some(q => q.text.startsWith('insert into public.group_students'))) throw new Error(state.enrolError.message)
    return qs.map(({ text, values }) => {
      if (text.startsWith('select role, tenant_id, permissions')) return [state.caller]
      if (text.startsWith('select is_active, has_center')) return [{ is_active: true, has_center: true, student_limit: null, teacher_limit: null }]
      if (text.startsWith('select count(*)::int as n from public.users')) return [{ n: 0 }]
      if (text.startsWith('select count(*)::int as n from public.group_students')) return [{ n: state.room ? 0 : 99 }]
      if (text.startsWith('select id, tenant_id, teacher_id, max_students')) return state.group ? [state.group] : []
      if (text.startsWith('select public.provision_user_profile')) { state.provisioned.push([...values, text.endsWith(', true)')]); return [] }
      if (text.startsWith('insert into public.student_names')) { state.saved.push(values[0] as string); return [] }
      if (text.startsWith('update public.users set full_name')) return []
      if (text.startsWith('insert into public.group_students')) { state.enrolled.push([values[0] as string, values[1] as string]); return [] }
      if (text.startsWith('insert into public.course_enrollments')) return []
      if (text.startsWith('select id, email, full_name')) return [{ id: values[0], email: 's@x.edu', full_name: 'أحمد الخطيب', member_code: null }]
      throw new Error('unexpected statement: ' + text)
    })
  },
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ allowed: true, resetAt: 0 }) }))

import { POST } from '@/app/api/admin/create-user/route'

const parts = { first: 'أحمد', father: 'محمود', grandfather: 'صالح', family: 'الخطيب' }
const OWN_GROUP = { id: G1, tenant_id: T1, teacher_id: 'teacher-1', max_students: 30, course_id: null }

async function call(body: Record<string, unknown>) {
  const res = await POST(new Request('http://x/api/admin/create-user', {
    method: 'POST',
    body: JSON.stringify({ email: 's@x.edu', password: 'secret-123', role: 'student', name_parts: parts, ...body }),
  }))
  return { status: res.status, data: await res.json() }
}

describe('direct student account', () => {
  beforeEach(() => {
    state.callerId = 'teacher-1'
    state.caller = { role: 'teacher', tenant_id: T1, permissions: null }
    state.group = OWN_GROUP
    state.room = true
    state.enrolError = null
    state.created = []
    state.deleted = []
    state.provisioned = []
    state.saved = []
    state.enrolled = []
  })

  it('a teacher creates a student straight into their own group', async () => {
    const { status, data } = await call({ group_id: G1 })
    expect(status).toBe(200)
    expect(state.created).toHaveLength(1)
    // Everyone but the student sees first + family name only.
    expect(state.created[0].name).toBe('أحمد الخطيب')
    // provision_user_profile(id, tenant, role, email, full_name, is_university_student, must_change_password = true)
    expect(state.provisioned[0]).toEqual([NEW, T1, 'student', 's@x.edu', 'أحمد الخطيب', true, true])
    expect(state.saved).toEqual([NEW])
    expect(state.enrolled).toEqual([[G1, NEW]])
    expect(data.user.full_name).toBe('أحمد الخطيب')
  })

  it('a teacher must pick one of their groups', async () => {
    const { status, data } = await call({})
    expect(status).toBe(400)
    expect(data.code).toBe('teacherGroupRequired')
    expect(state.created).toHaveLength(0)
  })

  it("a teacher cannot add into another teacher's group", async () => {
    state.group = { ...OWN_GROUP, teacher_id: 'teacher-2' }
    const { status, data } = await call({ group_id: G1 })
    expect(status).toBe(403)
    expect(data.code).toBe('addOwnGroupsOnly')
    expect(state.created).toHaveLength(0)
  })

  it('a group of another institution is refused', async () => {
    state.group = { ...OWN_GROUP, tenant_id: T2 }
    const { status } = await call({ group_id: G1 })
    expect(status).toBe(400)
    expect(state.created).toHaveLength(0)
  })

  it('a teacher can only ever create students', async () => {
    const { status } = await call({ role: 'teacher', full_name: 'Someone', group_id: G1 })
    expect(status).toBe(403)
    expect(state.created).toHaveLength(0)
  })

  it('a full group is refused before any account exists', async () => {
    state.room = false
    const { status, data } = await call({ group_id: G1 })
    expect(status).toBe(409)
    expect(data.code).toBe('groupFull')
    expect(state.created).toHaveLength(0)
  })

  it('a failed group enrolment removes the new account again', async () => {
    state.enrolError = { message: 'boom' }
    const { status } = await call({ group_id: G1 })
    expect(status).toBe(500)
    expect(state.deleted).toEqual([NEW])
  })

  it('an invalid four-part name is refused before any account exists', async () => {
    const { status, data } = await call({ group_id: G1, name_parts: { ...parts, father: 'x' } })
    expect(status).toBe(400)
    expect(data.code).toBe('studentNameInvalid')
    expect(state.created).toHaveLength(0)
  })

  it('an institution admin may create a student without a group', async () => {
    state.callerId = 'admin-1'
    state.caller = { role: 'university_admin', tenant_id: T1, permissions: {} }
    const { status } = await call({})
    expect(status).toBe(200)
    expect(state.enrolled).toHaveLength(0)
  })

  it('a centre manager still needs the manage_students capability', async () => {
    state.callerId = 'cm-1'
    state.caller = { role: 'center_manager', tenant_id: T1, permissions: {} }
    const { status, data } = await call({})
    expect(status).toBe(403)
    expect(data.code).toBe('cannotCreateRole')
  })

  it('a student cannot create accounts', async () => {
    state.callerId = 'st-1'
    state.caller = { role: 'student', tenant_id: T1, permissions: null }
    const { status } = await call({ group_id: G1 })
    expect(status).toBe(403)
    expect(state.created).toHaveLength(0)
  })
})
