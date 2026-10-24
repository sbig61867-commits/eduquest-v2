export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { redirect } from 'next/navigation'
import { GroupsClient } from './groups-client'
import { ScopedIntlProvider } from '@/i18n/provider'

export default async function GroupsPage() {
  const user = await currentUser()
  if (!user) redirect('/login')

  // The teacher's live profile and their groups in one unit. The groups are
  // those of the institution the profile names now (a removed teacher has none).
  const [profiles, groups] = await run({ as: 'user', userId: user.id }, sql => [
    sql`select tenant_id from public.users where id = ${user.id}`,
    sql`select g.id, g.name, g.description, g.created_at, g.is_active,
               json_build_array(json_build_object('count', (select count(*)::int from public.group_students s where s.group_id = g.id))) as group_students
          from public.groups g
         where g.teacher_id = ${user.id} and g.tenant_id = (select u.tenant_id from public.users u where u.id = ${user.id})
         order by g.created_at desc limit 500`,
  ])
  const profile = profiles[0] as { tenant_id: string | null } | undefined
  if (!profile?.tenant_id) redirect('/login?error=university_removed')

  // «إدارة الطلاب» finds students on demand through /api/students/search
  // (≤ 20 per search); the institution's student body is never sent to the page.
  // 'staff' is the student's reset-password button (src/components/shared/reset-password-button.tsx).
  return (
    <ScopedIntlProvider namespaces={['common', 'teacher', 'terms', 'staff']}>
      <GroupsClient
        initialGroups={groups as unknown as Parameters<typeof GroupsClient>[0]['initialGroups']}
        teacherId={user.id}
        tenantId={profile.tenant_id}
      />
    </ScopedIntlProvider>
  )
}
