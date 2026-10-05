export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { getLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/config'
import { redirect } from 'next/navigation'
import { StudentProfileClient, type Affiliation } from './profile-client'
import { getTenantSettings } from '@/lib/structure-mode'
import { getStudentTrack } from '@/lib/student-track'
import { getTerms } from '@/lib/terminology'
import { loadOwnStudentName } from '@/lib/student-names'
import { fourPartName } from '@/lib/person-name'

export default async function StudentProfilePage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const [{ data: profile }, ownName] = await Promise.all([
    supabase
      .from('users')
      .select('*, tenants(name, slug)') // '*' so member_code arrives once member_code_migration.sql is applied
      .eq('id', user.id)
      .single(),
    // The four parts: readable by this student alone (everyone else sees
    // users.full_name = first + family name).
    loadOwnStudentName(supabase, user.id),
  ])

  const { data: groups } = await supabase
    .from('group_students')
    .select('groups!inner(id, name, description, is_active, teacher:users!groups_teacher_id_fkey(full_name))')
    .eq('student_id', user.id)
    // An archived group (is_active = false) is hidden from students — here and in the
    // affiliation derived from these groups below. The membership itself stays.
    .eq('groups.is_active', true)

  type GroupItem = { id: string; name: string; description: string | null; teacher: { full_name: string } | { full_name: string }[] | null }
  type GroupRow = { groups: GroupItem | GroupItem[] | null }
  const myGroups = (groups ?? [] as GroupRow[]).map((r: GroupRow) => {
    const g = Array.isArray(r.groups) ? r.groups[0] : r.groups
    if (!g) return null
    const teacher = Array.isArray(g.teacher) ? g.teacher[0] : g.teacher
    return { id: g.id, name: g.name, description: g.description, teacher: teacher ? { full_name: teacher.full_name } : null }
  }).filter((g): g is NonNullable<typeof g> => g !== null)

  // Track decides what the student is told about their place in the institution:
  // a centre trainee sees the centre; an institution student sees their
  // faculty › department, but only when the tenant uses the academic structure.
  const settings = user.tenant_id ? await getTenantSettings(supabase, user.tenant_id) : null
  const track = getStudentTrack((profile as { is_university_student?: boolean } | null)?.is_university_student, settings?.has_center)
  const terms = getTerms(settings?.institution_type, (await getLocale()) as Locale)
  let affiliation: Affiliation = { track, unitL1Label: terms.unitL1, unitL2Label: terms.unitL2, units: [] }

  if (track === 'institution' && settings?.structure_mode === 'academic' && myGroups.length > 0) {
    const { data: linked } = await supabase
      .from('groups').select('academic_unit_id').in('id', myGroups.map(g => g.id)).not('academic_unit_id', 'is', null)
    const unitIds = [...new Set((linked ?? []).map(r => r.academic_unit_id as string))]
    if (unitIds.length > 0) {
      const { data: units } = await supabase.from('academic_units').select('id, name, parent_id, level').in('id', unitIds)
      const parentIds = [...new Set((units ?? []).map(u => u.parent_id).filter((p): p is string => !!p))]
      const { data: parents } = parentIds.length
        ? await supabase.from('academic_units').select('id, name').in('id', parentIds)
        : { data: [] as { id: string; name: string }[] }
      const parentName = new Map((parents ?? []).map(p => [p.id, p.name]))
      affiliation = {
        ...affiliation,
        units: (units ?? []).map(u => u.level === 2
          ? { l1: parentName.get(u.parent_id as string) ?? '—', l2: u.name }
          : { l1: u.name, l2: null }),
      }
    }
  }

  return (
    <StudentProfileClient
      profile={profile as unknown as Parameters<typeof StudentProfileClient>[0]['profile']}
      fourPartName={ownName ? fourPartName(ownName) : null}
      groups={myGroups}
      affiliation={affiliation}
    />
  )
}
