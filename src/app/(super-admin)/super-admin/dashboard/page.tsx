export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Building2, Users } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { PageTitle } from '@/components/shared/page-title'

interface TenantRow { id: string; name: string; created_at: string }

async function getStats() {
  const supabase = await createClient()
  const [{ data: recentTenants, count: tenants }, { count: users }] = await Promise.all([
    supabase.from('tenants').select('id, name, created_at', { count: 'exact' }).order('created_at', { ascending: false }).limit(20),
    supabase.from('users').select('*', { count: 'exact', head: true }),
  ])
  return { tenants: tenants ?? 0, users: users ?? 0, recentTenants: (recentTenants ?? []) as TenantRow[] }
}

export default async function SuperAdminDashboard() {
  const stats = await getStats()

  return (
    <>
      <PageTitle title="Platform Overview" />
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-fg">Platform Overview</h1>
      </div>

      {/* Slim aggregate strip — text-only */}
      <div className="flex items-center gap-6 pb-7 border-b border-border">
        <div>
          <p className="text-2xl font-semibold text-fg leading-none">{stats.tenants}</p>
          <p className="flex items-center gap-1.5 text-[12px] text-fg-muted mt-1">
            <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
            Tenants
          </p>
        </div>
        <div className="w-px h-8 bg-border" aria-hidden="true" />
        <div>
          <p className="text-2xl font-semibold text-fg leading-none">{stats.users}</p>
          <p className="flex items-center gap-1.5 text-[12px] text-fg-muted mt-1">
            <Users className="w-3.5 h-3.5" aria-hidden="true" />
            Users
          </p>
        </div>
      </div>

      {/* Tenant fleet table */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-fg">Tenant Fleet</h2>
          <Link href="/super-admin/tenants" className="text-xs text-accent hover:text-accent-hover transition-colors">Manage tenants</Link>
        </div>
        {stats.recentTenants.length === 0 ? (
          <p className="text-fg-muted text-sm p-5">No tenants yet. Create the first university.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-start px-5 py-2.5 text-xs font-medium text-fg-muted">Institution</th>
                  <th className="text-start px-5 py-2.5 text-xs font-medium text-fg-muted">Created</th>
                  <th className="text-end px-5 py-2.5 text-xs font-medium text-fg-muted">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {stats.recentTenants.map(t => (
                  <tr key={t.id} className="hover:bg-canvas transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-md bg-accent-subtle flex items-center justify-center shrink-0">
                          <Building2 className="w-3.5 h-3.5 text-accent" />
                        </div>
                        <span className="font-medium text-fg">{t.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-fg-muted">{formatDate(t.created_at)}</td>
                    <td className="px-5 py-3 text-end">
                      <Link href="/super-admin/tenants" className="text-xs text-accent hover:text-accent-hover transition-colors">View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
    </>
  )
}
