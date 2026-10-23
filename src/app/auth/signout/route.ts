import { NextResponse } from 'next/server'
import { cookies, headers } from 'next/headers'
import { authSignOut } from '@/lib/auth/better'
import { CTX_COOKIE } from '@/lib/auth/session'

// POST /auth/signout — the one reliable way out.
//
// The server ends the Better Auth session (bounded to 3s) and then deletes the
// session cookie and our tm_ctx itself, whatever the revoke call did, so a slow
// or failed revoke can never leave the user stuck in their account.
const REVOKE_TIMEOUT_MS = 3000

export async function POST() {
  const requestHeaders = new Headers(await headers())
  await Promise.race([
    authSignOut(requestHeaders).catch(() => []),
    new Promise(resolve => setTimeout(resolve, REVOKE_TIMEOUT_MS)),
  ])

  const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  const store = await cookies()
  for (const c of store.getAll()) {
    // Better Auth's tm.* cookies (session token, cached data), with or without __Secure-
    if (c.name === CTX_COOKIE || /^(__Secure-)?tm\./.test(c.name)) res.cookies.set(c.name, '', { path: '/', maxAge: 0 })
  }
  return res
}
