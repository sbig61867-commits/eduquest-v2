// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { evidenceKey, SEVERE_EVIDENCE_TYPES } from '@/lib/evidence-keys'

// GET /api/proctor/evidence (C1), on the SQL layer: the exam's own teacher
// gets every live snapshot with every student's name — the names come with the
// attempts in one join (no batched second read) — and a failed read is a 503,
// never a list with names missing.

const EXAM = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const env = vi.hoisted(() => ({
  teacher: 'teach',
  examTeacher: 'teach',
  rows: [] as { student_id: string; proctoring_events: unknown; full_name: string | null }[],
  fail: false,
}))

vi.mock('@/lib/auth', () => ({ getSessionUser: async () => ({ id: env.teacher }) }))
vi.mock('@/lib/auth/current', () => ({ currentCtx: async () => null }))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ allowed: true, resetAt: 0 }) }))
vi.mock('@/lib/evidence-store', () => ({
  isEvidenceStoreConfigured: () => true,
  evidenceViewUrl: async (key: string) => `https://store.test/${key}`,
  putEvidence: async () => true,
}))
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => {
  if (env.fail) return new Error('connection lost')
  if (q.text.startsWith('select teacher_id from public.exams')) return [{ teacher_id: env.examTeacher }]
  if (q.text.startsWith('select s.student_id, s.proctoring_events, u.full_name')) return env.rows
  return new Error('unexpected statement: ' + q.text)
}))

const uid = (k: number) => `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`
const get = async () => (await import('@/app/api/proctor/evidence/route')).GET(new Request(`http://x/api/proctor/evidence?examId=${EXAM}`))

function setup(students: number) {
  const type = SEVERE_EVIDENCE_TYPES[0]
  env.rows = Array.from({ length: students }, (_, k) => ({
    student_id: uid(k),
    full_name: `S${k}`,
    proctoring_events: [{ type, evidence_key: evidenceKey(EXAM, uid(k), type, Date.now() - 60_000, 'webp') }],
  }))
}

beforeEach(() => { env.teacher = 'teach'; env.examTeacher = 'teach'; env.fail = false })

describe('GET /api/proctor/evidence (C1)', () => {
  it('evidence of 700 students: every one, every name', async () => {
    setup(700)
    const res = await get()
    expect(res.status).toBe(200)
    const { items } = await res.json() as { items: { studentName: string }[] }
    expect(items).toHaveLength(700)
    expect(items.every(i => i.studentName.startsWith('S'))).toBe(true)
  })

  it('a failed read is 503 dataReadIncomplete', async () => {
    setup(700)
    env.fail = true
    const res = await get()
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('dataReadIncomplete')
  })

  it("another teacher's exam is refused", async () => {
    setup(3)
    env.examTeacher = 'someone-else'
    expect((await get()).status).toBe(403)
  })

  it("a key inside another student's row is not trusted", async () => {
    setup(2)
    env.rows[1].proctoring_events = env.rows[0].proctoring_events
    const { items } = await (await get()).json() as { items: unknown[] }
    expect(items).toHaveLength(1)
  })
})
