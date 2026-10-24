export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { getTranslations, getLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/config'
import Link from 'next/link'
import { Building2, Users, Flag, ShieldCheck } from 'lucide-react'
import { formatDate } from '@/lib/utils'

interface TenantRow { id: string; name: string; created_at: string }

async function getStats(userId: string) {
  const [rows] = await run({ as: 'user', userId }, sql => [
    sql`select (select count(*)::int from public.tenants) as tenants,
               (select count(*)::int from public.users) as users,
               coalesce((select json_agg(x) from (select id, name, created_at from public.tenants
                          order by created_at desc limit 5) x), '[]') as recent`,
  ])
  const r = rows[0] as { tenants: number; users: number; recent: TenantRow[] }
  return { tenants: r.tenants, users: r.users, recentTenants: r.recent }
}

const SERVICES = ['database', 'auth', 'storage', 'realtime'] as const

export default async function SuperAdminDashboard() {
  const user = await currentUser()
  if (!user) redirect('/login')
  const [stats, t, locale] = await Promise.all([
    getStats(user.id),
    getTranslations('superAdmin.dashboard'),
    getLocale() as Promise<Locale>,
  ])

  const cards = [
    { label: t('cards.tenants'), value: stats.tenants, icon: Building2, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: t('cards.users'), value: stats.users, icon: Users, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: t('cards.features'), value: '12', icon: Flag, color: 'text-violet-400', bg: 'bg-violet-500/10' },
    { label: t('cards.auditToday'), value: '0', icon: ShieldCheck, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">{t('title')}</h2>
        <p className="text-slate-400 mt-1">{t('subtitle')}</p>
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
          <h3 className="text-white font-semibold mb-4">{t('recentTenants')}</h3>
          {stats.recentTenants.length === 0 ? (
            <p className="text-slate-500 text-sm">{t('noTenants')}</p>
          ) : (
            <ul className="space-y-3">
              {stats.recentTenants.map(tenant => (
                <li key={tenant.id}>
                  <Link href="/super-admin/tenants" className="flex items-center gap-3 group">
                    <div className="w-8 h-8 rounded-lg bg-blue-600/20 flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4 text-blue-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-white text-sm font-medium truncate group-hover:text-blue-400 transition-colors">{tenant.name}</p>
                      <p className="text-slate-500 text-xs">{formatDate(tenant.created_at, locale)}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">{t('systemStatus')}</h3>
          <div className="space-y-3">
            {SERVICES.map((service) => (
              <div key={service} className="flex items-center justify-between">
                <span className="text-slate-300 text-sm">{t(`services.${service}`)}</span>
                <span className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {t('operational')}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
