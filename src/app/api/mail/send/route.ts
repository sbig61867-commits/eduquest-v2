import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne } from '@/lib/db/sql'
import { rateLimit } from '@/lib/rate-limit'
import { getMailCaller } from '@/lib/mail/access'
import { buildMime, getAccessToken, sendGmail, type ConnectionRow } from '@/lib/mail/google'
import { idList, MAX_RECIPIENTS, resolveMailRecipients } from '@/lib/mail/recipients'

// POST { recipient_ids?: string[], group_ids?: string[], subject, body }
// Sends one message per recipient FROM the caller's own linked mailbox.
// Recipients are user ids resolved inside the caller's tenant — never free-typed
// addresses — so a linked mailbox can't be turned into a spam relay. «All
// students of a group» arrives as a group id and is resolved here
// (src/lib/mail/recipients.ts); the limits below apply to the resolved set.

const SEND_CONCURRENCY = 6
export const maxDuration = 60
const DAILY_MESSAGE_CAP = 300
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export async function POST(request: Request) {
  const auth = await getMailCaller()
  if ('error' in auth) return auth.error
  const { caller } = auth

  let body: { recipient_ids?: unknown; group_ids?: unknown; subject?: unknown; body?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const picked = idList(body.recipient_ids)
  const groupIds = idList(body.group_ids)
  const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
  const text = typeof body.body === 'string' ? body.body.trim() : ''
  if (picked.length === 0 && groupIds.length === 0) return NextResponse.json({ ...(await apiErr('recipientRequired')) }, { status: 400 })
  if (picked.length > MAX_RECIPIENTS) return NextResponse.json({ ...(await apiErr('tooManyRecipients', { max: MAX_RECIPIENTS })) }, { status: 400 })
  if (!subject || subject.length > 200) return NextResponse.json({ ...(await apiErr('subjectRequired200')) }, { status: 400 })
  if (!text || text.length > 20000) return NextResponse.json({ ...(await apiErr('bodyRequired')) }, { status: 400 })

  // Request-rate guard only — the daily cap below counts messages, not calls.
  const limit = await rateLimit(`mail-send:${caller.id}`, { limit: 60, windowSecs: 3600 })
  if (!limit.allowed) return NextResponse.json({ ...(await apiErr('tooManyRequests')) }, { status: 429 })

  // Groups → their active students of this institution; the limits apply to the whole set.
  const resolved = await resolveMailRecipients(caller.tenant_id, picked, groupIds)
  if (!resolved.ok) {
    if (resolved.error === 'groupNotFound') return NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 })
    if (resolved.error === 'invalidData') return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
    return NextResponse.json({ ...(await apiErr('unexpected')) }, { status: 500 })
  }
  const ids = resolved.ids
  if (ids.length === 0) return NextResponse.json({ ...(await apiErr('noValidRecipients')) }, { status: 400 })
  if (ids.length > MAX_RECIPIENTS) return NextResponse.json({ ...(await apiErr('tooManyRecipients', { max: MAX_RECIPIENTS })) }, { status: 400 })

  // One unit, pinned to the caller's institution: the messages sent in the
  // last 24 h, the caller's linked mailbox, the recipients (active students
  // and teachers of this institution only) and the sender's name.
  // Gmail's own daily cap is ~500 (personal) / ~2000 (Workspace); stay well
  // under it. One request carries up to 50 recipients, so the cap is on
  // MESSAGES — every attempt is logged in mail_messages below.
  const scope = { as: 'service', tenantId: caller.tenant_id } as const
  const validIds = ids.filter(id => /^[0-9a-f-]{36}$/i.test(id))
  let sentToday: number
  let conn: (ConnectionRow & { id: string }) | null
  let found: { id: string; email: string | null; full_name: string | null }[]
  let senderName: string | null
  try {
    const rows = await run(scope, sql => [
      sql`select count(*)::int as n from public.mail_messages
           where sender_id = ${caller.id} and tenant_id = ${caller.tenant_id} and created_at >= now() - interval '24 hours'`,
      sql`select id, user_id, tenant_id, email, refresh_token_enc, access_token_enc, access_expires_at, status
            from public.mail_connections
           where user_id = ${caller.id} and tenant_id = ${caller.tenant_id} and provider = 'google'`,
      sql`select id, email, full_name from public.users
           where tenant_id = ${caller.tenant_id} and role in ('student', 'teacher') and is_active
             and id in (select (jsonb_array_elements_text(${sql.json(validIds)}))::uuid)`,
      sql`select full_name from public.users where id = ${caller.id}`,
    ])
    sentToday = maybeOne<{ n: number }>(rows[0])?.n ?? 0
    conn = maybeOne(rows[1])
    found = rows[2] as unknown as typeof found
    senderName = maybeOne<{ full_name: string | null }>(rows[3])?.full_name ?? null
  } catch (e) {
    console.error('[mail/send] read', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('unexpected')) }, { status: 500 })
  }

  const remaining = DAILY_MESSAGE_CAP - sentToday
  if (ids.length > remaining) {
    return NextResponse.json(
      remaining > 0 ? { ...(await apiErr('dailySendLimitRemaining', { remaining })) } : { ...(await apiErr('dailySendLimit')) },
      { status: 429 },
    )
  }
  if (!conn || conn.status === 'revoked') {
    return NextResponse.json({ ...(await apiErr('linkMailboxFirst')), code: 'NOT_LINKED' }, { status: 409 })
  }

  // Accounts created by member ID hold their ID, not an address, in `email`.
  const recipients = found.filter((r): r is { id: string; email: string; full_name: string | null } =>
    typeof r.email === 'string' && r.email.includes('@'))
  if (!recipients.length) return NextResponse.json({ ...(await apiErr('noValidRecipients')) }, { status: 400 })

  let token: string
  try {
    token = await getAccessToken(conn)
  } catch (e) {
    const relink = (e as Error).message === 'RELINK_REQUIRED'
    return NextResponse.json(
      { ...(await apiErr(relink ? 'mailRelinkRequired' : 'mailTokenError')), code: relink ? 'RELINK_REQUIRED' : 'TOKEN_ERROR' },
      { status: 409 },
    )
  }

  const html = `<div dir="auto" style="font-family:sans-serif;line-height:1.7;white-space:pre-wrap">${escapeHtml(text)}</div>`
  // A few Gmail calls at a time instead of one after another: 50 recipients
  // used to take ~50 × (Gmail round-trip + a log insert) ≈ 20 s and could hit
  // the function time limit half-way. The log is written once, at the end.
  const results: { id: string; ok: boolean }[] = []
  const log: Record<string, string | null>[] = []
  for (let i = 0; i < recipients.length; i += SEND_CONCURRENCY) {
    const batch = recipients.slice(i, i + SEND_CONCURRENCY)
    const sent = await Promise.all(batch.map(r => sendGmail(token, buildMime({
      fromEmail: conn.email, fromName: senderName ?? undefined, to: r.email, subject, html,
    }))))
    batch.forEach((r, k) => {
      const s = sent[k]
      results.push({ id: r.id, ok: s.ok })
      log.push({
        tenant_id: caller.tenant_id, sender_id: caller.id, connection_id: conn.id, from_email: conn.email,
        recipient_id: r.id, to_email: r.email, subject,
        status: s.ok ? 'sent' : 'failed', error: s.ok ? null : s.error.slice(0, 500),
      })
    })
  }
  try {
    await run(scope, sql => [
      sql`insert into public.mail_messages (tenant_id, sender_id, connection_id, from_email, recipient_id, to_email, subject, status, error)
          select tenant_id, sender_id, connection_id, from_email, recipient_id, to_email, subject, status, error
            from jsonb_to_recordset(${sql.json(log)})
              as x(tenant_id uuid, sender_id uuid, connection_id uuid, from_email text, recipient_id uuid,
                   to_email text, subject text, status text, error text)`,
    ])
  } catch (e) {
    console.error('[mail/send] log insert', e instanceof Error ? e.message : e)
  }

  const sentCount = results.filter(r => r.ok).length
  return NextResponse.json({ sent: sentCount, failed: results.length - sentCount, skipped: ids.length - recipients.length })
}
