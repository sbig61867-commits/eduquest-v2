// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The live channel that replaced Supabase Realtime (step 13): join tickets,
// the relay rules (the old Realtime policies, carried over), and the ticket route.

import { signLiveTicket, verifyLiveTicket, isLiveTopic, examOfTopic } from '@/lib/live-ticket'
import { decide, onLeave, presenceState, type Peer } from '@/lib/live-relay'

const SECRET = 'a-live-signing-secret-long-enough-xx'
const EXAM = '11111111-1111-4111-8111-111111111111'
const LIVE = `exam-live:${EXAM}`
const THUMBS = `exam-thumbs:${EXAM}`
const T = '22222222-2222-4222-8222-222222222222'
const S1 = '33333333-3333-4333-8333-333333333333'
const S2 = '44444444-4444-4444-8444-444444444444'
const IMG = 'data:image/webp;base64,AAAA'

describe('join tickets', () => {
  it('a genuine ticket verifies; a tampered, expired, other-secret or malformed one does not', async () => {
    const t = await signLiveTicket(SECRET, { topic: LIVE, userId: S1, role: 'student' })
    expect(await verifyLiveTicket(SECRET, t)).toEqual({ topic: LIVE, userId: S1, role: 'student' })
    const [body, sig] = t.split('.')
    const forged = Buffer.from(JSON.stringify({ t: LIVE, u: S1, r: 'teacher', e: 9_999_999_999 })).toString('base64url')
    expect(await verifyLiveTicket(SECRET, `${forged}.${sig}`)).toBeNull()
    expect(await verifyLiveTicket(SECRET, t, Date.now() + 61_000)).toBeNull()
    expect(await verifyLiveTicket('another-secret-also-long-enough-yy', t)).toBeNull()
    expect(await verifyLiveTicket(SECRET, body)).toBeNull()
    expect(await verifyLiveTicket(SECRET, null)).toBeNull()
  })

  it('no secret (or a short one): nothing is signed and nothing verifies', async () => {
    await expect(signLiveTicket('short', { topic: LIVE, userId: S1, role: 'student' })).rejects.toThrow(/LIVE_SIGNING_SECRET/)
    expect(await verifyLiveTicket(undefined, 'x.y')).toBeNull()
  })

  it('topics: only exam-live / exam-thumbs with an exam id', () => {
    expect(isLiveTopic(LIVE)).toBe(true)
    expect(isLiveTopic(THUMBS)).toBe(true)
    expect(isLiveTopic('exam-live:../x')).toBe(false)
    expect(isLiveTopic('other:' + EXAM)).toBe(false)
    expect(examOfTopic(THUMBS)).toBe(EXAM)
  })
})

