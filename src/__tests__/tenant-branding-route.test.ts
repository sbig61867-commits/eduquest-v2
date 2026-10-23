// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// PATCH /api/admin/tenant-branding — the institution admin's profile of their
// institution: name, logo, and (2026-10-17) its default language. Only these
// columns, only the caller's own LIVE institution, never is_active.

const state = vi.hoisted(() => ({
  ctx: { sub: 'a1', role: 'university_admin', tenant_id: 'T1' } as { sub: string; role: string; tenant_id: string | null } | null,
  writes: [] as { text: string; values: unknown[]; ctx: unknown }[],
}))

vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/auth/current', () => ({
  currentCtx: async () => (state.ctx ? { ...state.ctx, email: null, is_active: true, must_change_password: false } : null),
}))
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => {
  state.writes.push(q)
  return [{ id: 'T1', name: q.values[1], logo_url: q.values[2], default_locale: q.values[3] ?? 'ar' }]
}))

const { PATCH } = await import('@/app/api/admin/tenant-branding/route')
const call = (body: unknown) => PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }))

beforeEach(() => {
  state.ctx = { sub: 'a1', role: 'university_admin', tenant_id: 'T1' }
  state.writes = []
})

describe('PATCH /api/admin/tenant-branding', () => {
  it('saves the default language with the name and logo, on the caller\'s own institution', async () => {
    const res = await call({ name: 'Horizon', logo_url: '', default_locale: 'en' })
    expect(res.status).toBe(200)
    expect(state.writes).toHaveLength(1)
    const [w] = state.writes
    expect(w.ctx).toEqual({ as: 'service', tenantId: 'T1' })
    // the institution is the caller's own live row, never a value from the body
    expect(w.text).toContain("where id = $ and role = 'university_admin' and is_active is not false")
    expect(w.text).toContain('where t.id = me.tenant_id')
    expect(w.values).toEqual(['a1', 'Horizon', null, 'en'])
  })

  it('leaves the language alone when it is not sent (older clients)', async () => {
    await call({ name: 'Horizon', logo_url: '' })
    expect(state.writes[0].values).toEqual(['a1', 'Horizon', null, null])
    expect(state.writes[0].text).toContain('default_locale = coalesce($::text, t.default_locale)')
  })

  it('refuses an unsupported language and writes nothing', async () => {
    const res = await call({ name: 'Horizon', logo_url: '', default_locale: 'fr' })
    expect(res.status).toBe(400)
    expect(state.writes).toEqual([])
  })

  it('never writes is_active or another institution, whatever the body says', async () => {
    await call({ name: 'Horizon', logo_url: '', default_locale: 'ar', is_active: true, tenant_id: 'T2', id: 'T2' })
    const [w] = state.writes
    expect(w.values).toEqual(['a1', 'Horizon', null, 'ar'])
    expect(w.text).not.toContain('is_active =')
    expect(JSON.stringify(w)).not.toContain('T2')
  })

  it('only an institution admin', async () => {
    state.ctx = { sub: 'a1', role: 'center_manager', tenant_id: 'T1' }
    expect((await call({ name: 'X', default_locale: 'en' })).status).toBe(403)
    state.ctx = null
    expect((await call({ name: 'X' })).status).toBe(401)
    expect(state.writes).toEqual([])
  })
})
