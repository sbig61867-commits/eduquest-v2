import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ReportReadError } from '@/lib/data/reports'

/** D1 — /api/reports answers 503 `reportReadFailed` when a report read fails, instead of a partial report. */

// ── /api/reports ────────────────────────────────────────────────────────────

const route = vi.hoisted(() => ({ build: vi.fn() }))

vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: 'super_admin', tenant_id: null } }) }) }) }),
  }),
}))
vi.mock('@/lib/reports', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/reports')>()),
  canAccessReport: () => ({ ok: true }),
  reportsAdminClient: () => ({}),
  buildUniversityReport: (...a: unknown[]) => route.build(...a),
  buildTeacherReport: (...a: unknown[]) => route.build(...a),
  buildGroupReport: (...a: unknown[]) => route.build(...a),
  buildPilotReport: (...a: unknown[]) => route.build(...a),
  buildStudentReport: (...a: unknown[]) => route.build(...a),
}))

describe('GET /api/reports', () => {
  beforeEach(() => { route.build.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}) })
  const get = async (format: string) => {
    const { GET } = await import('@/app/api/reports/route')
    return GET(new Request(`http://x/api/reports?scope=university&id=tn&format=${format}`))
  }

  it('a ReportReadError is 503 reportReadFailed, never a partial report (JSON and CSV)', async () => {
    route.build.mockRejectedValue(new ReportReadError('page at 1000: read failed'))
    for (const format of ['json', 'csv']) {
      const res = await get(format)
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'reportReadFailed', code: 'reportReadFailed' })
    }
  })

  it('a missing subject is still 404; any other error is not swallowed', async () => {
    route.build.mockResolvedValue(null)
    expect((await get('json')).status).toBe(404)
    route.build.mockRejectedValue(new Error('bug'))
    await expect(get('json')).rejects.toThrow('bug')
  })
})
