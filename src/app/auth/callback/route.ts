import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getRoleDashboardPath } from '@/lib/utils'
import type { Role } from '@/types'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // Only allow same-origin relative paths — reject //host, /\host, and absolute URLs
  const rawNext = searchParams.get('next') ?? '/'
  const next = /^\/[^/\\]/.test(rawNext) ? rawNext : '/'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // If a specific destination was requested (e.g. /reset-password after a
      // password-recovery code), honour it directly — don't override with the
      // role dashboard. This is safe: `next` is already validated above.
      if (next !== '/') {
        return NextResponse.redirect(`${origin}${next}`)
      }

      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: profile } = await supabase
          .from('users')
          .select('role')
          .eq('id', user.id)
          .single()

        if (profile) {
          return NextResponse.redirect(`${origin}${getRoleDashboardPath(profile.role as Role)}`)
        }
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
