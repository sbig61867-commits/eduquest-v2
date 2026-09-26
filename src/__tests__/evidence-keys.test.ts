import { describe, expect, it } from 'vitest'
import {
  EVIDENCE_LINK_SECONDS, EVIDENCE_TTL_MS, evidenceKey, evidenceKeysFromEvents, examPrefix, expiresAt, extOf, isExpired,
  linkSeconds, parseEvidenceKey, sniffEvidenceImage, studentPrefix,
} from '@/lib/evidence-keys'

const EXAM = '11111111-2222-4333-8444-555555555555'
const STUDENT = '99999999-8888-4777-8666-555555555555'
const T0 = 1_790_000_000_000

describe('evidence keys', () => {
  it('round-trips a key and keeps it under the exam and student prefixes', () => {
    const key = evidenceKey(EXAM, STUDENT, 'multiple_faces', T0, 'webp')
    expect(key.startsWith(examPrefix(EXAM))).toBe(true)
    expect(key.startsWith(studentPrefix(EXAM, STUDENT))).toBe(true)
    expect(parseEvidenceKey(key)).toEqual({ key, examId: EXAM, studentId: STUDENT, capturedAt: T0, type: 'multiple_faces' })
  })

  it('rejects anything that is not a well-formed evidence key', () => {
    expect(parseEvidenceKey(`evidence/${EXAM}/${STUDENT}/${T0}-looking_away.webp`)).toBeNull() // not a severe type
    expect(parseEvidenceKey(`evidence/not-a-uuid/${STUDENT}/${T0}-tab_switch.webp`)).toBeNull()
    expect(parseEvidenceKey(`evidence/${EXAM}/${STUDENT}/${T0}-tab_switch.png`)).toBeNull()
    expect(parseEvidenceKey(`other/${EXAM}/${STUDENT}/${T0}-tab_switch.webp`)).toBeNull()
    expect(parseEvidenceKey(`evidence/${EXAM}/${STUDENT}/../${T0}-tab_switch.webp`)).toBeNull()
  })
})

describe('30 hour lifetime', () => {
  it('expires exactly 30 hours after capture', () => {
    expect(EVIDENCE_TTL_MS).toBe(30 * 60 * 60 * 1000)
    expect(expiresAt(T0)).toBe(T0 + EVIDENCE_TTL_MS)
    expect(isExpired(T0, T0 + EVIDENCE_TTL_MS - 1)).toBe(false)
    expect(isExpired(T0, T0 + EVIDENCE_TTL_MS)).toBe(true)
  })

  it('never signs a link that outlives the snapshot', () => {
    expect(linkSeconds(T0, T0)).toBe(EVIDENCE_LINK_SECONDS)
    expect(linkSeconds(T0, T0 + EVIDENCE_TTL_MS - 90_000)).toBe(90)
    expect(linkSeconds(T0, T0 + EVIDENCE_TTL_MS)).toBe(0)
    expect(linkSeconds(T0, T0 + EVIDENCE_TTL_MS + 5_000)).toBe(0)
  })
})

describe('image sniffing', () => {
  it('recognises WebP and JPEG from their bytes only', () => {
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56])
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0])
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0])
    expect(sniffEvidenceImage(webp)).toBe('webp')
    expect(sniffEvidenceImage(jpeg)).toBe('jpg')
    expect(sniffEvidenceImage(png)).toBeNull()
    expect(sniffEvidenceImage(new Uint8Array())).toBeNull()
  })
})

describe('index from the attempt event log', () => {
  it('keeps only well-formed evidence keys, once each', () => {
    const k1 = evidenceKey(EXAM, STUDENT, 'tab_switch', T0, 'webp')
    const k2 = evidenceKey(EXAM, STUDENT, 'multiple_faces', T0 + 1, 'jpg')
    const events = [
      { type: 'tab_switch', evidence_key: k1 },
      { type: 'tab_switch', evidence_key: k1 },
      { type: 'looking_away' },
      { type: 'multiple_faces', evidence_key: k2 },
      { type: 'x', evidence_key: 'evidence/../../etc' },
      null,
      'junk',
    ]
    expect(evidenceKeysFromEvents(events).map(k => k.key)).toEqual([k1, k2])
    expect(evidenceKeysFromEvents(null)).toEqual([])
    expect(extOf(k2)).toBe('jpg')
    expect(extOf(k1)).toBe('webp')
  })
})
