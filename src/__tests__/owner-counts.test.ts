// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Batch 2 — Owner Counts, on the SQL layer (step 9). tenantRoleCountsAs reads
 * get_tenant_role_counts() as the owner — one row per institution — and never
 * the users table. Database-side authorization / correctness (applied and
 * verified live 2026-10-01, 12/12): supabase/tests/owner_counts_check.sql.
 */

type Q = { text: string; values: unknown[]; ctx: { as: string; userId?: string } }
const db = vi.hoisted(() => ({ calls: [] as Q[], reply: [] as unknown[] | Error }))
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => {
  db.calls.push(q as Q)
  if (q.text.startsWith('select role from public.users')) return [{ role: 'super_admin' }]
  return db.reply
}))
vi.mock('@/lib/auth/current', () => ({ currentUser: async () => ({ id: 'owner', role: 'super_admin', tenant_id: null }) }))
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error('REDIRECT ' + to) } }))

import { tenantRoleCountsAs } from '@/lib/super-admin-data'

beforeEach(() => { db.calls = []; db.reply = [] })

describe('tenantRoleCountsAs', () => {
  it('one row per institution, bigint strings → numbers, read as the owner, and nothing else is read', async () => {
    db.reply = [{ tenant_id: 'A', admins: '1', teachers: '1', students: '121' }, { tenant_id: 'B', admins: 1, teachers: 1, students: 1 }]
    const r = await tenantRoleCountsAs('owner')
    expect(r).toEqual({ error: false, counts: { A: { admins: 1, teachers: 1, students: 121 }, B: { admins: 1, teachers: 1, students: 1 } } })
    expect(db.calls).toHaveLength(1)
    expect(db.calls[0].text).toBe('select * from public.get_tenant_role_counts()')
    expect(db.calls[0].ctx).toEqual({ as: 'user', userId: 'owner' })
  })

  it('no institution rows → empty counts', async () => {
    db.reply = []
    expect(await tenantRoleCountsAs('owner')).toEqual({ counts: {}, error: false })
  })

  it('any failure → no counts and no read of the users table', async () => {
    db.reply = new Error('nope')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await tenantRoleCountsAs('owner')).toEqual({ counts: {}, error: true })
    expect(db.calls.every(q => !/from public\.users/.test(q.text))).toBe(true)
    errSpy.mockRestore()
  })
})

describe('/super-admin/users page', () => {
  it('passes the function counts to the client and never reads (tenant_id, role) of every user', async () => {
    db.reply = [{ tenant_id: 'A', admins: 2, teachers: 3, students: 4 }]
    vi.resetModules()
    const { default: Page } = await import('@/app/(super-admin)/super-admin/users/page')
    const el = await Page() as { props: { tenantCounts: unknown } }
    expect(el.props.tenantCounts).toEqual({ A: { admins: 2, teachers: 3, students: 4 } })
    expect(db.calls.some(q => q.text === 'select * from public.get_tenant_role_counts()')).toBe(true)
    expect(db.calls.some(q => /tenant_id, role/.test(q.text))).toBe(false)
  })
})
