import { NextResponse } from 'next/server'
import { serviceClient } from '@/lib/staff-auth'
import { getMailCaller } from '@/lib/mail/access'
import { decrypt } from '@/lib/mail/crypto'
import { googleMailConfigured, revokeToken } from '@/lib/mail/google'

// GET — the caller's own linked mailbox (never the tokens).
export async function GET() {
  const auth = await getMailCaller()
  if ('error' in auth) return auth.error
  const { data } = await serviceClient()
    .from('mail_connections')
    .select('provider, email, status, last_error, updated_at')
    .eq('user_id', auth.caller.id)
  return NextResponse.json({ configured: { google: googleMailConfigured() }, connections: data ?? [] })
}

// DELETE { provider } — unlink: revoke at Google, then delete the row.
export async function DELETE(request: Request) {
  const auth = await getMailCaller()
  if ('error' in auth) return auth.error
  let body: { provider?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (body.provider !== 'google') return NextResponse.json({ error: 'مزوّد غير مدعوم' }, { status: 400 })

  const admin = serviceClient()
  const { data: conn } = await admin
    .from('mail_connections').select('id, refresh_token_enc')
    .eq('user_id', auth.caller.id).eq('provider', 'google').maybeSingle()
  if (!conn) return NextResponse.json({ success: true })

  try { await revokeToken(decrypt(conn.refresh_token_enc)) } catch { /* unlink locally regardless */ }
  const { error } = await admin.from('mail_connections').delete().eq('id', conn.id)
  if (error) return NextResponse.json({ error: 'تعذّر إلغاء الربط' }, { status: 500 })
  return NextResponse.json({ success: true })
}
