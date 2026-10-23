// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// A student may stream only while the exam's teacher is in the LiveKit room
// AND lists that student in its `watching` attribute. The answer comes from
// LiveKit itself, so a student cannot start streaming on its own.

const EXAM_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
const EXAM = { id: EXAM_ID, teacher_id: 'teacher-1', proctoring_enabled: true }
const state = vi.hoisted(() => ({
  userId: 'student-1',
  participants: [] as { identity: string; attributes?: Record<string, string> }[],
  listThrows: false,
  onRoster: true,
  grants: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/auth/current', () => ({
  currentCtx: async () => ({ sub: state.userId, email: 'x@test', role: state.userId === 'teacher-1' ? 'teacher' : 'student', tenant_id: '11111111-1111-1111-1111-111111111111', is_active: true, must_change_password: false }),
  serviceScopeFor: () => ({ as: 'service', tenantId: '11111111-1111-1111-1111-111111111111' }),
}))
// The exam with the roster check, and the caller's name: one unit on the SQL layer.
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => {
  if (q.text.startsWith('select e.teacher_id, e.proctoring_enabled')) return [{ ...EXAM, on_roster: state.onRoster }]
  if (q.text.startsWith('select full_name from public.users')) return [{ full_name: 'Someone' }]
  return new Error('unexpected statement: ' + q.text)
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('livekit-server-sdk', () => ({
  AccessToken: class {
    addGrant(g: Record<string, unknown>) { state.grants.push(g) }
    async toJwt() { return 'jwt' }
  },
  RoomServiceClient: class {
    constructor(host: string) { if (!host.startsWith('https://')) throw new Error('bad host ' + host) }
    async listParticipants() {
      if (state.listThrows) throw new Error('room not found')
      return state.participants
    }
  },
}))

import { POST } from '@/app/api/proctor/live-token/route'

function call(role: 'student' | 'teacher') {
  return POST(new Request('http://x/api/proctor/live-token', { method: 'POST', body: JSON.stringify({ examId: EXAM_ID, role }) }))
}

describe('live token is on demand', () => {
  beforeEach(() => {
    process.env.LIVEKIT_URL = 'wss://lk.test'
    process.env.LIVEKIT_API_KEY = 'key'
    process.env.LIVEKIT_API_SECRET = 'secret'
    state.userId = 'student-1'
    state.participants = []
    state.listThrows = false
    state.onRoster = true
    state.grants = []
  })

  it('refuses a student while no teacher is watching (no room yet)', async () => {
    state.listThrows = true
    expect((await call('student')).status).toBe(409)
  })

  it('refuses a student the teacher is not watching', async () => {
    state.participants = [{ identity: 'teacher-1', attributes: { watching: 'student-2' } }]
    expect((await call('student')).status).toBe(409)
  })

  it('refuses when someone other than the exam teacher claims to watch', async () => {
    state.participants = [{ identity: 'student-9', attributes: { watching: 'student-1' } }]
    expect((await call('student')).status).toBe(409)
  })

  it('refuses a student who is not on the roster, whoever watches', async () => {
    state.onRoster = false
    state.participants = [{ identity: 'teacher-1', attributes: { watching: 'student-1' } }]
    expect((await call('student')).status).toBe(403)
  })

  it('issues a publish-only token to a watched student', async () => {
    state.participants = [{ identity: 'teacher-1', attributes: { watching: 'student-3,student-1' } }]
    const res = await call('student')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ identity: 'student-1', teacher: 'teacher-1' })
    expect(state.grants[0]).toMatchObject({ canPublish: true, canSubscribe: false, canUpdateOwnMetadata: false })
  })

  it('lets the exam teacher join and announce whom it watches', async () => {
    state.userId = 'teacher-1'
    const res = await call('teacher')
    expect(res.status).toBe(200)
    expect(state.grants[0]).toMatchObject({ canPublish: false, canSubscribe: true, canUpdateOwnMetadata: true })
  })
})
