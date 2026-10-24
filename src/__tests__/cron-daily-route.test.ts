// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/cron/daily (step 12): the Cron Trigger's job route. Only the
// CRON_SECRET bearer opens it; the cleanup runs as app_system, one statement.

type Q = { text: string; values: unknown[]; ctx: { as: string } }
const db = vi.hoisted(() => ({ calls: [] as Q[], reply: [{ deleted: 3 }] as unknown[] | Error }))
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => { db.calls.push(q as Q); return db.reply }))

import { POST } from '@/app/api/cron/daily/route'

const SECRET = 'a-long-enough-cron-secret'
const call = (auth?: string) => POST(new Request('http://x/api/cron/daily', { method: 'POST', headers: auth ? { authorization: auth } : {} }))

beforeEach(() => { db.calls = []; db.reply = [{ deleted: 3 }]; process.env.CRON_SECRET = SECRET })

describe('POST /api/cron/daily', () => {
  it('refuses without the secret, with a wrong one, and when the secret is not configured — nothing runs', async () => {
    expect((await call()).status).toBe(401)
    expect((await call('Bearer wrong-secret-of-same-size!')).status).toBe(401)
    process.env.CRON_SECRET = 'short'
    expect((await call('Bearer short')).status).toBe(401)
    expect(db.calls).toHaveLength(0)
  })

  it('with the secret: one statement as app_system, and the count in the answer', async () => {
    const res = await call(`Bearer ${SECRET}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, expiredInvitationsDeleted: 3 })
    expect(db.calls).toEqual([{ text: 'select public.cleanup_expired_invitations() as deleted', values: [], ctx: { as: 'system' } }])
  })

  it('a database failure is a 500, not a silent success', async () => {
    db.reply = new Error('boom')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await call(`Bearer ${SECRET}`)).status).toBe(500)
  })
})
