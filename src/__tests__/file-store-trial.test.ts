// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

// Files (step 11) on the Neon trial: each stored object is recorded in
// public.stored_files as app_service of its institution, the quota sums only
// that institution's rows, and tenant_storage_bytes refuses anyone but the
// institution's own service scope and the platform owner. Objects go to the
// Node fallback store (.local-files/, removed afterwards); on Workers they go
// to R2. Runs with `npm run test:neon`.

const READY = !!(process.env.NEON_GATEWAY_DATABASE_URL && process.env.NEON_DATABASE_URL)
vi.setConfig({ testTimeout: 120_000 })

describe.skipIf(!READY)('file store on the trial', () => {
  const owner = postgres(process.env.NEON_DATABASE_URL ?? 'postgres://unused', { max: 1, prepare: false, onnotice: () => {} })
  const tag = `fs${Date.now()}`
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(5, 'X')
  const ids = { A: '', B: '', teacher: '', boss: '' }
  const PNG = new Uint8Array(2048).fill(7)

  async function person(role: string, tenant: string) {
    const [u] = await owner`insert into ba."user" (name, email, "emailVerified") values (${role}, ${role + Math.random().toString(36).slice(2, 7) + tag + '@fs-test.test'}, true) returning id`
    await owner`update public.users set role = ${role}, tenant_id = ${tenant} where id = ${u.id}`
    return u.id as string
  }

  beforeAll(async () => {
    process.env.FILES_SIGNING_SECRET = 'trial-signing-secret-at-least-32-characters'
    ids.A = (await owner`insert into public.tenants (name, slug, code, storage_limit_mb) values ('FSA', ${tag + 'a'}, ${code()}, 1) returning id`)[0].id
    ids.B = (await owner`insert into public.tenants (name, slug, code) values ('FSB', ${tag + 'b'}, ${code()}) returning id`)[0].id
    ids.teacher = await person('teacher', ids.A)
    ids.boss = await person('super_admin', ids.A)
  }, 120_000)
  afterAll(async () => {
    await owner`delete from ba."user" where email like ${'%' + tag + '%'}`
    await owner`delete from public.tenants where id in (${ids.A}, ${ids.B})`
    await rm(join(process.cwd(), '.local-files', ids.A), { recursive: true, force: true })
    await owner.end()
  }, 120_000)

  it('putFile records the object; the quota counts only this institution; removeFiles takes the row away', async () => {
    const { putFile, removeFiles, checkStorageQuotaAs } = await import('@/lib/file-store')
    const key = `${ids.A}/tasks/${ids.teacher}/${crypto.randomUUID()}.png`
    await putFile(ids.A, key, PNG, 'image/png')
    const [row] = await owner`select tenant_id, bytes from public.stored_files where key = ${key}`
    expect(row.tenant_id).toBe(ids.A)
    expect(Number(row.bytes)).toBe(2048) // bigint arrives as a string on this connection

    const q = await checkStorageQuotaAs(ids.A, 1024)
    expect(q).toMatchObject({ limitBytes: 1024 * 1024, usedBytes: 2048, allowed: true })
    expect((await checkStorageQuotaAs(ids.A, 1024 * 1024)).allowed).toBe(false)
    expect((await checkStorageQuotaAs(ids.B, 10)).allowed).toBe(true) // no cap

    await removeFiles(ids.A, [key])
    expect(await owner`select 1 from public.stored_files where key = ${key}`).toHaveLength(0)
  })

  it('the service scope of another institution cannot write or read this institution\'s rows', async () => {
    const { run } = await import('@/lib/db/sql')
    await expect(run({ as: 'service', tenantId: ids.B }, sql => [
      sql`insert into public.stored_files (key, tenant_id, bytes, content_type) values (${ids.A + '/x'}, ${ids.A}, 1, 'image/png')`,
    ])).rejects.toThrow(/row-level security/)
    await expect(run({ as: 'service', tenantId: ids.B }, sql => [sql`select public.tenant_storage_bytes(${ids.A}) as n`]))
      .rejects.toThrow(/FORBIDDEN/)
  })

  it('tenant_storage_bytes: the platform owner may read it; a teacher may not', async () => {
    const { run } = await import('@/lib/db/sql')
    const [rows] = await run({ as: 'user', userId: ids.boss }, sql => [sql`select public.tenant_storage_bytes(${ids.A}) as n`])
    expect(Number((rows[0] as { n: unknown }).n)).toBeGreaterThanOrEqual(0)
    await expect(run({ as: 'user', userId: ids.teacher }, sql => [sql`select public.tenant_storage_bytes(${ids.A}) as n`]))
      .rejects.toThrow(/FORBIDDEN/)
    await expect(run({ as: 'user', userId: ids.teacher }, sql => [sql`select count(*) from public.stored_files`]))
      .rejects.toThrow(/permission denied/)
  })
})
