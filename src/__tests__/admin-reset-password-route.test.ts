import { beforeEach, describe, expect, it, vi } from 'vitest'

// /api/admin/reset-password — staff issue a temporary password to a member
// who forgot theirs. Authorization mirrors /api/admin/toggle-user.

type Row = { id: string; tenant_id: string | null; role: string; is_university_student?: boolean | null; permissions?: Record<string, boolean> }

// Readable names in the tests, UUIDs on the wire (the route only accepts UUIDs).
const NAMES = ['admin1', 'cm1', 'stu', 'centreStu', 'tea', 'otherStu', 'owner', 'fresh', 'pupil']
const U = Object.fromEntries(NAMES.map((n, i) => [n, `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`])) as Record<string, string>
const NAME = Object.fromEntries(Object.entries(U).map(([n, id]) => [id, n])) as Record<string, string>

const state = vi.hoisted(() => ({
  me: 'admin1' as string | null,
  rows: {} as Record<string, Row>,
  rateAllowed: true,
  footprint: { university: false },
  // The teacher's groups and their students, and who still has a temporary password.
  teacherGroups: { tea: ['g1'] } as Record<string, string[]>,
  groupStudents: { g1: ['centreStu', 'fresh'] } as Record<string, string[]>,
  mustChange: new Set<string>(['fresh']),
  updates: [] as { id: string; password: string }[],
  flagged: [] as string[],
}))

vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ allowed: state.rateAllowed }) }))
vi.mock('@/lib/account-scope', () => ({
  loadTeacherFootprintSql: async () => state.footprint,
  studentBlock: (u: boolean | null | undefined) => (u === false ? null : 'universityStudentScope'),
  teacherBlock: (f: { university: boolean }) => (f.university ? 'universityTeacherScope' : null),
}))
vi.mock('@/lib/auth', () => ({ getSessionUser: async () => (state.me ? { id: U[state.me] } : null) }))
vi.mock('@/lib/auth/better', () => ({
  authSetPassword: async (id: string, password: string) => { state.updates.push({ id: NAME[id], password }); return { error: null } },
}))
// The SQL layer: answers each statement the route sends, from the rows above.
vi.mock('@/lib/db/sql', () => ({
  maybeOne: (rows: unknown[]) => rows[0] ?? null,
  run: async (_ctx: unknown, build: (sql: unknown) => { text: string; values: unknown[] }[]) => {
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => ({ text: strings.join('$'), values })
    return build(tag).map(({ text, values }) => {
      const row = (id: unknown) => { const r = state.rows[NAME[id as string]]; return r ? [{ ...r, id: U[r.id] }] : [] }
      if (text.startsWith('select role, tenant_id, permissions')) return row(values[0])
      if (text.startsWith('select id, tenant_id, role, is_university_student')) return row(values[0])
      if (text.includes('select exists')) {
        const [teacher, student] = [NAME[values[0] as string], NAME[values[1] as string]]
        const linked = (state.teacherGroups[teacher] ?? []).some(g => (state.groupStudents[g] ?? []).includes(student))
        return [{ linked, must_change: state.mustChange.has(student) }]
      }
      if (text.startsWith('update public.users set must_change_password = true')) { state.flagged.push(NAME[values[0] as string]); return [] }
      throw new Error('unexpected statement: ' + text)
    })
  },
}))

const { POST } = await import('@/app/api/admin/reset-password/route')
const call = (name: unknown) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ userId: typeof name === 'string' ? U[name] : name }) }))

const ALL = { manage_teachers: true, manage_students: true, manage_center_staff: true }
beforeEach(() => {
  state.me = 'admin1'
  state.rateAllowed = true
  state.footprint = { university: false }
  state.updates = []
  state.flagged = []
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
    expect(state.updates).toEqual([{ id: 'stu', password }])
    expect(state.flagged).toEqual(['stu'])
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
