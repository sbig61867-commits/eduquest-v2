import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { currentCtx } from '@/lib/auth/current'
import { run, maybeOne } from '@/lib/db/sql'
import { isMemberCode } from '@/lib/member-code'

// Owner-only: find one account by its permanent member code (QOU-S48203917,
// see supabase/member_code_migration.sql) and return its full record.

const LIST_LIMIT = 200

type Member = { id: string; groups: (string | null)[] | null; courses: (string | null)[] | null } & Record<string, unknown>

export async function GET(request: Request) {
  const ctx = await currentCtx()
  if (!ctx || ctx.role !== 'super_admin') {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  const code = (new URL(request.url).searchParams.get('code') ?? '').trim().toUpperCase()
  if (!isMemberCode(code)) return NextResponse.json({ ...(await apiErr('memberCodeInvalid')) }, { status: 400 })

  // One statement, read as the owner (RLS: super_admin sees every account):
  // the account with its institution, group names and course titles.
  let member: Member | null
  try {
    const [rows] = await run({ as: 'user', userId: ctx.sub }, sql => [
      sql`select u.id, u.member_code, u.full_name, u.email, u.role, u.is_active, u.is_university_student,
                 u.name_complete, u.locale, u.created_at, u.tenant_id,
                 case when t.id is null then null else json_build_object(
                   'name', t.name, 'code', t.code, 'institution_type', t.institution_type, 'is_active', t.is_active) end as tenants,
                 coalesce((select json_agg(x.name) from (select g.name from public.group_students gs
                             join public.groups g on g.id = gs.group_id
                            where gs.student_id = u.id limit ${LIST_LIMIT}) x), '[]') as groups,
                 coalesce((select json_agg(x.title) from (select c.title from public.course_enrollments ce
                             join public.courses c on c.id = ce.course_id
                            where ce.student_id = u.id limit ${LIST_LIMIT}) x), '[]') as courses
            from public.users u left join public.tenants t on t.id = u.tenant_id
           where u.member_code = ${code}`,
    ])
    member = maybeOne<Member>(rows)
  } catch (e) {
    // 42703 = the column does not exist yet (migration not applied).
    const notReady = (e as { code?: string }).code === '42703'
    console.error('[member-lookup]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr(notReady ? 'memberCodeNotReady' : 'usersLoadFailed')) }, { status: notReady ? 409 : 500 })
  }
  if (!member) return NextResponse.json({ ...(await apiErr('memberNotFound')) }, { status: 404 })

  const { groups, courses, ...record } = member
  return NextResponse.json({
    member: record,
    groups: (groups ?? []).filter(Boolean),
    courses: (courses ?? []).filter(Boolean),
  })
}
