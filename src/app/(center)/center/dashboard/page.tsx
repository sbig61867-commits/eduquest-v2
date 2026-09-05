export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { GraduationCap, Users, Layers, Megaphone, ShieldCheck } from 'lucide-react'
import { resolvePermissions, CAPABILITY_LABELS, CAPABILITIES } from '@/lib/permissions'

// Metadata-only overview for the centre manager, mirroring the admin's
// "numbers, not content" rule.
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

  const cards = [
    { label: 'المعلمون', value: teachers ?? 0, icon: GraduationCap, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: 'الطلاب', value: students ?? 0, icon: Users, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: 'المجموعات', value: groups ?? 0, icon: Layers, color: 'text-violet-400', bg: 'bg-violet-500/10' },
    { label: 'الإعلانات', value: announcements ?? 0, icon: Megaphone, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  ]

  const granted = CAPABILITIES.filter(c => perms[c])

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h2 className="text-2xl font-bold text-white">لوحة مدير المركز</h2>
        <p className="text-slate-400 mt-1">نظرة عامة على مؤسستك</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(card => {
          const Icon = card.icon
          return (
            <div key={card.label} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-slate-400 text-sm">{card.label}</p>
                <div className={`p-2 rounded-lg ${card.bg}`}>
                  <Icon className={`w-5 h-5 ${card.color}`} />
                </div>
              </div>
              <p className="text-3xl font-bold text-white">{card.value}</p>
            </div>
          )
        })}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-blue-400" /> صلاحياتك
        </h3>
        {granted.length === 0 ? (
          <p className="text-slate-500 text-sm">لم يمنحك المدير أي صلاحية بعد.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {granted.map(c => (
              <span key={c} className="text-xs px-2.5 py-1 rounded-full bg-blue-600/15 text-blue-300 border border-blue-600/30">
                {CAPABILITY_LABELS[c]}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