describe('relay rules', () => {
  let teacher: Peer, s1: Peer, s2: Peer, wall: Peer, s1Thumbs: Peer, peers: Peer[]
  beforeEach(() => {
    teacher = { userId: T, role: 'teacher', topic: LIVE }
    s1 = { userId: S1, role: 'student', topic: LIVE }
    s2 = { userId: S2, role: 'student', topic: LIVE, presence: { v: 1, ev: 0 } }
    wall = { userId: T, role: 'teacher', topic: THUMBS }
    s1Thumbs = { userId: S1, role: 'student', topic: THUMBS }
    peers = [teacher, s1, s2, wall, s1Thumbs]
  })
  const send = (from: Peer, msg: unknown) => decide(from, JSON.stringify(msg), peers)

  it("a student's presence (counts only) reaches the teacher only, with a join on the first one", () => {
    const d = send(s1, { t: 'track', payload: { v: 3, ev: 2, secret: 'x' } })
    expect(d.presence).toEqual({ v: 3, ev: 2 })
    const sync = d.deliveries.find(x => x.msg.t === 'presence' && x.msg.event === 'sync')!
    expect(sync.to).toEqual([teacher])
    expect(sync.msg).toEqual({ t: 'presence', event: 'sync', state: { [S1]: [{ v: 3, ev: 2 }], [S2]: [{ v: 1, ev: 0 }] } })
    expect(d.deliveries.find(x => x.msg.t === 'presence' && x.msg.event === 'join')!.to).toEqual([teacher])
  })

  it('only the teacher broadcasts on the live topic (watch / clip / thumbs), to the students', () => {
    const d = send(teacher, { t: 'broadcast', event: 'watch', payload: { ids: [S1] } })
    expect(d.deliveries).toEqual([{ to: [s1, s2], msg: { t: 'broadcast', event: 'watch', payload: { ids: [S1] } } }])
    expect(send(s1, { t: 'broadcast', event: 'watch', payload: { ids: [S2] } }).deliveries).toEqual([])
    expect(send(teacher, { t: 'broadcast', event: 'anything', payload: {} }).deliveries).toEqual([])
  })

  it("a picture goes to the teacher only, under the SENDER's verified id, and only a small webp/jpeg", () => {
    const d = send(s1Thumbs, { t: 'broadcast', event: 'thumb', payload: { id: S2, img: IMG } })
    expect(d.deliveries).toHaveLength(1)
    expect(d.deliveries[0].to).toEqual([wall])
    expect((d.deliveries[0].msg as { payload: { id: string } }).payload.id).toBe(S1)
    expect(send(s1Thumbs, { t: 'broadcast', event: 'thumb', payload: { img: 'javascript:alert(1)' } }).deliveries).toEqual([])
    expect(send(s1Thumbs, { t: 'broadcast', event: 'thumb', payload: { img: IMG + 'A'.repeat(40_001) } }).deliveries).toEqual([])
    expect(send(wall, { t: 'broadcast', event: 'thumb', payload: { img: IMG } }).deliveries).toEqual([])
  })

  it('oversized or broken messages are dropped unread', () => {
    expect(decide(s1, 'x'.repeat(64_001), peers).deliveries).toEqual([])
    expect(decide(s1, '{not json', peers).deliveries).toEqual([])
  })

  it("a student leaving updates the teacher's view; presence state lists live-topic peers only", () => {
    const d = onLeave(s2, [teacher, s1, wall, s1Thumbs])
    expect(d.deliveries).toEqual([{ to: [teacher], msg: { t: 'presence', event: 'sync', state: {} } }])
    expect(presenceState([{ ...teacher, presence: {} }, s2])).toEqual({ teacher: [{}], [S2]: [{ v: 1, ev: 0 }] })
  })
})

type Q = { text: string; values: unknown[]; ctx: { as: string; userId?: string } }
const db = vi.hoisted(() => ({ calls: [] as Q[], role: 'student' as string | null }))
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => { db.calls.push(q as Q); return [{ role: db.role }] }))
const who = vi.hoisted(() => ({ user: { id: '33333333-3333-4333-8333-333333333333' } as { id: string } | null }))
vi.mock('@/lib/auth/current', () => ({ currentUser: async () => who.user }))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))

describe('GET /api/live/ticket', () => {
  beforeEach(() => { db.calls = []; db.role = 'student'; who.user = { id: S1 }; process.env.LIVE_SIGNING_SECRET = SECRET })
  const get = async (topic: string) => (await import('@/app/api/live/ticket/route')).GET(new Request(`http://x/api/live/ticket?topic=${encodeURIComponent(topic)}`))

  it('asks exam_topic_role() as the caller and signs a ticket for that role', async () => {
    const res = await get(LIVE)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.role).toBe('student')
    expect(await verifyLiveTicket(SECRET, body.ticket)).toEqual({ topic: LIVE, userId: S1, role: 'student' })
    expect(db.calls).toEqual([{ text: 'select public.exam_topic_role($) as role', values: [LIVE], ctx: { as: 'user', userId: S1 } }])
  })

  it('no role (not on the exam / not in progress) → 403; a bad topic → 400; signed out → 401', async () => {
    db.role = null
    expect((await get(LIVE)).status).toBe(403)
    expect((await get('exam-live:nope')).status).toBe(400)
    who.user = null
    expect((await get(LIVE)).status).toBe(401)
  })
})
