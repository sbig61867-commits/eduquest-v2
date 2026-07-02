import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export type JwtClaims = {
  sub: string
  app_metadata?: Record<string, unknown>
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getClaims() verifies the JWT locally against the project's cached JWKS
  // (asymmetric signing keys) instead of round-tripping to /auth/v1/user on
  // every request like getUser() does. It still refreshes an expired session.
  // On projects with legacy symmetric keys it transparently falls back to
  // server-side verification, so this is never less correct — only faster.
  const { data } = await supabase.auth.getClaims()
  const claims = (data?.claims ?? null) as JwtClaims | null

  return { supabaseResponse, claims, supabase }
}
