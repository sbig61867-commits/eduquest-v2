export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { PageTitle } from '@/components/shared/page-title'
import { getTranslations, getLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/config'

interface TenantUsageRow {
  tenant_id: string
  tenant_name: string
  total_calls: number
  last_used_at: string | null
  by_feature: Record<string, number>
}

// Known feature keys have a label in superAdmin.aiUsage.features; an
// unknown key (a feature added later) shows its raw id rather than breaking.
const KNOWN_FEATURES = new Set(['lesson', 'exam', 'course-pptx', 'homework-from-file', 'lesson-from-file'])

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
  const [t, locale] = await Promise.all([getTranslations('superAdmin.aiUsage'), getLocale() as Promise<Locale>])
  const featureLabel = (f: string) => (KNOWN_FEATURES.has(f) ? t(`features.${f}`) : f)

  return (
    <>
      <PageTitle title={t('title')} />
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="mb-8">
          <h1 className="text-xl font-semibold text-fg">{t('title')}</h1>
          <p className="text-fg-muted text-sm mt-1">{t('subtitle')}</p>
        </div>

        {error ? (
          <div className="bg-error-subtle border border-error/20 rounded-lg p-5 text-sm text-error">
            {t.rich('loadError', { code: chunks => <code className="font-mono">{chunks}</code> })}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-6 pb-7 border-b border-border">
              <div>
                <p className="text-2xl font-semibold text-fg leading-none">{totalCalls}</p>
                <p className="flex items-center gap-1.5 text-[12px] text-fg-muted mt-1">
                  <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('totalCalls')}
                </p>
              </div>
              <div className="w-px h-8 bg-border" aria-hidden="true" />
              <div>
                <p className="text-2xl font-semibold text-fg leading-none">{rows.filter(r => r.total_calls > 0).length}</p>
                <p className="text-[12px] text-fg-muted mt-1">{t('activeTenants')}</p>
              </div>
            </div>

            <div className="bg-surface border border-border rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h2 className="text-sm font-semibold text-fg">{t('byTenant')}</h2>
              </div>
              {rows.length === 0 ? (
                <p className="text-fg-muted text-sm p-5">{t('noTenants')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-start px-5 py-2.5 text-xs font-medium text-fg-muted">{t('columns.tenant')}</th>
                        <th className="text-start px-5 py-2.5 text-xs font-medium text-fg-muted">{t('columns.breakdown')}</th>
                        <th className="text-end px-5 py-2.5 text-xs font-medium text-fg-muted">{t('columns.total')}</th>
                        <th className="text-end px-5 py-2.5 text-xs font-medium text-fg-muted">{t('columns.lastUsed')}</th>
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
                              : Object.entries(r.by_feature).map(([f, n]) => `${featureLabel(f)}: ${n}`).join(' · ')}
                          </td>
                          <td className="px-5 py-3 text-end font-medium text-fg">{r.total_calls}</td>
                          <td className="px-5 py-3 text-end text-fg-muted">{r.last_used_at ? formatDate(r.last_used_at, locale) : '·'}</td>
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
