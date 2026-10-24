import { NextResponse } from 'next/server'
import { apiErr } from '@/lib/api-error'
import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** One live wall's new arrivals — the monitor asks only for ids it has not named yet. */
const MAX_IDS = 500

// POST /api/proctoring/live-names { exam_id, ids } — names for the students the
// live wall shows (/teacher/proctoring/live/[examId]). Only the exam's own
// teacher, and only students who are taking that exam: members of its group
// or enrolled in its course, or the student it is assigned to. Read as the
// teacher (RLS); id + full name only.
export async function POST(request: Request) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const b = await request.json().catch(() => null) as { exam_id?: unknown; ids?: unknown } | null
  const examId = String(b?.exam_id ?? '')
  const ids = Array.isArray(b?.ids) ? [...new Set(b.ids)] : []
  if (!UUID.test(examId) || !ids.length || ids.length > MAX_IDS || !ids.every(id => typeof id === 'string' && UUID.test(id))) {
    return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  }
  try {
    const [rows] = await run({ as: 'user', userId: user.id }, sql => [
      sql`select u.id, u.full_name
            from public.exams e
            join public.users u on u.id in (select x::uuid from jsonb_array_elements_text(${sql.json(ids)}) x)
           where e.id = ${examId} and e.teacher_id = ${user.id}
             and (u.id = e.assigned_student_id
                  or exists (select 1 from public.group_students gs where gs.group_id = e.group_id and gs.student_id = u.id)
                  or exists (select 1 from public.course_enrollments ce where ce.course_id = e.course_id and ce.student_id = u.id))`,
    ])
    return NextResponse.json({ names: rows })
  } catch (e) {
    console.error('[proctoring/live-names]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('unexpected')) }, { status: 500 })
  }
}
