export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PermissionsEditor, type StaffMember } from '@/components/shared/permissions-editor'
import { can, resolvePermissions } from '@/lib/permissions'
import { ShieldAlert } from 'lucide-react'

// The university_admin grants capabilities to their centre managers.
// The escalation guard (you cannot grant what you don't hold) is enforced
// server-side in /api/admin/permissions; the UI mirrors it by disabling
// toggles the admin doesn't have.
export default async function AdminCenterStaffPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user?.tenant_id) redirect('/login')

  const { data: me } = await supabase
    .from('users').select('role, permissions').eq('id', user.id).single()

  if (!can(me?.role, me?.permissions, 'manage_center_staff')) {
    return (
      <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl" dir="rtl">
        <ShieldAlert className="w-12 h-12 text-slate-600 mx-auto mb-3" />
        <p className="text-slate-400">لا تملك صلاحية إدارة مديري المراكز.</p>
      </div>
    )
  }

  const { data: rows } = await supabase
    .from('users')
    .select('id, full_name, email, role, is_active, permissions')
    .eq('tenant_id', user.tenant_id)
    .eq('role', 'center_manager')
    .order('full_name')

  const staff: StaffMember[] = ((rows ?? []) as unknown as Array<{
    id: string; full_name: string | null; email: string; role: string
    is_active: boolean; permissions: Record<string, boolean> | null
  }>).map(r => ({
    id: r.id,
    full_name: r.full_name,
    email: r.email,
    role: r.role,
    is_active: r.is_active,
    effective: resolvePermissions(r.role, r.permissions),
  }))

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h2 className="text-2xl font-bold text-white">مديرو المراكز</h2>
        <p className="text-slate-400 mt-1">
          امنح كل مدير مركز الصلاحيات التي تريدها — لا يمكنك منح صلاحية لا تملكها أنت.
        </p>
      </div>
      <PermissionsEditor
        staff={staff}
        grantable={resolvePermissions(me?.role, me?.permissions)}
        emptyHint="لا يوجد مديرو مراكز بعد — ادعُهم من صفحة الدعوات بدور «مدير مركز»."
      />
    </div>
  )
}
