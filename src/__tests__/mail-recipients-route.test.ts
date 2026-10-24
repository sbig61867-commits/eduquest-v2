// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Batch 2 — Centre Mail. /api/mail/recipients (search + count preview),
 * /api/mail/send with group_ids, resolveMailRecipients and the page. Gmail is
 * mocked: NO email is ever sent by this file. The same gate (getMailCaller),
 * the 50-per-request limit, the daily cap and the mail_messages log are
 * checked on the resolved set. Step 9: the routes run on the SQL layer; every
 * statement is answered here from one simulated institution.
 */

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const G1 = '11111111-1111-4111-8111-111111111111'
const G2 = '22222222-2222-4222-8222-222222222222'
const FOREIGN = '99999999-9999-4999-8999-999999999999'

type Q = { text: string; values: unknown[]; ctx: { as: string; userId?: string; tenantId?: string } }
let calls: Q[]
let caller: { role: string; permissions: Record<string, unknown> | null } | null
let groupsInTenant: string[]
let membersByGroup: Record<string, string[]>
let activeStudents: Set<string>
let sentToday: number
let searchRows: unknown[]
let logged: unknown[]
let centerGroups: unknown[] = []
let gmail: ReturnType<typeof vi.fn<(...a: unknown[]) => Promise<{ ok: boolean; error?: string }>>>

// Student ids are UUIDs, as in the database (the send route only looks up UUIDs).
const stu = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`

function answer(q: Q): unknown[] {
  calls.push(q)
  const t = q.text
  if (t.startsWith('select id from public.groups')) {
    const ids = q.values[1] as string[]
    return ids.filter(id => groupsInTenant.includes(id)).map(id => ({ id }))
  }
  if (t.startsWith('select gs.student_id from public.group_students')) {
    const ids = q.values[1] as string[]
    const rows = ids.filter(g => groupsInTenant.includes(g))
      .flatMap(g => (membersByGroup[g] ?? []).filter(s => activeStudents.has(s)).map(s => ({ student_id: s })))
    return rows.slice(0, q.values[3] as number)
  }
  if (t.startsWith('select count(*)::int as n from public.mail_messages')) return [{ n: sentToday }]
  if (t.startsWith('select id, user_id, tenant_id, email')) return [{ id: 'conn', email: 'me@inst.edu', status: 'active', tenant_id: TENANT }]
  if (t.startsWith('select id, email, full_name from public.users')) {
    const ids = q.values[1] as string[]
    return ids.filter(i => activeStudents.has(i)).map(i => ({ id: i, email: `${i}@x.edu`, full_name: i }))
  }
  if (t.startsWith('select full_name from public.users')) return [{ full_name: 'Sender' }]
  if (t.startsWith('select id, full_name, email from public.users')) return searchRows.slice(0, q.values.at(-1) as number)
  if (t.startsWith('insert into public.mail_messages')) { logged.push(q.values[0]); return [] }
  if (t.startsWith('select c.id, c.name')) return centerGroups
  throw new Error('unexpected statement: ' + t)
}

vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => answer(q as Q)))
vi.mock('@/lib/staff-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/staff-auth')>('@/lib/staff-auth')
  return {
    ...actual,
    getCaller: async () => (caller
      ? { caller: { id: 'me', role: caller.role, tenant_id: TENANT, permissions: caller.permissions } }
      : { error: new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }) }),
  }
})
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string) => ({ error: code, code }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ allowed: true }) }))
vi.mock('@/lib/mail/google', () => ({
  buildMime: () => 'mime',
  getAccessToken: async () => 'token',
  sendGmail: (...a: unknown[]) => gmail(...a),
}))

import { resolveMailRecipients, MAX_RECIPIENTS } from '@/lib/mail/recipients'
import { GET as searchGET, POST as previewPOST } from '@/app/api/mail/recipients/route'
import { POST as sendPOST } from '@/app/api/mail/send/route'

const post = (fn: (r: Request) => Promise<Response>, body: unknown) =>
  fn(new Request('http://x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
const send = (body: Record<string, unknown>) => post(sendPOST, { subject: 'Hello', body: 'Text', ...body })
const reads = (prefix: string) => calls.filter(c => c.text.startsWith(prefix))

beforeEach(() => {
  calls = []
  logged = []
  caller = { role: 'center_manager', permissions: { manage_students: true } }
  groupsInTenant = [G1, G2]
  membersByGroup = { [G1]: [stu(1), stu(2), stu(3), stu(4)], [G2]: [stu(3), stu(5)], [FOREIGN]: [stu(900)] }
  activeStudents = new Set([stu(1), stu(2), stu(3), stu(5), stu(7), stu(900)])          // s004 is disabled
  sentToday = 0
  searchRows = []
  gmail = vi.fn(async () => ({ ok: true }))
})

describe('resolveMailRecipients', () => {
  it('no groups → the picked ids untouched, no query', async () => {
    expect(await resolveMailRecipients(TENANT, ['a', 'b'], [])).toEqual({ ok: true, ids: ['a', 'b'] })
    expect(calls).toHaveLength(0)
  })

  it('groups: live ACTIVE groups of THIS institution, then their ACTIVE STUDENTS of THIS institution, bounded — one unit', async () => {
    const r = await resolveMailRecipients(TENANT, [stu(7)], [G1, G2])
    expect(r).toEqual({ ok: true, ids: [stu(7), stu(1), stu(2), stu(3), stu(5)] })   // de-duplicated, s004 (disabled) out
    const [g, m] = calls
    expect(g.ctx).toEqual({ as: 'service', tenantId: TENANT })
    expect(g.text).toContain('where tenant_id = $ and is_active and deleted_at is null')
    expect(m.text).toContain("u.tenant_id = $ and u.role = 'student' and u.is_active")
    expect(m.text).toContain('g.tenant_id = $ and g.is_active and g.deleted_at is null')
    expect(m.values.at(-1)).toBe(MAX_RECIPIENTS * 50 + 1)
  })

  it('a group of another institution (or disabled / archived — not returned) → groupNotFound', async () => {
    expect(await resolveMailRecipients(TENANT, [], [G1, FOREIGN])).toEqual({ ok: false, error: 'groupNotFound' })
  })

  it('malformed or too many group ids → invalidData, no query', async () => {
    expect(await resolveMailRecipients(TENANT, [], ['nope'])).toEqual({ ok: false, error: 'invalidData' })
    const many = Array.from({ length: 51 }, (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`)
    expect(await resolveMailRecipients(TENANT, [], many)).toEqual({ ok: false, error: 'invalidData' })
    expect(calls).toHaveLength(0)
  })
})

