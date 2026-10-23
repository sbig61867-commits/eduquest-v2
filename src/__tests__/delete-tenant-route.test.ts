import { beforeEach, describe, expect, it, vi } from 'vitest'

// DELETE /api/admin/delete-tenant (B), on the SQL layer: every account is
// removed and then the institution, and a list that cannot be read completely
// deletes nothing at all.

const TENANT = '11111111-2222-3333-4444-555555555555'
const env = vi.hoisted(() => ({
  role: 'super_admin' as string,
  members: [] as { id: string }[],
  failListing: false,
  removed: [] as string[],
  statements: [] as { as: string; text: string }[],
}))

vi.mock('@/lib/auth', () => ({ getSessionUser: async () => ({ id: 'owner-id' }) }))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ allowed: true, remaining: 1, resetAt: 0 }) }))
vi.mock('@/lib/auth/better', () => ({
  authRemoveUser: async (id: string) => { env.removed.push(id); return { error: null } },
}))
vi.mock('@/lib/db/sql', () => ({
  maybeOne: (rows: unknown[]) => rows[0] ?? null,
  run: async (ctx: { as: string }, build: (sql: unknown) => { text: string }[]) => {
    const tag = (strings: TemplateStringsArray) => ({ text: strings.join('$') })
    const qs = build(tag)
    if (env.failListing && qs.some(q => q.text.includes('from public.users where tenant_id'))) throw new Error('connection lost')
    return qs.map(q => {
      env.statements.push({ as: ctx.as, text: q.text })
      if (q.text.startsWith('select role')) return [{ role: env.role }]
      if (q.text.includes('from public.users where tenant_id')) return env.members
      return []
    })
  },
}))

const del = async () => (await import('@/app/api/admin/delete-tenant/route')).DELETE(
  new Request(`http://x/api/admin/delete-tenant?id=${TENANT}`, { method: 'DELETE' }))

beforeEach(() => {
  env.role = 'super_admin'; env.failListing = false
  env.members = Array.from({ length: 1500 }, (_, k) => ({ id: `u-${k}` }))
  env.removed = []; env.statements = []
})

describe('DELETE /api/admin/delete-tenant (B)', () => {
  it('an institution of 1 500 users: every account is removed, then the institution', async () => {
    const res = await del()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, usersDeleted: 1500, failed: 0 })
    expect(new Set(env.removed).size).toBe(1500)
    const writes = env.statements.filter(s => s.text.startsWith('delete')).map(s => s.text.split(' where')[0])
    expect(writes).toEqual(['delete from public.invitations', 'delete from public.tenants'])
  })

  it('the deletes run in platform scope, the role check as the caller', async () => {
    await del()
    expect(env.statements.find(s => s.text.startsWith('select role'))?.as).toBe('user')
    expect(env.statements.filter(s => s.text.startsWith('delete')).every(s => s.as === 'service')).toBe(true)
  })

  it('the user list cannot be read: 500, and NOTHING is deleted', async () => {
    env.failListing = true
    const res = await del()
    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe('tenantUsersReadFailed')
    expect(env.removed).toEqual([])
    expect(env.statements.filter(s => s.text.startsWith('delete'))).toEqual([])
  })

  it('anyone but the owner is refused before anything happens', async () => {
    env.role = 'university_admin'
    const res = await del()
    expect(res.status).toBe(403)
    expect(env.removed).toEqual([])
  })
})
