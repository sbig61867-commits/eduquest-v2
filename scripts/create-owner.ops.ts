// Step 15 (docs/claude/MIGRATION_EXECUTION.md): the platform owner on the clean
// Neon database. Creates the sign-in account with Better Auth (the same code
// path as the app, so the password hash is what sign-in expects), then makes
// its public.users row the active super_admin with no institution.
//
// The password is read from OWNER_PASSWORD in the environment and never
// printed or stored anywhere else. Re-running is safe: an existing account is
// kept (its password is NOT changed) and only its role / flags are ensured.
//
//   OWNER_EMAIL (default sbig61867@gmail.com), OWNER_NAME (default "Platform Owner")
import { it, expect } from 'vitest'
import postgres from 'postgres'
import { authCreateUser } from '@/lib/auth/better'

const email = (process.env.OWNER_EMAIL ?? 'sbig61867@gmail.com').trim().toLowerCase()
const name = process.env.OWNER_NAME ?? 'Platform Owner'

it('creates (or confirms) the platform owner', async () => {
  const password = process.env.OWNER_PASSWORD ?? ''
  expect(password.length, 'set OWNER_PASSWORD (at least 8 characters) in the environment').toBeGreaterThanOrEqual(8)
  const url = process.env.NEON_DATABASE_URL
  expect(url, 'NEON_DATABASE_URL (owner connection) is not set').toBeTruthy()

  const created = await authCreateUser({ email, password, name })
  if (created.error && !created.error.duplicate) throw new Error(`account not created: ${created.error.message}`)

  const sql = postgres(url!, { max: 1, prepare: false, onnotice: () => {} })
  try {
    const [ba] = await sql`select id from ba."user" where lower(email) = ${email}`
    expect(ba, 'no sign-in account for the owner email').toBeTruthy()
    const [row] = await sql`
      update public.users
         set role = 'super_admin', tenant_id = null, is_active = true, must_change_password = false, full_name = coalesce(full_name, ${name})
       where id = ${ba.id}
       returning id, role, tenant_id, is_active`
    expect(row, 'the users row was not created by the sign-up trigger').toBeTruthy()
    console.log(`[owner] ${created.error?.duplicate ? 'existing account kept' : 'account created'}: id=${row.id} role=${row.role} active=${row.is_active}`)
    expect(row.role).toBe('super_admin')
  } finally {
    await sql.end()
  }
})
