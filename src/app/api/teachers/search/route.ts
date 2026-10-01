import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCaller, staffCan } from '@/lib/staff-auth'
import type { Capability } from '@/lib/permissions'
import { sanitizeSearch, searchTeachers } from '@/lib/data/people'

// Which capability lets the caller assign a teacher on each screen — the same
// gate the write uses: /api/groups POST/PATCH teacher_id (manage_groups) and
// /api/courses POST/PATCH teacher_id (manage_courses, never a teacher).
const SCOPE_CAPABILITY: Record<string, Capability> = {
  groups: 'manage_groups',
  courses: 'manage_courses',
}

// GET /api/teachers/search?for=groups|courses&q=…
// The teacher selector of /center/groups and /center/courses: at most 20
// active teachers of the caller's institution whose name matches q
// (src/lib/data/people.ts searchTeachers) — never the whole teaching staff.
//
// Authorization is decided here, never by the UI: an active staff account with
// an institution (getCaller) holding the capability of the screen it assigns
// from — exactly who may then save the assignment. Teachers and students never
// hold staff capabilities. Reads run on the caller's session, so RLS stays the
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

  const supabase = await createClient()
  const { rows, error } = await searchTeachers(supabase, caller.tenant_id, q)
  if (error) {
    console.error('[teachers/search]', error)
    return NextResponse.json({ ...(await apiErr('usersLoadFailed')) }, { status: 500 })
  }
  return NextResponse.json({ teachers: rows })
}
