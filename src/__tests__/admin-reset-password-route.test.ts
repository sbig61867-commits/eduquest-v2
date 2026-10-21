import { beforeEach, describe, expect, it, vi } from 'vitest'

// /api/admin/reset-password — staff issue a temporary password to a member
// who forgot theirs. Authorization mirrors /api/admin/toggle-user.

type Row = { id: string; tenant_id: string | null; role: string; is_university_student?: boolean | null; permissions?: Record<string, boolean> }

const state = vi.hoisted(() => ({
  me: 'admin1' as string | null,
  rows: {} as Record<string, Row>,
  rateAllowed: true,
  footprint: { university: false },
  // The teacher's groups and their students, and who still has a temporary password.
  teacherGroups: { tea: ['g1'] } as Record<string, string[]>,
  groupStudents: { g1: ['centreStu', 'fresh'] } as Record<string, string[]>,
  mustChange: new Set<string>(['fresh']),
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
    from: (table: string) => {
      const f: Record<string, unknown> = {}
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => { f[c] = v; return q },
        is: () => q,
        in: (c: string, v: unknown) => { f[c] = v; return q },
        // groups: …limit(500) is awaited; group_students: …limit(1).maybeSingle().
        limit: () => ({
          then: (done: (r: unknown) => void) => done({ data: (state.teacherGroups[f.teacher_id as string] ?? []).map(id => ({ id })) }),
          maybeSingle: async () => {
            const hit = (f.group_id as string[]).find(g => (state.groupStudents[g] ?? []).includes(f.student_id as string))
            return { data: table === 'group_students' && hit ? { group_id: hit } : null }
          },
        }),
      }
      return q
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: { id, app_metadata: { must_change_password: state.mustChange.has(id) } } } }),
        updateUserById: async (id: string, attrs: never) => { state.updates.push({ id, attrs }); return { error: null } },
      },
    },
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
  state.mustChange = new Set(['fresh'])
  state.rows = {
    admin1: { id: 'admin1', tenant_id: 'T1', role: 'university_admin', permissions: ALL },
    cm1: { id: 'cm1', tenant_id: 'T1', role: 'center_manager', permissions: ALL },
    stu: { id: 'stu', tenant_id: 'T1', role: 'student', is_university_student: true },
    centreStu: { id: 'centreStu', tenant_id: 'T1', role: 'student', is_university_student: false },
    tea: { id: 'tea', tenant_id: 'T1', role: 'teacher' },
    otherStu: { id: 'otherStu', tenant_id: 'T2', role: 'student', is_university_student: true },
    owner: { id: 'owner', tenant_id: null, role: 'super_admin' },
    fresh: { id: 'fresh', tenant_id: 'T1', role: 'student', is_university_student: false },
    pupil: { id: 'pupil', tenant_id: 'T1', role: 'student', is_university_student: false },
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

  it('a teacher re-issues a lost temporary password for a student of their group who never chose one', async () => {
    state.me = 'tea'
    const res = await call('fresh')
    expect(res.status).toBe(200)
    expect(state.updates.map(u => u.id)).toEqual(['fresh'])
  })

  it('a teacher may not reset a student who already chose their own password', async () => {
    state.me = 'tea'
    const res = await call('centreStu')
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('studentPasswordAlreadySet')
    expect(state.updates).toEqual([])
  })

  it('a teacher may not reset a student outside their groups, nor any staff', async () => {
    state.me = 'tea'
    state.mustChange.add('pupil')
    expect((await call('pupil')).status).toBe(403)
    expect((await call('stu')).status).toBe(403)
    expect((await call('admin1')).status).toBe(403)
    expect(state.updates).toEqual([])
  })

  it('a student cannot reset anyone', async () => {
    state.me = 'fresh'
    expect((await call('pupil')).status).toBe(403)
    expect(state.updates).toEqual([])
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
