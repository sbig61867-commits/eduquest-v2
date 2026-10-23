import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { getMailCaller } from '@/lib/mail/access'
import { decrypt } from '@/lib/mail/crypto'
import { googleMailConfigured, revokeToken } from '@/lib/mail/google'

// GET — the caller's own linked mailbox (never the tokens).
export async function GET() {
  const auth = await getMailCaller()
  if ('error' in auth) return auth.error
  const { caller } = auth
  const [rows] = await run({ as: 'service', tenantId: caller.tenant_id }, sql => [
    sql`select provider, email, status, last_error, updated_at from public.mail_connections
         where user_id = ${caller.id} and tenant_id = ${caller.tenant_id} limit 10`,
  ])
  return NextResponse.json({ configured: { google: googleMailConfigured() }, connections: rows })
}

// DELETE { provider } — unlink: revoke at Google, then delete the row.
export async function DELETE(request: Request) {
  const auth = await getMailCaller()
  if ('error' in auth) return auth.error
  const { caller } = auth
  let body: { provider?: string }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }
  if (body.provider !== 'google') return NextResponse.json({ ...(await apiErr('unsupportedProvider')) }, { status: 400 })

  const scope = { as: 'service', tenantId: caller.tenant_id } as const
  const [rows] = await run(scope, sql => [
    sql`select id, refresh_token_enc from public.mail_connections
         where user_id = ${caller.id} and tenant_id = ${caller.tenant_id} and provider = 'google'`,
  ])
  const conn = maybeOne<{ id: string; refresh_token_enc: string }>(rows)
  if (!conn) return NextResponse.json({ success: true })

  try { await revokeToken(decrypt(conn.refresh_token_enc)) } catch { /* unlink locally regardless */ }
  try {
    await run(scope, sql => [sql`delete from public.mail_connections where id = ${conn.id} and user_id = ${caller.id}`])
  } catch {
    return NextResponse.json({ ...(await apiErr('unlinkFailed')) }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
