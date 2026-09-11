export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Building2, Users } from 'lucide-react'
import { formatDate, settle } from '@/lib/utils'
import { PageTitle } from '@/components/shared/page-title'
import { AnimatedStat, StaggerGrid, StaggerItem } from '@/components/shared/motion'

interface TenantRow { id: string; name: string; created_at: string }

// One failed query must not cost the whole page — settle() logs the reason and
// resolves empty so the fallbacks below render a degraded dashboard instead of
// throwing the user out to the error boundary.
async function getStats() {
  const supabase = await createClient()

  const [tenantsResult, usersResult] = await Promise.all([
    settle(
      supabase
        .from('tenants')
        .select('id, name, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .limit(20),
      'super-admin/tenants'
    ),
    settle(supabase.from('users').select('id', { count: 'exact', head: true }), 'super-admin/users'),
  ])

  return {
    tenants: tenantsResult.count ?? 0,
    users: usersResult.count ?? 0,
    recentTenants: (tenantsResult.data ?? []) as TenantRow[],
    degraded: Boolean(tenantsResult.error) || Boolean(usersResult.error),
  }
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

      {stats.degraded && (
        <p className="bg-warning-subtle border border-warning/25 text-warning rounded-lg px-4 py-3 text-sm">
          Some platform figures could not be loaded just now. Refresh to try again.
        </p>
      )}

      {/* Aggregate strip */}
      <StaggerGrid className="grid grid-cols-2 gap-3 max-w-sm">
        <StaggerItem>
          <AnimatedStat icon={Building2} label="Tenants" value={String(stats.tenants)} />
        </StaggerItem>
        <StaggerItem>
          <AnimatedStat icon={Users} label="Users" value={String(stats.users)} />
        </StaggerItem>
      </StaggerGrid>

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
