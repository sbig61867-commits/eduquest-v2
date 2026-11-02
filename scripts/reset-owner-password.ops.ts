// Sets a new password for the platform owner on Neon (local only). Uses the
// app's own Better Auth helper, so the hash is what sign-in expects, and ends
// every session of the account.
//
// The password is read from OWNER_PASSWORD in the environment and never
// printed or stored anywhere else. Run through scripts/reset-owner-password.ps1.
//
//   OWNER_EMAIL (default sbig61867@gmail.com)
import { it, expect } from 'vitest'
import postgres from 'postgres'
import { authSetPassword, authVerifyPassword } from '@/lib/auth/better'

const email = (process.env.OWNER_EMAIL ?? 'sbig61867@gmail.com').trim().toLowerCase()

it('resets the platform owner password', async () => {
  const password = process.env.OWNER_PASSWORD ?? ''
  expect(password.length, 'set OWNER_PASSWORD (at least 8 characters) in the environment').toBeGreaterThanOrEqual(8)
  const url = process.env.NEON_DATABASE_URL
  expect(url, 'NEON_DATABASE_URL (owner connection) is not set').toBeTruthy()

  const sql = postgres(url!, { max: 1, prepare: false, onnotice: () => {} })
  let userId: string
  try {
    const [ba] = await sql`select id from ba."user" where lower(email) = ${email}`
    expect(ba, 'no sign-in account for the owner email').toBeTruthy()
    userId = ba.id
  } finally {
    await sql.end()
  }

  const { error } = await authSetPassword(userId, password)
  if (error) throw new Error(`password not changed: ${error.message}`)
  expect(await authVerifyPassword(email, password), 'the new password does not verify').toBe(userId)
  console.log(`[owner] password changed for ${email}; all sessions ended`)
})
