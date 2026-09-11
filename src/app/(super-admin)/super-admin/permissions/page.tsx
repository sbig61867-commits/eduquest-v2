export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PermissionsEditor, type StaffMember } from '@/components/shared/permissions-editor'
import { PageTitle } from '@/components/shared/page-title'
import { resolvePermissions, CAPABILITIES } from '@/lib/permissions'
import type { Capability } from '@/lib/permissions'

// The platform owner decides what each university_admin (and centre manager)
// may do. super_admin holds every capability, so nothing is disabled here.
interface StaffRow {
  id: string
  full_name: string | null
  email: string
  role: string
  is_active: boolean
  permissions: Record<string, boolean> | null
  tenant_id: string | null
  tenants: { name: string } | null
}

export default async function SuperAdminPermissionsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const { data: rows } = await supabase
    .from('users')
    .select('id, full_name, email, role, is_active, permissions, tenant_id, tenants(name)')
    .in('role', ['university_admin', 'center_manager'])
    .order('role')

  const staffRows = (rows ?? []) as unknown as StaffRow[]

  const staff: StaffMember[] = staffRows.map(r => ({
    id: r.id,
    full_name: `${r.full_name ?? '·'} · ${r.tenants?.name ?? 'بلا مؤسسة'}`,
    email: `${r.email} · ${r.role === 'university_admin' ? 'مدير مؤسسة' : 'مدير مركز'}`,
    role: r.role,
    is_active: r.is_active,
    effective: resolvePermissions(r.role, r.permissions),
  }))

  // super_admin can grant everything.
  const grantable = Object.fromEntries(CAPABILITIES.map(c => [c, true])) as Record<Capability, boolean>

  return (
    <>
    <PageTitle title="Permissions" />
    <div className="max-w-4xl mx-auto space-y-6" dir="rtl">
      <div className="mb-7">
        <h1 className="text-xl font-semibold text-fg">الصلاحيات</h1>
        <p className="text-fg-secondary mt-1">
          حدّد ما يستطيع كل مدير مؤسسة ومدير مركز فعله. المدير بدوره لا يستطيع منح صلاحية لا يملكها.
        </p>
      </div>
      <PermissionsEditor
        staff={staff}
        grantable={grantable}
        emptyHint="لا يوجد مديرو مؤسسات أو مراكز بعد."
      />
    </div>
    </>
  )
}
