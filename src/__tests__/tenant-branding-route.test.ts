import { beforeEach, describe, expect, it, vi } from 'vitest'

// PATCH /api/admin/tenant-branding — the institution admin's profile of their
// institution: name, logo, and (2026-10-17) its default language. Only these
// columns, only the caller's own institution, never is_active.

const state = vi.hoisted(() => ({
  me: { id: 'a1' } as { id: string } | null,
  profile: { role: 'university_admin', tenant_id: 'T1' } as { role: string; tenant_id: string | null } | null,
  writes: [] as { update: Record<string, unknown>; id: string }[],
}))

vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.me } }) },
    from: () => { const q = { select: () => q, eq: () => q, single: async () => ({ data: state.profile }) }; return q },
  }),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const w = { update: {} as Record<string, unknown>, id: '' }
      const q = {
        update: (u: Record<string, unknown>) => { w.update = u; return q },
        eq: (_c: string, v: string) => { w.id = v; return q },
        select: () => q,
        single: async () => { state.writes.push(w); return { data: { id: w.id, ...w.update }, error: null } },
      }
      return q
    },
  }),
}))

const { PATCH } = await import('@/app/api/admin/tenant-branding/route')
const call = (body: unknown) => PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }))

beforeEach(() => {
  state.me = { id: 'a1' }
  state.profile = { role: 'university_admin', tenant_id: 'T1' }
  state.writes = []
})

describe('PATCH /api/admin/tenant-branding', () => {
  it('saves the default language with the name and logo, on the caller\'s own institution', async () => {
    const res = await call({ name: 'Horizon', logo_url: '', default_locale: 'en' })
    expect(res.status).toBe(200)
    expect(state.writes).toEqual([{ id: 'T1', update: { name: 'Horizon', logo_url: null, default_locale: 'en' } }])
  })

  it('leaves the language alone when it is not sent (older clients)', async () => {
    await call({ name: 'Horizon', logo_url: '' })
    expect(state.writes[0].update).toEqual({ name: 'Horizon', logo_url: null })
  })

  it('refuses an unsupported language and writes nothing', async () => {
    const res = await call({ name: 'Horizon', logo_url: '', default_locale: 'fr' })
    expect(res.status).toBe(400)
    expect(state.writes).toEqual([])
  })

  it('never writes is_active or another institution, whatever the body says', async () => {
    await call({ name: 'Horizon', logo_url: '', default_locale: 'ar', is_active: true, tenant_id: 'T2', id: 'T2' })
    expect(state.writes).toEqual([{ id: 'T1', update: { name: 'Horizon', logo_url: null, default_locale: 'ar' } }])
  })

  it('only an institution admin', async () => {
    state.profile = { role: 'center_manager', tenant_id: 'T1' }
    expect((await call({ name: 'X', default_locale: 'en' })).status).toBe(403)
    state.me = null
    expect((await call({ name: 'X' })).status).toBe(401)
    expect(state.writes).toEqual([])
  })
})
