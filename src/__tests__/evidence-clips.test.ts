// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LEAD_IN_MS, pickClipMimeType, recentSegments, segmentForViolation } from '@/lib/clip-segments'
import {
  CLIP_MAX_PER_STUDENT, evidenceKey, extOf, isClipExt, parseEvidenceKey, sniffEvidenceVideo,
} from '@/lib/evidence-keys'

const seg = (start: number, end: number, data = `${start}`) => ({ start, end, data })

describe('which segment shows a violation', () => {
  const ring = [seg(0, 10_000), seg(10_000, 20_000), seg(20_000, 30_000)]
  it('picks the segment containing the moment', () => {
    expect(segmentForViolation(ring, 15_000)?.start).toBe(10_000)
  })
  it('picks the previous segment when the violation is right at the start of one', () => {
    expect(segmentForViolation(ring, 20_000 + LEAD_IN_MS - 1)?.start).toBe(10_000)
  })
  it('keeps the first segment when there is nothing before it', () => {
    expect(segmentForViolation([seg(0, 10_000)], 500)?.start).toBe(0)
  })
  it('returns nothing for a moment outside the ring', () => {
    expect(segmentForViolation(ring, 50_000)).toBeNull()
  })
  it('returns the newest segments for a teacher request', () => {
    expect(recentSegments(ring, 30, 30_000).map(s => s.start)).toEqual([0, 10_000, 20_000])
    expect(recentSegments(ring, 10, 30_000).map(s => s.start)).toEqual([20_000])
  })
  it('prefers WebM, falls back to MP4 (Safari)', () => {
    expect(pickClipMimeType(t => t.startsWith('video/webm'))).toBe('video/webm;codecs=vp8,opus')
    expect(pickClipMimeType(t => t === 'video/mp4')).toBe('video/mp4')
    expect(pickClipMimeType(() => false)).toBeNull()
  })
})

const E = '11111111-1111-4111-8111-111111111111'
const S = '22222222-2222-4222-8222-222222222222'
const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6])
const mp4 = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0])

describe('evidence keys for clips', () => {
  it('round-trips clip keys, including teacher requests', () => {
    const k = evidenceKey(E, S, 'on_request', 1790000000000, 'webm')
    expect(parseEvidenceKey(k)).toMatchObject({ examId: E, studentId: S, type: 'on_request' })
    expect(isClipExt(extOf(k))).toBe(true)
    expect(isClipExt(extOf(evidenceKey(E, S, 'multiple_faces', 1790000000000, 'webp')))).toBe(false)
  })
  it('sniffs the container from bytes', () => {
    expect(sniffEvidenceVideo(webm)).toBe('webm')
    expect(sniffEvidenceVideo(mp4)).toBe('mp4')
    expect(sniffEvidenceVideo(new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull()
  })
})

// ── The upload route ──
const state = vi.hoisted(() => ({
  user: 'student' as string | null,
  status: 'in_progress',
  events: [] as unknown[],
  proctored: true,
  onRoster: true,
  stored: [] as string[],
  appended: [] as unknown[],
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user ? { id: S } : null } }) } }),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => {
        const chain = {
          eq: () => chain,
          single: async () => ({ data: table === 'exams' ? { id: E, proctoring_enabled: state.proctored } : null }),
          maybeSingle: async () => ({ data: { status: state.status, proctoring_events: state.events } }),
        }
        return chain
      },
    }),
    rpc: async (_: string, args: { p_events: unknown[] }) => { state.appended.push(...args.p_events); return { error: null } },
  }),
}))
vi.mock('@/lib/exam-roster', () => ({ isOnExamRoster: async () => state.onRoster }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ allowed: true }) }))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/evidence-store', () => ({
  isEvidenceStoreConfigured: () => true,
  putEvidence: async (key: string) => { state.stored.push(key); return true },
}))

import { POST } from '@/app/api/proctor/evidence/clip/route'

function post(bytes: Uint8Array, type = 'multiple_faces') {
  return POST(new Request(`http://x/api/proctor/evidence/clip?examId=${E}&type=${type}`, { method: 'POST', body: bytes as BodyInit }))
}

describe('clip upload route', () => {
  beforeEach(() => {
    state.user = 'student'; state.status = 'in_progress'; state.events = []; state.proctored = true
    state.onRoster = true; state.stored = []; state.appended = []
  })

  it('stores a real clip outside Supabase and appends only a key line', async () => {
    const res = await post(webm)
    expect(await res.json()).toEqual({ stored: true })
    expect(state.stored[0]).toMatch(new RegExp(`^evidence/${E}/${S}/\\d+-multiple_faces\\.webm$`))
    expect(state.appended[0]).toMatchObject({ type: 'multiple_faces', evidence_key: state.stored[0] })
  })

  it('files a teacher-requested clip as info, not a violation', async () => {
    await post(mp4, 'on_request')
    expect(state.appended[0]).toMatchObject({ type: 'clip_requested' })
    expect(state.stored[0]).toMatch(/-on_request\.mp4$/)
  })

  it('rejects bytes that are not a video', async () => {
    expect((await post(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]))).status).toBe(400)
    expect(state.stored).toEqual([])
  })

  it('rejects oversized clips', async () => {
    const big = new Uint8Array(1_000_000); big.set(webm)
    expect((await post(big)).status).toBe(413)
  })

  it('refuses a non-severe type, a closed attempt, a non-member and the cap', async () => {
    expect(await (await post(webm, 'looking_away')).json()).toMatchObject({ stored: false, reason: 'not_severe' })
    state.status = 'submitted'
    expect(await (await post(webm)).json()).toMatchObject({ stored: false, reason: 'not_in_progress' })
    state.status = 'in_progress'; state.onRoster = false
    expect((await post(webm)).status).toBe(403)
    state.onRoster = true
    state.events = Array.from({ length: CLIP_MAX_PER_STUDENT }, (_, i) => ({ evidence_key: evidenceKey(E, S, 'multiple_faces', 1790000000000 + i, 'webm') }))
    expect(await (await post(webm)).json()).toMatchObject({ stored: false, reason: 'limit_reached' })
    expect(state.stored).toEqual([])
  })

  it('snapshots do not count against the clip cap', async () => {
    state.events = Array.from({ length: 10 }, (_, i) => ({ evidence_key: evidenceKey(E, S, 'multiple_faces', 1790000000000 + i, 'webp') }))
    expect(await (await post(webm)).json()).toEqual({ stored: true })
  })

  it('requires a signed-in user', async () => {
    state.user = null
    expect((await post(webm)).status).toBe(401)
  })
})

describe('room scan clip', () => {
  beforeEach(() => {
    state.user = 'student'; state.status = 'in_progress'; state.events = []; state.proctored = true
    state.onRoster = true; state.stored = []; state.appended = []
  })

  it('is filed as info and kept once per attempt', async () => {
    expect(await (await post(webm, 'room_scan')).json()).toEqual({ stored: true })
    expect(state.appended[0]).toMatchObject({ type: 'room_scan' })
    state.events = [{ evidence_key: state.stored[0] }]
    expect(await (await post(webm, 'room_scan')).json()).toMatchObject({ stored: false, reason: 'limit_reached' })
  })
})
