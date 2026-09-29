// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Direct account creation for a student (/api/admin/create-user): open to the
// institution's staff and, since 2026-09-29, to teachers — a teacher only ever
// creates students, only into one of their own groups. The four-part name goes
// through saveStudentName, the group through the shared enrolment rules, and
// any failure after the auth account exists removes it again.

const state = vi.hoisted(() => ({
  callerId: 'teacher-1',
  caller: { role: 'teacher', tenant_id: 't1', permissions: null } as Record<string, unknown>,
  group: null as Record<string, unknown> | null,
  room: true,
  enrolError: null as { message: string } | null,
  created: [] as Record<string, unknown>[],
  deleted: [] as string[],
  upserts: [] as Record<string, unknown>[],
  saved: [] as string[],
  enrolled: [] as [string, string][],
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: state.callerId } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: state.caller }),
          maybeSingle: async () => ({ data: state.group }),
        }),
      }),
    }),
  }),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => table === 'tenants'
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { is_active: true } }) }) }) }
      : {
          upsert: (row: Record<string, unknown>) => {
            state.upserts.push(row)
            return { select: () => ({ single: async () => ({ data: { ...row }, error: null }) }) }
          },
        },
    auth: {
      admin: {
        createUser: async (args: Record<string, unknown>) => { state.created.push(args); return { data: { user: { id: 'new-1' } }, error: null } },
        deleteUser: async (id: string) => { state.deleted.push(id); return {} },
      },
    },
  }),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ allowed: true, resetAt: 0 }) }))
vi.mock('@/lib/structure-mode', () => ({ getTenantSettings: async () => ({ has_center: true }) }))
vi.mock('@/lib/seat-limit', () => ({
  checkSeatLimit: async () => ({ allowed: true, limit: null }),
  isSeatRole: (r: string) => r === 'student' || r === 'teacher',
  seatRoleFromDbError: () => null,
  SEAT_LIMIT_CODE: { student: 'studentLimit', teacher: 'teacherLimit' },
}))
vi.mock('@/lib/student-names', () => ({
  saveStudentName: async (_admin: unknown, id: string, parts: { first: string; family: string }) => {
    state.saved.push(id)
    return `${parts.first} ${parts.family}`
  },
}))
vi.mock('@/lib/group-enrolment', () => ({
  groupHasRoom: async () => state.room,
  enrolStudentInGroup: async (_admin: unknown, group: { id: string }, id: string) => {
    state.enrolled.push([group.id, id])
    return { error: state.enrolError }
  },
}))

import { POST } from '@/app/api/admin/create-user/route'

const parts = { first: 'أحمد', father: 'محمود', grandfather: 'صالح', family: 'الخطيب' }
const OWN_GROUP = { id: 'g1', tenant_id: 't1', teacher_id: 'teacher-1', max_students: null, course_id: null }

async function call(body: Record<string, unknown>) {
  const res = await POST(new Request('http://x/api/admin/create-user', {
    method: 'POST',
    body: JSON.stringify({ email: 's@x.edu', password: 'secret-123', role: 'student', name_parts: parts, ...body }),
  }))
  return { status: res.status, data: await res.json() }
}

describe('direct student account', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.test'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
    state.callerId = 'teacher-1'
    state.caller = { role: 'teacher', tenant_id: 't1', permissions: null }
    state.group = OWN_GROUP
    state.room = true
    state.enrolError = null
    state.created = []
    state.deleted = []
    state.upserts = []
    state.saved = []
    state.enrolled = []
  })

  it('a teacher creates a student straight into their own group', async () => {
    const { status, data } = await call({ group_id: 'g1' })
    expect(status).toBe(200)
    expect(state.created).toHaveLength(1)
    // Everyone but the student sees first + family name only.
    expect(state.created[0].user_metadata).toEqual({ full_name: 'أحمد الخطيب' })
    expect(state.upserts[0]).toMatchObject({ role: 'student', tenant_id: 't1', full_name: 'أحمد الخطيب', is_university_student: true })
    expect(state.saved).toEqual(['new-1'])
    expect(state.enrolled).toEqual([['g1', 'new-1']])
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
    const { status, data } = await call({ group_id: 'g1' })
    expect(status).toBe(403)
    expect(data.code).toBe('addOwnGroupsOnly')
    expect(state.created).toHaveLength(0)
  })

  it('a group of another institution is refused', async () => {
    state.group = { ...OWN_GROUP, tenant_id: 't2' }
    const { status } = await call({ group_id: 'g1' })
    expect(status).toBe(400)
    expect(state.created).toHaveLength(0)
  })

  it('a teacher can only ever create students', async () => {
    const { status } = await call({ role: 'teacher', full_name: 'Someone', group_id: 'g1' })
    expect(status).toBe(403)
    expect(state.created).toHaveLength(0)
  })

  it('a full group is refused before any account exists', async () => {
    state.room = false
    const { status, data } = await call({ group_id: 'g1' })
    expect(status).toBe(409)
    expect(data.code).toBe('groupFull')
    expect(state.created).toHaveLength(0)
  })

  it('a failed group enrolment removes the new account again', async () => {
    state.enrolError = { message: 'boom' }
    const { status } = await call({ group_id: 'g1' })
    expect(status).toBe(500)
    expect(state.deleted).toEqual(['new-1'])
  })

  it('an invalid four-part name is refused before any account exists', async () => {
    const { status, data } = await call({ group_id: 'g1', name_parts: { ...parts, father: 'x' } })
    expect(status).toBe(400)
    expect(data.code).toBe('studentNameInvalid')
    expect(state.created).toHaveLength(0)
  })

  it('an institution admin may create a student without a group', async () => {
    state.callerId = 'admin-1'
    state.caller = { role: 'university_admin', tenant_id: 't1', permissions: {} }
    const { status } = await call({})
    expect(status).toBe(200)
    expect(state.enrolled).toHaveLength(0)
  })

  it('a centre manager still needs the manage_students capability', async () => {
    state.callerId = 'cm-1'
    state.caller = { role: 'center_manager', tenant_id: 't1', permissions: {} }
    const { status, data } = await call({})
    expect(status).toBe(403)
    expect(data.code).toBe('cannotCreateRole')
  })

  it('a student cannot create accounts', async () => {
    state.callerId = 'st-1'
    state.caller = { role: 'student', tenant_id: 't1', permissions: null }
    const { status } = await call({ group_id: 'g1' })
    expect(status).toBe(403)
    expect(state.created).toHaveLength(0)
  })
})
