import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run } from '@/lib/db/sql'
import { getMailCaller } from '@/lib/mail/access'
import { sanitizeSearch } from '@/lib/data/people'
import { idList, MAX_RECIPIENTS, resolveMailRecipients } from '@/lib/mail/recipients'

// /center/mail recipients (Batch 2) — the page no longer receives the student
// body or any group's member list. Same gate as /api/mail/send (getMailCaller:
// university_admin / center_manager holding manage_students).

const STUDENT_SEARCH_LIMIT = 20

// GET ?q=… — at most 20 active students of the caller's institution by name or
// email: id, name, email (what the page used to send for everyone). Read as the
// caller, so RLS stays the boundary; the term is a bound parameter.
export async function GET(request: Request) {
  const auth = await getMailCaller()
  if ('error' in auth) return auth.error
  const q = sanitizeSearch(new URL(request.url).searchParams.get('q'))
  if (!q) return NextResponse.json({ ...(await apiErr('searchQueryRequired')) }, { status: 400 })

  const pattern = `%${q}%`
  try {
    const [rows] = await run({ as: 'user', userId: auth.caller.id }, sql => [
      sql`select id, full_name, email from public.users
           where tenant_id = ${auth.caller.tenant_id} and role = 'student' and is_active
             and (full_name ilike ${pattern} or email ilike ${pattern})
           order by full_name, id limit ${STUDENT_SEARCH_LIMIT}`,
    ])
    const students = rows as unknown as { id: string; full_name: string | null; email: string | null }[]
    return NextResponse.json({ students: students.map(r => ({ id: r.id, name: r.full_name || '—', email: r.email })) })
  } catch (e) {
    console.error('[mail/recipients GET]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('studentsLoadFailed')) }, { status: 500 })
  }
}

// POST { recipient_ids, group_ids } — how many people the selection reaches,
// resolved exactly as /api/mail/send will resolve it (groups on the server).
// Returns a number only — never member ids or addresses. Sends nothing.
export async function POST(request: Request) {
  const auth = await getMailCaller()
  if ('error' in auth) return auth.error
  let body: { recipient_ids?: unknown; group_ids?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }
  const picked = idList(body.recipient_ids)
  if (picked.length > MAX_RECIPIENTS) return NextResponse.json({ count: picked.length })

  const resolved = await resolveMailRecipients(auth.caller.tenant_id, picked, idList(body.group_ids))
  if (!resolved.ok) {
    if (resolved.error === 'groupNotFound') return NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 })
    if (resolved.error === 'invalidData') return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
    return NextResponse.json({ ...(await apiErr('unexpected')) }, { status: 500 })
  }
  return NextResponse.json({ count: resolved.ids.length })
}
