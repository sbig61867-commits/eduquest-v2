export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { PageTitle } from '@/components/shared/page-title'

interface TenantUsageRow {
  tenant_id: string
  tenant_name: string
  total_calls: number
  last_used_at: string | null
  by_feature: Record<string, number>
}

const FEATURE_LABEL: Record<string, string> = {
  lesson: 'Lessons',
  exam: 'Exams',
  'course-pptx': 'Courses',
  'homework-from-file': 'Homework (file)',
  'lesson-from-file': 'Lessons (file)',
}

export default async function AiUsagePage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'super_admin') redirect('/login')

  // get_tenant_ai_usage() is SECURITY DEFINER, gated to super_admin —
  // see supabase/ai_usage_log_migration.sql.
  const { data, error } = await supabase.rpc('get_tenant_ai_usage')
  const rows = (data ?? []) as TenantUsageRow[]
  const totalCalls = rows.reduce((sum, r) => sum + r.total_calls, 0)

  return (
    <>
      <PageTitle title="AI Usage" />
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="mb-8">
          <h1 className="text-xl font-semibold text-fg">AI Usage</h1>
          <p className="text-fg-muted text-sm mt-1">How much each tenant is consuming from the AI generation chain (lessons, exams, courses).</p>
        </div>

        {error ? (
          <div className="bg-error-subtle border border-error/20 rounded-lg p-5 text-sm text-error">
            Could not load usage data, run <code className="font-mono">supabase/ai_usage_log_migration.sql</code> on the database first.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-6 pb-7 border-b border-border">
              <div>
                <p className="text-2xl font-semibold text-fg leading-none">{totalCalls}</p>
                <p className="flex items-center gap-1.5 text-[12px] text-fg-muted mt-1">
                  <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                  Total AI calls
                </p>
              </div>
              <div className="w-px h-8 bg-border" aria-hidden="true" />
              <div>
                <p className="text-2xl font-semibold text-fg leading-none">{rows.filter(r => r.total_calls > 0).length}</p>
                <p className="text-[12px] text-fg-muted mt-1">Active tenants</p>
              </div>
            </div>

            <div className="bg-surface border border-border rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h2 className="text-sm font-semibold text-fg">Usage by Tenant</h2>
              </div>
              {rows.length === 0 ? (
                <p className="text-fg-muted text-sm p-5">No tenants yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-start px-5 py-2.5 text-xs font-medium text-fg-muted">Institution</th>
                        <th className="text-start px-5 py-2.5 text-xs font-medium text-fg-muted">Breakdown</th>
                        <th className="text-end px-5 py-2.5 text-xs font-medium text-fg-muted">Total calls</th>
                        <th className="text-end px-5 py-2.5 text-xs font-medium text-fg-muted">Last used</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map(r => (
                        <tr key={r.tenant_id} className="hover:bg-canvas transition-colors">
                          <td className="px-5 py-3">
                            <span className="font-medium text-fg">{r.tenant_name}</span>
                          </td>
                          <td className="px-5 py-3 text-fg-muted text-xs">
                            {Object.keys(r.by_feature ?? {}).length === 0
                              ? '·'
                              : Object.entries(r.by_feature).map(([f, n]) => `${FEATURE_LABEL[f] ?? f}: ${n}`).join(' · ')}
                          </td>
                          <td className="px-5 py-3 text-end font-medium text-fg">{r.total_calls}</td>
                          <td className="px-5 py-3 text-end text-fg-muted">{r.last_used_at ? formatDate(r.last_used_at) : '·'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
