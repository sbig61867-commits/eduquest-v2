// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.APP_SESSION_SECRET = 'test-session-secret-at-least-32-characters'
delete process.env.SECOND_CAMERA_SECRET

import { SECOND_CAMERA_TTL_SECONDS, createSecondCameraToken, verifySecondCameraToken } from '@/lib/second-camera-token'

const E = '11111111-1111-4111-8111-111111111111'
const S = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'
const T = '44444444-4444-4444-8444-444444444444'

describe('second-camera token', () => {
  it('round-trips exam, student and institution', () => {
    expect(verifySecondCameraToken(createSecondCameraToken(E, S, T))).toMatchObject({ examId: E, studentId: S, tenantId: T })
  })

  it('expires', () => {
    const now = 1_790_000_000
    const tok = createSecondCameraToken(E, S, T, now)
    expect(verifySecondCameraToken(tok, now + SECOND_CAMERA_TTL_SECONDS - 1)).not.toBeNull()
    expect(verifySecondCameraToken(tok, now + SECOND_CAMERA_TTL_SECONDS)).toBeNull()
  })

  it('cannot be moved to another student, exam or institution', () => {
    const [, sig] = createSecondCameraToken(E, S, T).split('.')
    const exp = Math.floor(Date.now() / 1000) + 3600
    for (const payload of [`${E}.${OTHER}.${T}.${exp}`, `${E}.${S}.${OTHER}.${exp}`]) {
      expect(verifySecondCameraToken(`${Buffer.from(payload).toString('base64url')}.${sig}`)).toBeNull()
    }
  })

  it('rejects garbage and a wrong key', () => {
    expect(verifySecondCameraToken('')).toBeNull()
    expect(verifySecondCameraToken('abc')).toBeNull()
    expect(verifySecondCameraToken('a.b')).toBeNull()
    const tok = createSecondCameraToken(E, S, T)
    process.env.SECOND_CAMERA_SECRET = 'another-key'
    expect(verifySecondCameraToken(tok)).toBeNull()
    delete process.env.SECOND_CAMERA_SECRET
  })
})

// ── The phone's event route ──
const state = vi.hoisted(() => ({ status: 'in_progress', appended: [] as Record<string, unknown>[], stored: [] as string[] }))

// The attempt and the appender, as the route reaches them (src/lib/proctoring-attempt.ts).
vi.mock('@/lib/proctoring-attempt', () => ({
  loadProctoredAttempt: async () => ({ proctored: true, onRoster: true, attempt: { status: state.status, proctoring_events: [] } }),
  appendProctoringEvents: async (tenant: string, _exam: string, student: string, events: Record<string, unknown>[]) => {
    state.appended.push(...events.map(e => ({ ...e, student, tenant })))
  },
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ allowed: true }) }))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/evidence-store', () => ({
  isEvidenceStoreConfigured: () => true,
  putEvidence: async (key: string) => { state.stored.push(key); return true },
}))

import { POST } from '@/app/api/proctor/second-camera/event/route'

const webp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3]).toString('base64')
const call = (body: Record<string, unknown>) =>
  POST(new Request('http://x/api/proctor/second-camera/event', { method: 'POST', body: JSON.stringify(body) }))

describe('second-camera event route', () => {
  beforeEach(() => { state.status = 'in_progress'; state.appended = []; state.stored = [] })

  it('records the connection for the student named by the token', async () => {
    const res = await call({ token: createSecondCameraToken(E, S, T), kind: 'connected' })
    expect(await res.json()).toEqual({ stored: true })
    expect(state.appended[0]).toMatchObject({ type: 'second_camera_connected', student: S })
  })

  it('records a side-view detection with its snapshot, marked as side camera', async () => {
    await call({ token: createSecondCameraToken(E, S, T), kind: 'violation', type: 'suspicious_activity', details: 'cell phone detected (80%)', imageBase64: webp })
    expect(state.appended[0]).toMatchObject({ type: 'suspicious_activity', details: 'side camera: cell phone detected (80%)' })
    expect(state.stored[0]).toMatch(new RegExp(`^evidence/${E}/${S}/\\d+-suspicious_activity\\.webp$`))
    expect(state.appended[0].evidence_key).toBe(state.stored[0])
  })

  it('refuses a forged or missing token', async () => {
    expect((await call({ token: 'x.y', kind: 'connected' })).status).toBe(401)
    expect((await call({ kind: 'connected' })).status).toBe(401)
    expect(state.appended).toEqual([])
  })

  it('refuses types the side camera may not report', async () => {
    expect((await call({ token: createSecondCameraToken(E, S, T), kind: 'violation', type: 'tab_switch' })).status).toBe(400)
  })

  it('does nothing once the attempt is over', async () => {
    state.status = 'submitted'
    expect(await (await call({ token: createSecondCameraToken(E, S, T), kind: 'connected' })).json()).toMatchObject({ stored: false, reason: 'not_in_progress' })
    expect(state.appended).toEqual([])
  })
})
