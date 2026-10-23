import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { currentCtx } from '@/lib/auth/current'
import { run, maybeOne } from '@/lib/db/sql'
import { sanitizeSearch, studentSearchSql } from '@/lib/data/people'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/students/search?q=…&group_id=…
// The student selector of /teacher/groups «إدارة الطلاب»: at most 20 active
// students of the caller's institution matching q, minus the group's members.
// Replaces sending the whole student body to the page (PERFORMANCE_CONTRACT.md P1).
//
// Authorization is decided here, never by the UI: only a teacher, only for a
// group they teach in their own institution — the same people the page could
// already see (users_select lets a teacher read their institution's students;
// /api/group-students POST/DELETE keep their own checks). One unit, read as
// the teacher, so RLS stays the isolation boundary: the ownership check and
// the search together; the results are discarded unless the group is theirs.
export async function GET(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  if (ctx.role !== 'teacher' || !ctx.tenant_id) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  const tenantId = ctx.tenant_id

  const params = new URL(request.url).searchParams
  const q = sanitizeSearch(params.get('q'))
  if (!q) return NextResponse.json({ ...(await apiErr('searchQueryRequired')) }, { status: 400 })
  const groupId = params.get('group_id') ?? ''
  if (!UUID_RE.test(groupId)) return NextResponse.json({ ...(await apiErr('missingGroupId')) }, { status: 400 })

  try {
    const [group, students] = await run({ as: 'user', userId: ctx.sub }, sql => [
      sql`select id from public.groups where id = ${groupId} and teacher_id = ${ctx.sub} and tenant_id = ${tenantId}`,
      studentSearchSql(sql, tenantId, q, { kind: 'group', id: groupId }),
    ])
    if (!maybeOne(group)) return NextResponse.json({ ...(await apiErr('groupNotFound')) }, { status: 404 })
    return NextResponse.json({ students })
  } catch (e) {
    console.error('[students/search]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('studentsLoadFailed')) }, { status: 500 })
  }
}
