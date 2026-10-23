// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { run, transaction, one, maybeOne, NotFoundError, dbStats } from '@/lib/db/sql'

// Step 9.2: the SQL access layer. The pure helpers always run. The integration
// part runs against the Neon trial when both connection strings are set
// (NEON_GATEWAY_DATABASE_URL = app_gateway, NEON_DATABASE_URL = owner, used
// only to seed and clean up) and is skipped otherwise.

describe('one / maybeOne', () => {
  it('one returns the single row, throws NotFoundError on none and an error on many', () => {
    expect(one([{ a: 1 }])).toEqual({ a: 1 })
    expect(() => one([])).toThrow(NotFoundError)
    expect(() => one([{ a: 1 }, { a: 2 }])).toThrow(/expected one row/)
  })
  it('maybeOne returns null on none and throws on many', () => {
    expect(maybeOne([])).toBeNull()
    expect(maybeOne([{ a: 1 }])).toEqual({ a: 1 })
    expect(() => maybeOne([{ a: 1 }, { a: 2 }])).toThrow(/at most one/)
  })
})

describe('context validation', () => {
  it('refuses a user or service context without a valid id', async () => {
    await expect(run({ as: 'user', userId: 'x' }, sql => [sql`select 1`])).rejects.toThrow(/user id|not configured/)
    await expect(run({ as: 'service', tenantId: "'; drop" }, sql => [sql`select 1`])).rejects.toThrow(/institution id|not configured/)
  })
})

const GATEWAY = process.env.NEON_GATEWAY_DATABASE_URL
const OWNER = process.env.NEON_DATABASE_URL

