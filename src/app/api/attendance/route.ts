import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serviceClient, staffCan } from '@/lib/staff-auth'

// Group attendance. Allowed for the group's own teacher, or staff holding
// manage_attendance in the same tenant. Authorization runs on the user
// session; the attendance tables have SELECT policies only, so every write
// goes through the service-role client after these checks.

const STATUSES = new Set(['present', 'absent', 'late', 'excused'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_NOTE = 300
const MAX_RECORDS = 500
const DAY_MS = 86_400_000

/** YYYY-MM-DD, a real calendar date, not far in the future or past. */
export function isValidSessionDate(d: unknown, now = Date.now()): d is string {
  if (typeof d !== 'string' || !DATE_RE.test(d)) return false
  const t = Date.parse(`${d}T00:00:00Z`)
  if (isNaN(t) || new Date(t).toISOString().slice(0, 10) !== d) return false
  return t <= now + 2 * DAY_MS && t >= now - 400 * DAY_MS
}

async function authorizeGroup(groupId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id, permissions').eq('id', user.id).single()
  if (!profile?.tenant_id) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const admin = serviceClient()
  const { data: group } = await admin
    .from('groups').select('id, tenant_id, teacher_id, deleted_at').eq('id', groupId).maybeSingle()
  if (!group || group.tenant_id !== profile.tenant_id || group.deleted_at) {
    return { error: NextResponse.json({ error: 'المجموعة غير موجودة' }, { status: 404 }) }
  }

  const staff = profile.role !== 'teacher' && staffCan(profile, 'manage_attendance')
  const owner = profile.role === 'teacher' && group.teacher_id === user.id
  if (!staff && !owner) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  return { admin, userId: user.id, tenantId: profile.tenant_id as string }
}

type Admin = ReturnType<typeof serviceClient>

async function rosterIds(admin: Admin, groupId: string) {
  const { data } = await admin.from('group_students').select('student_id').eq('group_id', groupId)
  return new Set((data ?? []).map(r => r.student_id as string))
}

// GET /api/attendance?group_id=…&date=YYYY-MM-DD
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const groupId = params.get('group_id')
  const date = params.get('date')
  if (!groupId) return NextResponse.json({ error: 'Missing group_id' }, { status: 400 })
  if (!isValidSessionDate(date)) return NextResponse.json({ error: 'تاريخ غير صالح' }, { status: 400 })

  const auth = await authorizeGroup(groupId)
  if ('error' in auth) return auth.error
  const { admin } = auth

  const [{ data: rosterRaw }, { data: session, error: sessionErr }, { data: recentRaw }] = await Promise.all([
    admin.from('group_students')
      .select('student_id, users!group_students_student_id_fkey(id, full_name, email, is_active)')
      .eq('group_id', groupId),
    admin.from('attendance_sessions').select('id, title')
      .eq('group_id', groupId).eq('session_date', date).is('schedule_slot_id', null).maybeSingle(),
    admin.from('attendance_sessions').select('id, session_date, title, attendance_records(status)')
      .eq('group_id', groupId).order('session_date', { ascending: false }).limit(10),
  ])

  if (sessionErr) {
    console.error('[api/attendance GET]', sessionErr)
    return NextResponse.json({ error: 'جداول الحضور غير متاحة — تأكد من تطبيق attendance_migration.sql' }, { status: 503 })
  }

  type U = { id: string; full_name: string; email: string; is_active: boolean }
  const roster = ((rosterRaw ?? []) as unknown as { users: U | U[] | null }[])
    .map(r => (Array.isArray(r.users) ? r.users[0] : r.users))
    .filter((u): u is U => !!u)
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar'))

  let records: Record<string, { status: string; note: string | null }> = {}
  if (session) {
    const { data } = await admin.from('attendance_records')
      .select('student_id, status, note').eq('session_id', session.id)
    records = Object.fromEntries((data ?? []).map(r => [r.student_id, { status: r.status, note: r.note }]))
  }

  type RecentRow = { id: string; session_date: string; title: string | null; attendance_records: { status: string }[] | null }
  const recent = ((recentRaw ?? []) as unknown as RecentRow[]).map(s => {
    const rows = s.attendance_records ?? []
    const count = (st: string) => rows.filter(r => r.status === st).length
    return {
      id: s.id, session_date: s.session_date, title: s.title,
      present: count('present'), late: count('late'), absent: count('absent'), excused: count('excused'),
    }
  })

  return NextResponse.json({ roster, session, records, recent })
}

// POST /api/attendance { group_id, session_date, title?, records: [{ student_id, status, note? }] }
export async function POST(request: Request) {
  let body: { group_id?: string; session_date?: string; title?: string; records?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { group_id, session_date } = body
  if (!group_id) return NextResponse.json({ error: 'Missing group_id' }, { status: 400 })
  if (!isValidSessionDate(session_date)) return NextResponse.json({ error: 'تاريخ غير صالح' }, { status: 400 })
  const title = body.title ? String(body.title).trim().slice(0, 120) : null

  if (!Array.isArray(body.records) || body.records.length === 0) {
    return NextResponse.json({ error: 'لا توجد سجلات حضور' }, { status: 400 })
  }
  if (body.records.length > MAX_RECORDS) return NextResponse.json({ error: 'عدد السجلات كبير جداً' }, { status: 400 })

  const records: { student_id: string; status: string; note: string | null }[] = []
  const seen = new Set<string>()
  for (const raw of body.records as Record<string, unknown>[]) {
    const studentId = typeof raw?.student_id === 'string' ? raw.student_id : ''
    const status = typeof raw?.status === 'string' ? raw.status : ''
    const note = raw?.note ? String(raw.note).trim() : null
    if (!studentId || !STATUSES.has(status)) return NextResponse.json({ error: 'سجل حضور غير صالح' }, { status: 400 })
    if (note && note.length > MAX_NOTE) return NextResponse.json({ error: 'الملاحظة طويلة جداً' }, { status: 400 })
    if (seen.has(studentId)) return NextResponse.json({ error: 'طالب مكرر في السجلات' }, { status: 400 })
    seen.add(studentId)
    records.push({ student_id: studentId, status, note: note || null })
  }

  const auth = await authorizeGroup(group_id)
  if ('error' in auth) return auth.error
  const { admin, userId, tenantId } = auth

  // Only students actually enrolled in this group can be marked.
  const members = await rosterIds(admin, group_id)
  if (records.some(r => !members.has(r.student_id))) {
    return NextResponse.json({ error: 'بعض الطلاب ليسوا في هذه المجموعة' }, { status: 400 })
  }

  const { data: existing, error: findErr } = await admin.from('attendance_sessions').select('id')
    .eq('group_id', group_id).eq('session_date', session_date).is('schedule_slot_id', null).maybeSingle()
  if (findErr) {
    console.error('[api/attendance POST find]', findErr)
    return NextResponse.json({ error: 'جداول الحضور غير متاحة — تأكد من تطبيق attendance_migration.sql' }, { status: 503 })
  }

  let sessionId = existing?.id as string | undefined
  if (sessionId) {
    await admin.from('attendance_sessions')
      .update({ title, updated_at: new Date().toISOString() }).eq('id', sessionId)
  } else {
    const { data: created, error } = await admin.from('attendance_sessions')
      .insert({ tenant_id: tenantId, group_id, session_date, title, created_by: userId })
      .select('id').single()
    if (error || !created) {
      console.error('[api/attendance POST session]', error)
      return NextResponse.json({ error: 'تعذّر إنشاء جلسة الحضور' }, { status: 500 })
    }
    sessionId = created.id as string
  }

  const markedAt = new Date().toISOString()
  const { error: recErr } = await admin.from('attendance_records').upsert(
    records.map(r => ({ ...r, session_id: sessionId, tenant_id: tenantId, marked_by: userId, marked_at: markedAt })),
    { onConflict: 'session_id,student_id' },
  )
  if (recErr) {
    console.error('[api/attendance POST records]', recErr)
    return NextResponse.json({ error: 'تعذّر حفظ الحضور' }, { status: 500 })
  }

  return NextResponse.json({ session_id: sessionId, saved: records.length })
}

// DELETE /api/attendance { session_id }
export async function DELETE(request: Request) {
  let body: { session_id?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!body.session_id) return NextResponse.json({ error: 'Missing session_id' }, { status: 400 })

  const { data: session } = await serviceClient()
    .from('attendance_sessions').select('id, group_id').eq('id', body.session_id).maybeSingle()
  if (!session) return NextResponse.json({ error: 'الجلسة غير موجودة' }, { status: 404 })

  const auth = await authorizeGroup(session.group_id)
  if ('error' in auth) return auth.error

  const { error } = await auth.admin.from('attendance_sessions').delete().eq('id', session.id)
  if (error) {
    console.error('[api/attendance DELETE]', error)
    return NextResponse.json({ error: 'تعذّر حذف الجلسة' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
