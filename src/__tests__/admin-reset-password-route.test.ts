import { beforeEach, describe, expect, it, vi } from 'vitest'

// /api/admin/reset-password — staff issue a temporary password to a member
// who forgot theirs. Authorization mirrors /api/admin/toggle-user.

type Row = { id: string; tenant_id: string | null; role: string; is_university_student?: boolean | null; permissions?: Record<string, boolean> }

const state = vi.hoisted(() => ({
  me: 'admin1' as string | null,
  rows: {} as Record<string, Row>,
  rateAllowed: true,
  footprint: { university: false },
  updates: [] as { id: string; attrs: { password: string; app_metadata: Record<string, unknown> } }[],
}))

vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ allowed: state.rateAllowed }) }))
vi.mock('@/lib/account-scope', () => ({
  loadTeacherFootprint: async () => state.footprint,
  studentBlock: (u: boolean | null | undefined) => (u === false ? null : 'universityStudentScope'),
  teacherBlock: (f: { university: boolean }) => (f.university ? 'universityTeacherScope' : null),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.me ? { id: state.me } : null } }) },
    from: () => {
      let id = ''
      const q = { select: () => q, eq: (_c: string, v: string) => { id = v; return q }, single: async () => ({ data: state.rows[id] ?? null }) }
      return q
    },
  }),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { admin: { updateUserById: async (id: string, attrs: never) => { state.updates.push({ id, attrs }); return { error: null } } } },
  }),
}))

const { POST } = await import('@/app/api/admin/reset-password/route')
const call = (userId: unknown) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ userId }) }))

const ALL = { manage_teachers: true, manage_students: true, manage_center_staff: true }
beforeEach(() => {
  state.me = 'admin1'
  state.rateAllowed = true
  state.footprint = { university: false }
  state.updates = []
  state.rows = {
    admin1: { id: 'admin1', tenant_id: 'T1', role: 'university_admin', permissions: ALL },
    cm1: { id: 'cm1', tenant_id: 'T1', role: 'center_manager', permissions: ALL },
    stu: { id: 'stu', tenant_id: 'T1', role: 'student', is_university_student: true },
    centreStu: { id: 'centreStu', tenant_id: 'T1', role: 'student', is_university_student: false },
    tea: { id: 'tea', tenant_id: 'T1', role: 'teacher' },
    otherStu: { id: 'otherStu', tenant_id: 'T2', role: 'student', is_university_student: true },
    owner: { id: 'owner', tenant_id: null, role: 'super_admin' },
  }
})

describe('POST /api/admin/reset-password', () => {
  it('issues a temporary password and forces a change at next sign-in', async () => {
    const res = await call('stu')
    expect(res.status).toBe(200)
    const { password } = await res.json()
    expect(password).toMatch(/^[A-Za-z2-9]{10}$/)
    expect(state.updates).toEqual([{ id: 'stu', attrs: { password, app_metadata: { must_change_password: true } } }])
  })

  it('a teacher of the same institution can be reset by its admin', async () => {
    expect((await call('tea')).status).toBe(200)
  })

  it('never across institutions', async () => {
    const res = await call('otherStu')
    expect(res.status).toBe(403)
    expect(state.updates).toEqual([])
  })

  it('never the platform owner', async () => {
    expect((await call('owner')).status).toBe(403)
    expect(state.updates).toEqual([])
  })

  it('not your own account (that is Settings, with the current password)', async () => {
    expect((await call('admin1')).status).toBe(403)
  })

  it('needs the matching capability', async () => {
    state.rows.admin1.permissions = { manage_students: false } // admins default ON; the owner switched it off
    expect((await call('stu')).status).toBe(403)
    expect(state.updates).toEqual([])
  })

  it('a centre manager only for centre-side people', async () => {
    state.me = 'cm1'
    expect((await call('stu')).status).toBe(403)
    expect((await call('centreStu')).status).toBe(200)
    state.footprint = { university: true }
    expect((await call('tea')).status).toBe(403)
  })

  it('teachers and students cannot reset anyone', async () => {
    state.me = 'tea'
    expect((await call('stu')).status).toBe(403)
  })

  it('requires a session and a target', async () => {
    expect((await call(undefined)).status).toBe(400)
    state.me = null
    expect((await call('stu')).status).toBe(401)
  })

  it('is rate limited', async () => {
    state.rateAllowed = false
    expect((await call('stu')).status).toBe(429)
    expect(state.updates).toEqual([])
  })
})
