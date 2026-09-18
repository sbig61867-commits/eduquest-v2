import { NextResponse } from 'next/server'
import { serviceClient } from '@/lib/staff-auth'
import { rateLimit } from '@/lib/rate-limit'
import { getMailCaller } from '@/lib/mail/access'
import { buildMime, getAccessToken, sendGmail, type ConnectionRow } from '@/lib/mail/google'

// POST { recipient_ids: string[], subject, body }
// Sends one message per recipient FROM the caller's own linked mailbox.
// Recipients are user ids resolved inside the caller's tenant — never free-typed
// addresses — so a linked mailbox can't be turned into a spam relay.

const MAX_RECIPIENTS = 50
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export async function POST(request: Request) {
  const auth = await getMailCaller()
  if ('error' in auth) return auth.error
  const { caller } = auth

  let body: { recipient_ids?: unknown; subject?: unknown; body?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 }) }

  const ids = Array.isArray(body.recipient_ids) ? [...new Set(body.recipient_ids.filter((x): x is string => typeof x === 'string'))] : []
  const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
  const text = typeof body.body === 'string' ? body.body.trim() : ''
  if (ids.length === 0) return NextResponse.json({ error: 'اختر مستلماً واحداً على الأقل' }, { status: 400 })
  if (ids.length > MAX_RECIPIENTS) return NextResponse.json({ error: `الحد الأقصى ${MAX_RECIPIENTS} مستلماً في المرة الواحدة` }, { status: 400 })
  if (!subject || subject.length > 200) return NextResponse.json({ error: 'العنوان مطلوب (حتى 200 حرف)' }, { status: 400 })
  if (!text || text.length > 20000) return NextResponse.json({ error: 'نص الرسالة مطلوب' }, { status: 400 })

  // Gmail's own daily cap is ~500 (personal) / ~2000 (Workspace); stay well under it.
  const limit = await rateLimit(`mail-send:${caller.id}`, { limit: 300, windowSecs: 86400 })
  if (!limit.allowed) return NextResponse.json({ error: 'تجاوزت حد الإرسال اليومي' }, { status: 429 })

  const admin = serviceClient()
  const { data: conn } = await admin
    .from('mail_connections').select('*')
    .eq('user_id', caller.id).eq('provider', 'google').maybeSingle()
  if (!conn || conn.status === 'revoked') {
    return NextResponse.json({ error: 'اربط بريدك أولاً', code: 'NOT_LINKED' }, { status: 409 })
  }

  const { data: recipients } = await admin
    .from('users').select('id, email, full_name, role')
    .in('id', ids).eq('tenant_id', caller.tenant_id).in('role', ['student', 'teacher']).eq('is_active', true)
  if (!recipients?.length) return NextResponse.json({ error: 'لا يوجد مستلمون صالحون في مؤسستك' }, { status: 400 })

  const { data: sender } = await admin.from('users').select('full_name').eq('id', caller.id).maybeSingle()

  let token: string
  try {
    token = await getAccessToken(admin, conn as ConnectionRow)
  } catch (e) {
    const relink = (e as Error).message === 'RELINK_REQUIRED'
    return NextResponse.json(
      { error: relink ? 'انتهى ربط بريدك — أعد الربط' : 'تعذّر الاتصال ببريدك', code: relink ? 'RELINK_REQUIRED' : 'TOKEN_ERROR' },
      { status: 409 },
    )
  }

  const html = `<div dir="auto" style="font-family:sans-serif;line-height:1.7;white-space:pre-wrap">${escapeHtml(text)}</div>`
  const results: { id: string; ok: boolean }[] = []
  for (const r of recipients) {
    const sent = await sendGmail(token, buildMime({
      fromEmail: conn.email, fromName: sender?.full_name ?? undefined, to: r.email, subject, html,
    }))
    results.push({ id: r.id, ok: sent.ok })
    await admin.from('mail_messages').insert({
      tenant_id: caller.tenant_id, sender_id: caller.id, connection_id: conn.id, from_email: conn.email,
      recipient_id: r.id, to_email: r.email, subject,
      status: sent.ok ? 'sent' : 'failed', error: sent.ok ? null : sent.error.slice(0, 500),
    })
  }

  const sentCount = results.filter(r => r.ok).length
  return NextResponse.json({ sent: sentCount, failed: results.length - sentCount, skipped: ids.length - recipients.length })
}
