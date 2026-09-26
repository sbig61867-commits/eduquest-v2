import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

// POST /auth/signout — the one reliable way out.
//
// The browser-side supabase.auth.signOut() only removes the session AFTER its
// network call to /auth/v1/logout succeeds; on a slow or failed call it
// returns an error and leaves the session cookies in place. The proxy then
// bounces /login straight back to the dashboard, so the user appears stuck in
// their account until a manual refresh. Here the server revokes the session
// (bounded to 3s) and then deletes the Supabase auth cookies itself, whatever
// the revoke call did.
const REVOKE_TIMEOUT_MS = 3000

export async function POST() {
  const supabase = await createClient()
  await Promise.race([
    supabase.auth.signOut().catch(() => undefined),
    new Promise(resolve => setTimeout(resolve, REVOKE_TIMEOUT_MS)),
  ])

  const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  const store = await cookies()
  for (const c of store.getAll()) {
    // sb-<project>-auth-token and its chunked parts (.0, .1 …), plus the PKCE verifier.
    if (c.name.startsWith('sb-')) res.cookies.set(c.name, '', { path: '/', maxAge: 0 })
  }
  return res
}
