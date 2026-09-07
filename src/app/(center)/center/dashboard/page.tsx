export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { GraduationCap, Users, Layers, Megaphone, ShieldCheck } from 'lucide-react'
import { resolvePermissions, CAPABILITY_LABELS, CAPABILITIES } from '@/lib/permissions'

export default async function CenterDashboard() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user?.tenant_id) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('role, permissions').eq('id', user.id).single()
  const perms = resolvePermissions(profile?.role, profile?.permissions)

  const [{ count: teachers }, { count: students }, { count: groups }, { count: announcements }] = await Promise.all([
    supabase.from('users').select('*', { count: 'exact', head: true }).eq('tenant_id', user.tenant_id).eq('role', 'teacher'),
    supabase.from('users').select('*', { count: 'exact', head: true }).eq('tenant_id', user.tenant_id).eq('role', 'student'),
    supabase.from('groups').select('*', { count: 'exact', head: true }).eq('tenant_id', user.tenant_id),
    supabase.from('announcements').select('*', { count: 'exact', head: true }).eq('tenant_id', user.tenant_id),
  ])

  const granted = CAPABILITIES.filter(c => perms[c])

  return (
    <div className="space-y-6" dir="rtl">
      <h1 className="text-xl font-semibold text-fg">لوحة مدير المركز</h1>

      {/* Capabilities — the organizing element of this dashboard */}
      <div className="bg-surface border border-border rounded-lg p-5">
        <h2 className="text-sm font-semibold text-fg flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-accent" /> صلاحياتك
        </h2>
        {granted.length === 0 ? (
          <p className="text-fg-muted text-sm">لم يمنحك المدير أي صلاحية بعد.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {granted.map(c => (
              <span key={c} className="text-xs px-2.5 py-1 rounded-full bg-accent-subtle text-accent border border-accent-border">
                {CAPABILITY_LABELS[c]}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Institution overview — slim strip, secondary to capabilities */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'المعلمون', value: teachers ?? 0, icon: GraduationCap },
          { label: 'الطلاب', value: students ?? 0, icon: Users },
          { label: 'المجموعات', value: groups ?? 0, icon: Layers },
          { label: 'الإعلانات', value: announcements ?? 0, icon: Megaphone },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="flex items-center gap-3 bg-surface border border-border rounded-lg px-4 py-3">
            <Icon className="w-4 h-4 text-accent shrink-0" />
            <div>
              <p className="text-lg font-semibold text-fg leading-none">{value}</p>
              <p className="text-xs text-fg-muted mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
