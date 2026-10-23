// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// GET /api/grades/export (B), on the SQL layer: the group, its exams, its
// students and every submission come in one unit, each read whole (no page
// cap), so the grade matrix holds every grade; a failed read is a 503, never
// a sheet with missing grades.

const GROUP = '11111111-1111-4111-8111-111111111111'
const env = vi.hoisted(() => ({ fail: false, owner: 'teach', exams: [] as unknown[], members: [] as unknown[], subs: [] as unknown[] }))

vi.mock('@/lib/auth/current', () => ({ currentCtx: async () => ({ sub: 'teach', role: 'teacher', tenant_id: 'tn' }) }))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string, v?: Record<string, unknown>) => (v ? `${key}:${JSON.stringify(v)}` : key) }))
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => {
  if (env.fail && q.text.includes('from public.exam_submissions')) return new Error('connection lost')
  if (q.text.startsWith('select teacher_id, tenant_id, name from public.groups')) return [{ teacher_id: env.owner, tenant_id: 'tn', name: 'G' }]
  if (q.text.startsWith('select id, title, type, questions from public.exams')) return env.exams
  if (q.text.startsWith('select gs.student_id')) return env.members
  if (q.text.startsWith('select s.exam_id, s.student_id, s.score')) return env.subs
  return new Error('unexpected statement: ' + q.text)
}))

const uid = (k: number, p: string) => `00000000-0000-4000-8000-${p.repeat(4)}${String(k).padStart(8, '0')}`
const get = async () => (await import('@/app/api/grades/export/route')).GET(new Request(`http://x/api/grades/export?group_id=${GROUP}&format=json`))

beforeEach(() => {
  const MEMBERS = 40, EXAMS = 30
  env.fail = false; env.owner = 'teach'
  env.exams = Array.from({ length: EXAMS }, (_, k) => ({ id: uid(k, 'e'), title: `E${k}`, type: 'exam', questions: [{ points: 10 }] }))
  env.members = Array.from({ length: MEMBERS }, (_, k) => ({ student_id: uid(k, 'c'), full_name: `S${k}`, email: `${k}@x` }))
  env.subs = (env.members as { student_id: string }[]).flatMap(m => (env.exams as { id: string }[]).map(e => ({ exam_id: e.id, student_id: m.student_id, score: 7 })))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/grades/export (B)', () => {
  it('a 40 × 30 grade matrix (1 200 submissions) has every grade', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    const { rows } = await res.json() as { rows: Record<string, unknown>[] }
    expect(rows).toHaveLength(40)
    const cells = rows.flatMap(r => Object.entries(r).filter(([k]) => k.startsWith('column:')).map(([, v]) => v))
    expect(cells).toHaveLength(1200)
    expect(cells.every(v => v === '7/10')).toBe(true)
  })

  it('a failed read is 503 dataReadIncomplete, not a sheet with missing grades', async () => {
    env.fail = true
    const res = await get()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'dataReadIncomplete', code: 'dataReadIncomplete' })
  })

  it("another teacher's group is refused", async () => {
    env.owner = 'someone-else'
    expect((await get()).status).toBe(403)
  })
})
