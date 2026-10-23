import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { currentUser, type AuthUser } from '@/lib/auth/current'

// Who is signed in: the signed session context (src/lib/auth/current.ts).
// The client argument is kept so the existing call sites stay unchanged; it is
// not used. The Supabase client below remains only for data reads that have
// not moved to the SQL layer yet (step 9).
export type { AuthUser } from '@/lib/auth/current'

export async function getAuthUser(_db?: SupabaseClient): Promise<AuthUser | null> {
  return currentUser()
}

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}
