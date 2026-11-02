import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run } from '@/lib/db/sql'
import { getCaller, staffCan } from '@/lib/staff-auth'
import type { Capability } from '@/lib/permissions'
import { sanitizeSearch } from '@/lib/data/people'

const TEACHER_SEARCH_LIMIT = 20

// Which capability lets the caller assign a teacher on each screen — the same
// gate the write uses: /api/groups POST/PATCH teacher_id (manage_groups) and
// /api/courses POST/PATCH teacher_id (manage_courses, never a teacher).
const SCOPE_CAPABILITY: Record<string, Capability> = {
  groups: 'manage_groups',
  courses: 'manage_courses',
  // /admin/school homeroom teacher (رائد الصف): the same gate as /api/school/structure
  school: 'manage_academic_structure',
}

// GET /api/teachers/search?for=groups|courses&q=…
// The teacher selector of /center/groups and /center/courses: at most 20
// active teachers of the caller's institution whose name matches q
// (src/lib/data/people.ts searchTeachers) — never the whole teaching staff.
//
// Authorization is decided here, never by the UI: an active staff account with
// an institution (getCaller) holding the capability of the screen it assigns
// from — exactly who may then save the assignment. Teachers and students never
// hold staff capabilities. The search is read as the caller, so RLS stays the
// isolation boundary; the institution always comes from the caller's profile.
export async function GET(request: Request) {
  const auth = await getCaller()
  if ('error' in auth) return auth.error
  const { caller } = auth

  const params = new URL(request.url).searchParams
  const capability = SCOPE_CAPABILITY[params.get('for') ?? '']
  if (!capability) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  if (!staffCan(caller, capability)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  const q = sanitizeSearch(params.get('q'))
  if (!q) return NextResponse.json({ ...(await apiErr('searchQueryRequired')) }, { status: 400 })

  try {
    const [rows] = await run({ as: 'user', userId: caller.id }, sql => [
      sql`select id, full_name from public.users
           where tenant_id = ${caller.tenant_id} and role = 'teacher' and is_active and full_name ilike ${'%' + q + '%'}
           order by full_name, id limit ${TEACHER_SEARCH_LIMIT}`,
    ])
    return NextResponse.json({ teachers: rows })
  } catch (e) {
    console.error('[teachers/search]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('usersLoadFailed')) }, { status: 500 })
  }
}