describe('GET /api/mail/recipients (search)', () => {
  it('the mail gate: signed out 401; teacher / student / centre manager without manage_students 403 — nothing read', async () => {
    caller = null
    expect((await searchGET(new Request('http://x?q=a'))).status).toBe(401)
    for (const c of [{ role: 'teacher', permissions: {} }, { role: 'student', permissions: {} }, { role: 'center_manager', permissions: {} }, { role: 'super_admin', permissions: {} }]) {
      caller = c
      expect((await searchGET(new Request('http://x?q=a'))).status).toBe(403)
    }
    expect(calls).toHaveLength(0)
  })

  it('empty / wildcard-only query → 400, nothing read', async () => {
    for (const q of ['', '%25*', '%20%20']) expect((await searchGET(new Request(`http://x?q=${q}`))).status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('≤ 20 ACTIVE students of the caller institution, name or email, id + name + email only, read as the caller (RLS)', async () => {
    caller = { role: 'university_admin', permissions: null }             // default ON
    searchRows = Array.from({ length: 25 }, (_, i) => ({ id: stu(i), full_name: `S ${i}`, email: `${stu(i)}@x.edu` }))
    const res = await searchGET(new Request('http://x?q=gmail.com'))
    expect(res.status).toBe(200)
    const { students } = await res.json()
    expect(students).toHaveLength(20)
    expect(students[0]).toEqual({ id: stu(0), name: 'S 0', email: `${stu(0)}@x.edu` })
    const [q] = calls
    expect(q.ctx).toEqual({ as: 'user', userId: 'me' })
    expect(q.text).toContain("where tenant_id = $ and role = 'student' and is_active")
    expect(q.values).toEqual([TENANT, '%gmail.com%', '%gmail.com%', 20])
  })
})

describe('POST /api/mail/recipients (count preview)', () => {
  it('returns ONLY a number — the de-duplicated active students the send will reach; sends and logs nothing', async () => {
    const res = await post(previewPOST, { recipient_ids: [stu(7), stu(1)], group_ids: [G1] })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 4 })            // s007 + s001, s002, s003
    expect(gmail).not.toHaveBeenCalled()
    expect(logged).toHaveLength(0)
  })

  it('a foreign group → 404; a malformed group id → 400; gate as the send', async () => {
    expect((await post(previewPOST, { group_ids: [FOREIGN] })).status).toBe(404)
    expect((await post(previewPOST, { group_ids: ['x'] })).status).toBe(400)
    caller = { role: 'teacher', permissions: {} }
    expect((await post(previewPOST, { group_ids: [G1] })).status).toBe(403)
  })
})

describe('POST /api/mail/send with group_ids (Gmail mocked — nothing is sent)', () => {
  it('sends to the resolved, de-duplicated set and logs every attempt in mail_messages', async () => {
    const res = await send({ recipient_ids: [stu(3)], group_ids: [G1, G2] })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sent: 4, failed: 0, skipped: 0 })            // s001 s002 s003 s005
    expect(gmail).toHaveBeenCalledTimes(4)
    const log = logged[0] as { recipient_id: string; tenant_id: string; status: string }[]
    expect(log.map(l => l.recipient_id).sort()).toEqual([stu(1), stu(2), stu(3), stu(5)])
    expect(log.every(l => l.tenant_id === TENANT && l.status === 'sent')).toBe(true)
  })

  it('a group over the limit is refused exactly as before (400 tooManyRecipients) — nothing sent or logged', async () => {
    membersByGroup[G1] = Array.from({ length: 51 }, (_, i) => stu(100 + i))
    membersByGroup[G1].forEach(s => activeStudents.add(s))
    const res = await send({ group_ids: [G1] })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('tooManyRecipients')
    expect(gmail).not.toHaveBeenCalled()
    expect(logged).toHaveLength(0)
  })

  it('exactly 50 after de-duplication is allowed', async () => {
    membersByGroup[G1] = Array.from({ length: 50 }, (_, i) => stu(100 + i))
    membersByGroup[G1].forEach(s => activeStudents.add(s))
    const res = await send({ recipient_ids: [stu(100), stu(101)], group_ids: [G1] })
    expect(res.status).toBe(200)
    expect(gmail).toHaveBeenCalledTimes(50)
  })

  it('the daily cap counts the resolved set', async () => {
    sentToday = 298
    const res = await send({ group_ids: [G1] })                              // 3 active students > 2 left
    expect(res.status).toBe(429)
    expect(gmail).not.toHaveBeenCalled()
  })

  it('a group of another institution → 404, nothing sent; neither ids nor groups → 400', async () => {
    expect((await send({ group_ids: [FOREIGN] })).status).toBe(404)
    expect((await send({})).status).toBe(400)
    expect(gmail).not.toHaveBeenCalled()
  })

  it('a group whose members are all disabled → 400 noValidRecipients, nothing sent', async () => {
    membersByGroup[G2] = [stu(4)]
    const res = await send({ group_ids: [G2] })
    expect(res.status).toBe(400)
    expect(gmail).not.toHaveBeenCalled()
  })

  it('without the capability → 403 before anything is resolved', async () => {
    caller = { role: 'center_manager', permissions: {} }
    expect((await send({ group_ids: [G1] })).status).toBe(403)
    expect(calls).toHaveLength(0)
  })

  it('the old body (recipient_ids only) still works unchanged', async () => {
    const res = await send({ recipient_ids: [stu(1), stu(4)] })              // s004 disabled → skipped
    expect(await res.json()).toEqual({ sent: 1, failed: 0, skipped: 1 })
    expect(reads('select id from public.groups').length + reads('select gs.student_id').length).toBe(0)
  })

  it('the daily count, mailbox, recipients and sender name come in one unit, scoped to the institution', async () => {
    await send({ recipient_ids: [stu(1)] })
    const unit = calls.filter(c => !c.text.startsWith('insert'))
    expect(unit).toHaveLength(4)
    expect(unit.every(c => c.ctx.as === 'service' && c.ctx.tenantId === TENANT)).toBe(true)
  })
})

describe('/center/mail page', () => {
  it('reads only the active groups with a member COUNT — no students, no member ids', async () => {
    vi.doMock('@/lib/center-access', () => ({ loadCenterAccess: async () => ({ userId: 'me', tenantId: TENANT, has: () => true }) }))
    centerGroups = [{ id: G1, name: 'G', group_students: [{ count: 19 }] }]
    vi.resetModules()
    const { default: Page } = await import('@/app/(center)/center/mail/page')
    const el = await Page() as { props: { groups: unknown } }
    expect(el.props).toEqual({ groups: [{ id: G1, name: 'G', member_count: 19 }] })
    const page = calls.filter(q => q.text.startsWith('select c.id, c.name'))
    expect(page).toHaveLength(1)
    expect(page[0].text).not.toMatch(/group_students\.\*|public\.group_students s where s\.group_id = c\.id\)\)\s*as\s*members/)
    expect(page[0].text).toContain('where c.tenant_id')
    vi.doUnmock('@/lib/center-access')
  })
})
