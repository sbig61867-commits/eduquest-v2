import { NextResponse } from 'next/server'
import { apiErr } from '@/lib/api-error'
import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A course page marks one item, or syncs the quizzes handed in elsewhere — never many. */
const MAX_ITEMS = 200

// POST /api/student/progress { item_ids: string[] } — marks course items done
// for the signed-in student (the course player: «mark complete», and the sync
// of quizzes/tasks handed in from the exams page). Written as the student:
// student_progress RLS pins student_id to the caller and tenant_id to their
// institution. RLS does NOT check that the item belongs to a course the student
// is enrolled in (student_progress_insert only pins those two columns), so the
// statement does: it writes only when EVERY item is one of the student's
// enrolled courses (visible to them under unit_items RLS) — otherwise nothing
// is written and the answer is 403. Marking an item twice is a no-op.
export async function POST(request: Request) {
  const user = await currentUser()
  if (!user?.tenant_id) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const body = await request.json().catch(() => null) as { item_ids?: unknown } | null
  const ids = Array.isArray(body?.item_ids) ? [...new Set(body.item_ids)] : []
  if (!ids.length || ids.length > MAX_ITEMS || !ids.every(id => typeof id === 'string' && UUID.test(id))) {
    return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  }
  const tenantId = user.tenant_id
  try {
    const [rows] = await run({ as: 'user', userId: user.id }, sql => [
      sql`with eligible as (
            select i.id from public.unit_items i
              join public.course_enrollments e on e.course_id = i.course_id and e.student_id = ${user.id}
             where i.id in (select x::uuid from jsonb_array_elements_text(${sql.json(ids)}) x)),
          ins as (
            insert into public.student_progress (student_id, unit_item_id, tenant_id)
            select ${user.id}, id, ${tenantId} from eligible
             where (select count(*) from eligible) = ${ids.length}
            on conflict (student_id, unit_item_id) do nothing
            returning 1)
          select (select count(*)::int from eligible) as eligible`,
    ])
    if ((rows[0] as { eligible: number }).eligible !== ids.length) {
      return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[student/progress]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
}
