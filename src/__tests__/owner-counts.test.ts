// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Batch 2 — Owner Counts. loadTenantRoleCounts (src/lib/data/tenant-counts.ts)
 * reads get_tenant_role_counts() — one row per institution — and never the
 * users table. Database-side authorization / correctness (applied and verified
 * live 2026-10-01, 12/12): supabase/tests/owner_counts_check.sql.
 */

type Rpc = { data?: unknown; error?: { code?: string; message: string } | null }
let rpcReply: Rpc
let calls: string[]

function db() {
  return {
    rpc: async (name: string) => { calls.push(`rpc:${name}`); return { data: null, error: null, ...rpcReply } },
    from: (table: string) => {
      calls.push(`from:${table}`)
      const ch: Record<string, unknown> = {}
      for (const m of ['select', 'neq', 'eq', 'order']) ch[m] = (...a: unknown[]) => { calls.push(`${m}:${a.join('|')}`); return ch }
      ch.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r)
      return ch
    },
  }
}

import { loadTenantRoleCounts } from '@/lib/data/tenant-counts'

beforeEach(() => { calls = []; rpcReply = {} })

describe('loadTenantRoleCounts', () => {
  it('one row per institution, bigint strings → numbers, and nothing else is read', async () => {
    rpcReply = { data: [{ tenant_id: 'A', admins: '1', teachers: '1', students: '121' }, { tenant_id: 'B', admins: 1, teachers: 1, students: 1 }] }
    const r = await loadTenantRoleCounts(db() as never)
    expect(r).toEqual({ error: false, counts: { A: { admins: 1, teachers: 1, students: 121 }, B: { admins: 1, teachers: 1, students: 1 } } })
    expect(calls).toEqual(['rpc:get_tenant_role_counts'])
  })

  it('no institution rows → empty counts', async () => {
    rpcReply = { data: [] }
    expect(await loadTenantRoleCounts(db() as never)).toEqual({ counts: {}, error: false })
  })

  it.each(['42501', 'PGRST202', '42883', 'XX000', undefined])('any error (%s) → no counts and NO read of the users table', async code => {
    rpcReply = { error: { code, message: 'nope' } }
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await loadTenantRoleCounts(db() as never)).toEqual({ counts: {}, error: true })
    expect(calls).toEqual(['rpc:get_tenant_role_counts'])
    errSpy.mockRestore()
  })
})

describe('/super-admin/users page', () => {
  it('passes the function counts to the client and never reads (tenant_id, role) of every user', async () => {
    rpcReply = { data: [{ tenant_id: 'A', admins: 2, teachers: 3, students: 4 }] }
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => db(),
      getAuthUser: async () => ({ id: 'owner', role: 'super_admin' }),
    }))
    vi.doMock('next/navigation', () => ({ redirect: (to: string) => { throw new Error('REDIRECT ' + to) } }))
    vi.resetModules()
    const { default: Page } = await import('@/app/(super-admin)/super-admin/users/page')
    const el = await Page() as { props: { tenantCounts: unknown } }
    expect(el.props.tenantCounts).toEqual({ A: { admins: 2, teachers: 3, students: 4 } })
    expect(calls).toContain('rpc:get_tenant_role_counts')
    expect(calls).not.toContain('select:tenant_id, role')
  })
})
