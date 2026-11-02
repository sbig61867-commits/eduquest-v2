export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { currentUser } from '@/lib/auth/current'
import { can } from '@/lib/permissions'
import { NoPermission } from '@/components/shared/no-permission'
import { PageTitle } from '@/components/shared/page-title'
import { getTenantSettings } from '@/lib/data/tenant-settings'
import { isSchemaMissing, loadSchoolStructure, type SchoolStructure } from '@/lib/data/school-structure'
import { isTimetableSchemaMissing, loadSchoolCurriculum } from '@/lib/data/school-timetable'
import type { SchoolCurriculum } from '@/lib/school-timetable'
import { SchoolClient } from './school-client'

// الهيكل المدرسي — schools only (tenants.institution_type = 'school'); every
// other institution is sent to its dashboard, as the sidebar never shows the
// entry to them. Two read units as the admin, started together: the structure
// (src/lib/data/school-structure.ts) and the subjects + bell schedule
// (src/lib/data/school-timetable.ts, migration 0014; until it is applied those
// tabs say so and the rest of the page works as before).
export default async function AdminSchoolPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const t = await getTranslations('admin.school')
  const user = await currentUser()
  if (!user?.tenant_id) redirect('/login')
  const tenantId = user.tenant_id

  const year = (await searchParams).year
  const curriculumRead = loadSchoolCurriculum(user.id, tenantId).catch((e: unknown) => {
    if (isTimetableSchemaMissing(e)) return null
    throw e
  })
  let data: SchoolStructure
  let curriculum: SchoolCurriculum | null
  try {
    ;[data, curriculum] = await Promise.all([loadSchoolStructure(user.id, tenantId, year), curriculumRead])
  } catch (e) {
    if (!isSchemaMissing(e)) throw e
    // migration 0013 not applied yet: non-schools still leave, schools see why
    if ((await getTenantSettings(user.id, tenantId)).institution_type !== 'school') redirect('/admin/dashboard')
    return (
      <div className="bg-surface border border-line rounded-overlay p-6 text-center">
        <PageTitle title={t('title')} />
        <p className="text-fg-2 text-body-sm">{t('migrationMissing')}</p>
      </div>
    )
  }

  if (data.institutionType !== 'school') redirect('/admin/dashboard')
  if (!can(data.profile?.role, data.profile?.permissions, 'manage_academic_structure')) {
    return <NoPermission capability="manage_academic_structure" />
  }

  return (
    <>
      <PageTitle title={t('title')} />
      <SchoolClient
        stages={data.stages}
        grades={data.grades}
        years={data.years}
        terms={data.terms}
        yearId={data.yearId}
        sections={data.sections}
        curriculum={curriculum}
        canSchedule={can(data.profile?.role, data.profile?.permissions, 'manage_schedules')}
      />
    </>
  )
}
