import { NextResponse } from 'next/server'

// /auth/callback served Google sign-in on Supabase Auth. Google sign-in is off
// (owner's decision: hidden until Google verifies the app, and no Google work
// until the owner asks after the migration), and the new sign-in system has no
// OAuth flow yet — so anyone who still reaches this URL gets the same notice as
// the login page's Google button. The Supabase version (invitation gate, seat
// limit, four-part student name) is in git history before step 9; rebuild it
// on Better Auth when Google is turned back on.
export function GET(request: Request) {
  return NextResponse.redirect(new URL('/login?error=google_unavailable', request.url))
}
