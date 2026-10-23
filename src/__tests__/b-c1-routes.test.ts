import { describe, it, expect, vi, beforeEach } from 'vitest'
import { pgMock, uid, type Call, type Relations, type World } from './complete-read-fixture'
import { ID_BATCH } from '@/lib/data/complete-read'

/**
 * B / C1 — the routes, on a client with the live API's limits (1000 rows per
 * response, ~640 ids per URL): the grade export holds every grade, deleting an
 * institution deletes every account (or nothing when the user list cannot be
 * read), and long name lists are read in batches — a failed read is an error
 * response, never a partial answer.
 */

const env = vi.hoisted(() => ({
  session: {} as World,
  admin: {} as World,
  user: null as { id: string } | null,
  relations: {} as Relations,
  fail: undefined as undefined | ((c: Call) => boolean | { code: string; message: string }),
  calls: [] as Call[],
  deletedUsers: [] as string[],
  deletedTables: [] as string[],
}))

vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string, v?: Record<string, unknown>) => (v ? `${key}:${JSON.stringify(v)}` : key) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ allowed: true, resetAt: 0 }) }))
vi.mock('@/lib/evidence-store', () => ({
  isEvidenceStoreConfigured: () => true,
  evidenceViewUrl: async (key: string) => `https://store.test/${key}`,
  putEvidence: async () => true,
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: env.user } }) },
    from: (t: string) => pgMock(env.session, { relations: env.relations, fail: env.fail, calls: env.calls }).from(t),
  }),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (t: string) => ({
      ...pgMock(env.admin, { relations: env.relations, fail: env.fail, calls: env.calls }).from(t),
      delete: () => ({ eq: async () => { env.deletedTables.push(t); return { error: null } } }),
    }),
    auth: { admin: { deleteUser: async (id: string) => { env.deletedUsers.push(id); return { error: null } } } },
  }),
}))

beforeEach(() => {
  env.session = {}; env.admin = {}; env.user = null; env.relations = {}; env.fail = undefined
  env.calls = []; env.deletedUsers = []; env.deletedTables = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// api/grades/export (B) moved to grades-export-route.test.ts (step 9: SQL layer).

// api/admin/delete-tenant (B) moved to delete-tenant-route.test.ts (step 9: SQL layer).

// ── api/announcements/interested (C1) ────────────────────────────────────────

describe('GET /api/announcements/interested (C1)', () => {
  function setup(interested: number) {
    env.user = { id: 'admin' }
    const ann = uid(1, 'a')
    const students = Array.from({ length: interested }, (_, k) => uid(k, 'b'))
    env.session = {
      users: [{ id: 'admin', role: 'university_admin', tenant_id: 'tn', permissions: {} },
        ...students.map((id, k) => ({ id, tenant_id: 'tn', full_name: `S${k}`, email: `${k}@x` }))],
      tenants: [{ id: 'tn', has_center: false }],
      announcements: [{ id: ann, tenant_id: 'tn', audience: 'all', center_students_only: false }],
      announcement_events: students.map((id, k) => ({ id: uid(k, 'c'), announcement_id: ann, tenant_id: 'tn', kind: 'interest', student_id: id, created_at: '2026-10-01T00:00:00Z' })),
    }
    return ann
  }
  const get = async (id: string) => (await import('@/app/api/announcements/interested/route')).GET(new Request(`http://x/api/announcements/interested?id=${id}`))

  it('700 interested students (past the URL limit): every name, in batches of ≤ 100 ids', async () => {
    const id = setup(700)
    const res = await get(id)
    expect(res.status).toBe(200)
    const { students } = await res.json() as { students: { full_name: string }[] }
    expect(students).toHaveLength(700)
    expect(students.every(s => s.full_name.startsWith('S'))).toBe(true)
    expect(Math.max(...env.calls.map(c => c.inIds))).toBeLessThanOrEqual(ID_BATCH)
  })

  it('a failed batch is 503, not a list without names', async () => {
    const id = setup(700)
    let batches = 0
    env.fail = c => c.table === 'users' && c.inIds > 0 && ++batches === 4
    const res = await get(id)
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('announcementEventFailed')
  })
})

// ── api/proctor/evidence (C1) ────────────────────────────────────────────────

// GET /api/proctor/evidence (C1) moved to proctor-evidence-route.test.ts (step 9: names come with the attempts, one join).
