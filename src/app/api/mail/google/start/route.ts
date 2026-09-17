import { NextResponse } from 'next/server'
import { resolveAppUrl } from '@/lib/auth-urls'
import { getMailCaller } from '@/lib/mail/access'
import { signState } from '@/lib/mail/crypto'
import { googleAuthUrl, googleMailConfigured } from '@/lib/mail/google'

// GET — opened in a popup; sends the user to Google's own consent screen.
export async function GET(request: Request) {
  const auth = await getMailCaller()
  if ('error' in auth) return auth.error
  if (!googleMailConfigured()) {
    return NextResponse.json({ error: 'ربط Gmail غير مُعدّ على الخادم بعد' }, { status: 503 })
  }
  const origin = resolveAppUrl(request.url, process.env.NEXT_PUBLIC_APP_URL)
  return NextResponse.redirect(googleAuthUrl(origin, signState(auth.caller.id)))
}
