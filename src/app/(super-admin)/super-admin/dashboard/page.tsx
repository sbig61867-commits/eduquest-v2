export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { Building2, Users, Flag, ShieldCheck } from 'lucide-react'

async function getStats() {
  const supabase = await createClient()
  const [{ count: tenants }, { count: users }] = await Promise.all([
    supabase.from('tenants').select('*', { count: 'exact', head: true }),
    supabase.from('users').select('*', { count: 'exact', head: true }),
  ])
  return { tenants: tenants ?? 0, users: users ?? 0 }
}

export default async function SuperAdminDashboard() {
  const stats = await getStats()

  const cards = [
    { label: 'Total Tenants', value: stats.tenants, icon: Building2, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: 'Total Users', value: stats.users, icon: Users, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: 'Active Features', value: '12', icon: Flag, color: 'text-violet-400', bg: 'bg-violet-500/10' },
    { label: 'Audit Events Today', value: '0', icon: ShieldCheck, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Platform Overview</h2>
        <p className="text-slate-400 mt-1">Monitor all tenants and system health</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => {
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">Recent Tenants</h3>
          <p className="text-slate-500 text-sm">No tenants yet. Create the first university.</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">System Status</h3>
          <div className="space-y-3">
            {['Database', 'Auth', 'Storage', 'Realtime'].map((service) => (
              <div key={service} className="flex items-center justify-between">
                <span className="text-slate-300 text-sm">{service}</span>
                <span className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Operational
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
