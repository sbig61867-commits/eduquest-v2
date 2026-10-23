export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run, maybeOne } from '@/lib/db/sql'
import { getLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/config'
import { redirect } from 'next/navigation'
import { StudentProfileClient, type Affiliation } from './profile-client'
import { toTenantSettings } from '@/lib/structure-mode'
import { getStudentTrack } from '@/lib/student-track'
import { getTerms } from '@/lib/terminology'
import { fourPartName } from '@/lib/person-name'
import { PreferencesCard } from '@/components/shared/preferences-card'

type GroupItem = { id: string; name: string; description: string | null; teacher: { full_name: string } | null; academic_unit_id: string | null }
type UnitRow = { id: string; name: string; parent_id: string | null; level: number; parent_name: string | null }

export default async function StudentProfilePage() {
  const user = await currentUser()
  if (!user) redirect('/login')

  // ONE unit, read as the student (RLS decides, as before): their profile with
  // the institution, the four parts of their name (readable by this student
  // alone — everyone else sees users.full_name = first + family name), their
  // ACTIVE groups (an archived group is hidden from students, here and in the
  // affiliation derived below; the membership itself stays), the institution's
  // settings and the academic units those groups are placed in.
  const [profileRows, nameRows, groupRows, tenantRows, unitRows] = await run({ as: 'user', userId: user.id }, sql => [
    sql`select u.id, u.full_name, u.email, u.created_at, u.member_code, u.is_university_student, u.tenant_id,
               case when t.id is null then null else json_build_object('name', t.name, 'slug', t.slug) end as tenants
          from public.users u left join public.tenants t on t.id = u.tenant_id where u.id = ${user.id}`,
    sql`select first_name, father_name, grandfather_name, family_name from public.student_names where user_id = ${user.id}`,
    sql`select g.id, g.name, g.description, g.academic_unit_id,
               case when tch.id is null then null else json_build_object('full_name', tch.full_name) end as teacher
          from public.group_students gs join public.groups g on g.id = gs.group_id
          left join public.users tch on tch.id = g.teacher_id
         where gs.student_id = ${user.id} and g.is_active limit 200`,
    sql`select to_jsonb(t) as row from public.tenants t where t.id = ${user.tenant_id ?? null}::uuid`,
    sql`select u.id, u.name, u.parent_id, u.level, p.name as parent_name
          from public.academic_units u left join public.academic_units p on p.id = u.parent_id
         where u.id in (select g.academic_unit_id from public.group_students gs join public.groups g on g.id = gs.group_id
                         where gs.student_id = ${user.id} and g.is_active and g.academic_unit_id is not null)`,
  ])
  const profile = maybeOne<Record<string, unknown> & { is_university_student?: boolean }>(profileRows)
  const n = maybeOne<{ first_name: string; father_name: string; grandfather_name: string; family_name: string }>(nameRows)
  const ownName = n ? { first: n.first_name, father: n.father_name, grandfather: n.grandfather_name, family: n.family_name } : null
  const myGroups = (groupRows as unknown as GroupItem[]).map(g => ({ id: g.id, name: g.name, description: g.description, teacher: g.teacher }))

  // Track decides what the student is told about their place in the institution:
  // a centre trainee sees the centre; an institution student sees their
  // faculty › department, but only when the tenant uses the academic structure.
  const tenantRow = maybeOne<{ row: Record<string, unknown> }>(tenantRows)?.row
  const settings = user.tenant_id && tenantRow ? toTenantSettings(tenantRow) : null
  const track = getStudentTrack(profile?.is_university_student, settings?.has_center)
  const terms = getTerms(settings?.institution_type, (await getLocale()) as Locale)
  let affiliation: Affiliation = { track, unitL1Label: terms.unitL1, unitL2Label: terms.unitL2, units: [] }
  if (track === 'institution' && settings?.structure_mode === 'academic' && myGroups.length > 0) {
    affiliation = {
      ...affiliation,
      units: (unitRows as unknown as UnitRow[]).map(u => u.level === 2
        ? { l1: u.parent_name ?? '—', l2: u.name }
        : { l1: u.name, l2: null }),
    }
  }

  return (
    <div className="space-y-8">
      <PreferencesCard />
    <StudentProfileClient
      profile={profile as unknown as Parameters<typeof StudentProfileClient>[0]['profile']}
      fourPartName={ownName ? fourPartName(ownName) : null}
      groups={myGroups}
      affiliation={affiliation}
    />
    </div>
  )
}
