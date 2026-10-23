// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// GET /api/announcements/interested (C1), on the SQL layer: the author's live
// row, the announcement and every interested student WITH their name come in
// one unit (the names in the same join — no batched second read that could
// pass a URL limit); a failed read is a 503, never a list without names.

const ANN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const env = vi.hoisted(() => ({
  fail: false,
  me: { role: 'university_admin', permissions: {}, has_center: false } as Record<string, unknown> | null,
  ann: { audience: 'all', center_students_only: false } as Record<string, unknown> | null,
  events: [] as unknown[],
}))

vi.mock('@/lib/auth/current', () => ({ currentCtx: async () => ({ sub: 'admin', role: 'university_admin', tenant_id: 'tn' }) }))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => {
  if (env.fail) return new Error('connection lost')
  if (q.text.startsWith('select u.role, u.permissions, t.has_center')) return env.me ? [env.me] : []
  if (q.text.startsWith('select audience, center_students_only from public.announcements')) return env.ann ? [env.ann] : []
  if (q.text.startsWith('select e.student_id, e.created_at, u.full_name, u.email')) return env.events
  return new Error('unexpected statement: ' + q.text)
}))

const uid = (k: number) => `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`
const get = async () => (await import('@/app/api/announcements/interested/route')).GET(new Request(`http://x/api/announcements/interested?id=${ANN}`))

beforeEach(() => {
  env.fail = false
  env.me = { role: 'university_admin', permissions: {}, has_center: false }
  env.ann = { audience: 'all', center_students_only: false }
  env.events = Array.from({ length: 700 }, (_, k) => ({ student_id: uid(k), created_at: '2026-10-01T00:00:00Z', full_name: `S${k}`, email: `${k}@x` }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/announcements/interested (C1)', () => {
  it('700 interested students: every one, every name', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    const { students } = await res.json() as { students: { full_name: string }[] }
    expect(students).toHaveLength(700)
    expect(students.every(s => s.full_name.startsWith('S'))).toBe(true)
  })

  it('a failed read is 503, not a list without names', async () => {
    env.fail = true
    const res = await get()
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('announcementEventFailed')
  })

  it('an author pinned to the centre cannot read an announcement that reaches university students', async () => {
    env.me = { role: 'center_manager', permissions: { manage_announcements: true }, has_center: true }
    expect((await get()).status).toBe(403)
  })

  it('another institution\'s announcement is not found', async () => {
    env.ann = null
    expect((await get()).status).toBe(404)
  })
})
