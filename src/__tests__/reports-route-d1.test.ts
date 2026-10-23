// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ReportReadError } from '@/lib/data/reports'

/**
 * D1 — /api/reports answers 503 `reportReadFailed` when a report read fails,
 * instead of a partial report. The gate reads the caller's live row (owner
 * only). What the reports compute is proven against reports-golden.json on
 * the Neon trial (reports-golden-trial.test.ts).
 */

const ID = '11111111-1111-4111-8111-111111111111'
const route = vi.hoisted(() => ({ build: vi.fn(), role: 'super_admin' as string | null }))

vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/auth/current', () => ({ currentCtx: async () => ({ sub: 'owner', role: 'super_admin', tenant_id: null }) }))
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q =>
  q.text.startsWith('select role, tenant_id from public.users')
    ? (route.role ? [{ role: route.role, tenant_id: null }] : [])
    : new Error('unexpected statement: ' + q.text)))
vi.mock('@/lib/reports', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/reports')>()),
  buildUniversityReport: (...a: unknown[]) => route.build(...a),
  buildTeacherReport: (...a: unknown[]) => route.build(...a),
  buildGroupReport: (...a: unknown[]) => route.build(...a),
  buildPilotReport: (...a: unknown[]) => route.build(...a),
  buildStudentReport: (...a: unknown[]) => route.build(...a),
}))

describe('GET /api/reports', () => {
  beforeEach(() => { route.build.mockReset(); route.role = 'super_admin'; vi.spyOn(console, 'error').mockImplementation(() => {}) })
  const get = async (format: string, id = ID) => {
    const { GET } = await import('@/app/api/reports/route')
    return GET(new Request(`http://x/api/reports?scope=university&id=${id}&format=${format}`))
  }

  it('a ReportReadError is 503 reportReadFailed, never a partial report (JSON and CSV)', async () => {
    route.build.mockRejectedValue(new ReportReadError('institution: read failed'))
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

  it('the live row decides: an account no longer the owner (or gone) is refused before any report read', async () => {
    route.role = 'university_admin'
    expect((await get('json')).status).toBe(403)
    route.role = null
    expect((await get('json')).status).toBe(403)
    expect(route.build).not.toHaveBeenCalled()
  })

  it('a malformed id reads nothing (404)', async () => {
    expect((await get('json', 'tn')).status).toBe(404)
    expect(route.build).not.toHaveBeenCalled()
  })
})