describe.skipIf(!GATEWAY || !OWNER)('SQL layer on the Neon trial', () => {
  const owner = postgres(OWNER ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const ids = { A: '', B: '', tA: '', tB: '', gA: '', gB: '' }
  // institution codes are unique: a random one per run
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const tag = `dbsql${Date.now()}`

  beforeAll(async () => {
    const [A] = await owner`insert into public.tenants (name, slug, code) values ('DA', ${tag + 'a'}, ${code()}) returning id`
    const [B] = await owner`insert into public.tenants (name, slug, code) values ('DB', ${tag + 'b'}, ${code()}) returning id`
    const mk = async (t: string) => (await owner`insert into ba."user" (id, name, email, "emailVerified") values (gen_random_uuid(), ${t}, ${t + tag + '@dbsql.test'}, true) returning id`)[0].id as string
    ids.A = A.id; ids.B = B.id
    ids.tA = await mk('ta'); ids.tB = await mk('tb')
    await owner`update public.users set role='teacher', tenant_id=${ids.A} where id=${ids.tA}`
    await owner`update public.users set role='teacher', tenant_id=${ids.B} where id=${ids.tB}`
    ids.gA = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.A}, ${ids.tA}, 'GA') returning id`)[0].id
    ids.gB = (await owner`insert into public.groups (tenant_id, teacher_id, name) values (${ids.B}, ${ids.tB}, 'GB') returning id`)[0].id
  }, 60_000)

  afterAll(async () => {
    await owner`delete from public.groups where tenant_id in (${ids.A}, ${ids.B})`
    await owner`delete from ba."user" where email like ${'%' + tag + '@dbsql.test'}`
    await owner`delete from public.tenants where id in (${ids.A}, ${ids.B})`
    await owner.end()
  }, 60_000)

  it('a user unit sees only its own institution', async () => {
    const [rows] = await run({ as: 'user', userId: ids.tA }, sql => [sql`select name from public.groups order by name`])
    expect(rows.map(r => r.name)).toEqual(['GA'])
  }, 30_000)

  it('several independent statements come back in order from one unit', async () => {
    const before = dbStats.statements
    const [g, me, n] = await run({ as: 'user', userId: ids.tB }, sql => [
      sql`select name from public.groups`,
      sql`select role from public.users where id = ${ids.tB}`,
      sql`select count(*)::int n from public.users`,
    ])
    expect(g.map(r => r.name)).toEqual(['GB'])
    expect(one<{ role: string }>(me).role).toBe('teacher')
    expect(one<{ n: number }>(n).n).toBeGreaterThan(0)
    expect(dbStats.statements - before).toBe(3)
  }, 30_000)

  it('a service unit pinned to A cannot touch B', async () => {
    const [read, upd] = await run({ as: 'service', tenantId: ids.A }, sql => [
      sql`select name from public.groups order by name`,
      sql`update public.groups set name = 'evil' where id = ${ids.gB} returning id`,
    ])
    expect(read.map(r => r.name)).toEqual(['GA'])
    expect(upd).toHaveLength(0)
    await expect(run({ as: 'service', tenantId: ids.A }, sql => [sql`update public.groups set tenant_id = ${ids.B} where id = ${ids.gA}`]))
      .rejects.toThrow(/row-level security/)
  }, 30_000)

  it('a failing statement rolls back the whole unit', async () => {
    await expect(run({ as: 'service', tenantId: ids.A }, sql => [
      sql`update public.groups set name = 'renamed' where id = ${ids.gA}`,
      sql`select 1/0`,
    ])).rejects.toThrow(/division by zero/)
    const [[g]] = await owner`select name from public.groups where id = ${ids.gA}`.then(r => [r])
    expect(g.name).toBe('GA')
  }, 30_000)

  it('transaction() runs dependent steps as one unit', async () => {
    const name = await transaction({ as: 'service', tenantId: ids.A }, async tx => {
      const [g] = await tx`select name from public.groups where id = ${ids.gA}`
      const [u] = await tx`update public.groups set name = ${g.name + '2'} where id = ${ids.gA} returning name`
      return u.name as string
    })
    expect(name).toBe('GA2')
    await owner`update public.groups set name = 'GA' where id = ${ids.gA}`
  }, 30_000)

  it('nothing is left on the pooled connections after the units', async () => {
    // more units than the pool size, then read the settings on each connection
    await Promise.all(Array.from({ length: 12 }, (_, i) => run({ as: 'user', userId: i % 2 ? ids.tA : ids.tB }, sql => [sql`select 1`])))
    const gw = postgres(GATEWAY ?? '', { max: 1, onnotice: () => {} })
    const [s] = await gw`select current_user::text u, coalesce(current_setting('request.jwt.claims', true), '') c`
    await gw.end()
    expect(s).toEqual({ u: 'app_gateway', c: '' })
    const results = await Promise.all(Array.from({ length: 12 }, () => run({ as: 'system' }, sql => [sql`select current_user::text u, coalesce(current_setting('request.jwt.claims', true), '') c, coalesce(current_setting('app.tenant_id', true), '') t`])))
    for (const [[r]] of results) expect(r).toEqual({ u: 'app_system', c: '', t: '' })
  }, 60_000)

  it('more units than connections all complete, each with its own identity', async () => {
    // postgres.js reserve() left 71 of 72 units waiting under this kind of load
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => {
      const uid = i % 2 ? ids.tA : ids.tB
      return run({ as: 'user', userId: uid }, sql => [sql`select auth.uid()::text uid, ${i}::int n`]).then(([[r]]) => ({ r, uid, i }))
    }))
    for (const { r, uid, i } of results) expect(r).toEqual({ uid, n: i })
  }, 120_000)

  it('keeps the PostgREST shapes: ISO timestamps and numeric as numbers', async () => {
    const [[r]] = await run({ as: 'user', userId: ids.tA }, sql => [sql`select now() ts, 12.5::numeric n, 7::bigint b, current_date d`])
    expect(r.ts).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?\+00:00$/)
    expect(r.n).toBe(12.5)
    expect(r.b).toBe(7)
    expect(typeof r.d === 'string' || r.d instanceof Date).toBe(true)
  }, 30_000)
})
