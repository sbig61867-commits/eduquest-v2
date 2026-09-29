import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { isMemberCode } from '@/lib/member-code'

// Owner-only: find one account by its permanent member code (QOU-S48203917,
// see supabase/member_code_migration.sql) and return its full record.

export async function GET(request: Request) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user || user.role !== 'super_admin') {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  const code = (new URL(request.url).searchParams.get('code') ?? '').trim().toUpperCase()
  if (!isMemberCode(code)) return NextResponse.json({ ...(await apiErr('memberCodeInvalid')) }, { status: 400 })

  const { data: member, error } = await supabase
    .from('users')
    .select('id, member_code, full_name, email, role, is_active, is_university_student, name_complete, locale, created_at, tenant_id, tenants(name, code, institution_type, is_active)')
    .eq('member_code', code)
    .maybeSingle()

  if (error) {
    // 42703 = the column does not exist yet (migration not applied).
    const status = error.code === '42703' ? 409 : 500
    console.error('[member-lookup]', error)
    return NextResponse.json({ ...(await apiErr(status === 409 ? 'memberCodeNotReady' : 'usersLoadFailed')) }, { status })
  }
  if (!member) return NextResponse.json({ ...(await apiErr('memberNotFound')) }, { status: 404 })

  const [{ data: groups }, { data: courses }] = await Promise.all([
    supabase.from('group_students').select('groups(name)').eq('student_id', member.id),
    supabase.from('course_enrollments').select('courses(title)').eq('student_id', member.id),
  ])

  return NextResponse.json({
    member,
    groups: (groups ?? []).map(g => (g as unknown as { groups: { name: string } | null }).groups?.name).filter(Boolean),
    courses: (courses ?? []).map(c => (c as unknown as { courses: { title: string } | null }).courses?.title).filter(Boolean),
  })
}
