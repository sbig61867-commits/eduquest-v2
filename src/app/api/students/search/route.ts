import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { sanitizeSearch, searchStudents } from '@/lib/data/people'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/students/search?q=…&group_id=…
// The student selector of /teacher/groups «إدارة الطلاب»: at most 20 active
// students of the caller's institution matching q, minus the group's members
// (src/lib/data/people.ts searchStudents). Replaces sending the whole student
// body to the page (PERFORMANCE_CONTRACT.md P1).
//
// Authorization is decided here, never by the UI: only a teacher, only for a
// group they teach in their own institution — the same people the page could
// already see (users_select lets a teacher read their institution's students;
// /api/group-students POST/DELETE keep their own checks). Reads run on the
// teacher's session, so RLS stays the isolation boundary.
export async function GET(request: Request) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  if (user.role !== 'teacher' || !user.tenant_id) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  const params = new URL(request.url).searchParams
  const q = sanitizeSearch(params.get('q'))
  if (!q) return NextResponse.json({ ...(await apiErr('searchQueryRequired')) }, { status: 400 })
  const groupId = params.get('group_id') ?? ''
  if (!UUID_RE.test(groupId)) return NextResponse.json({ ...(await apiErr('missingGroupId')) }, { status: 400 })

  // Ownership and the search start together; results are discarded unless the
  // group is the caller's own.
  const [{ data: group }, found] = await Promise.all([
    supabase.from('groups').select('id')
      .eq('id', groupId).eq('teacher_id', user.id).eq('tenant_id', user.tenant_id).maybeSingle(),
    searchStudents(supabase, user.tenant_id, q, groupId),
  ])
  if (!group) return NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 })
  if (found.error) {
    console.error('[students/search]', found.error)
    return NextResponse.json({ ...(await apiErr('studentsLoadFailed')) }, { status: 500 })
  }
  return NextResponse.json({ students: found.rows })
}
