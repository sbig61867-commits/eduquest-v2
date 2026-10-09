import { Sidebar } from '@/components/shared/sidebar'
import { resolveNav } from '@/lib/navigation'
import { Header } from '@/components/shared/header'
import { ContentShell } from '@/components/shared/content-shell'
import { TenantWatcher } from '@/components/shared/tenant-watcher'
import { ScopedIntlProvider } from '@/i18n/provider'
import { getTranslations } from 'next-intl/server'
import { AuthProvider } from '@/components/shared/auth-provider'

// Continuing-education centre manager / admin assistant. What they can
// actually do is governed per-user by `users.permissions` (see
// src/lib/permissions.ts) — the admin grants each capability explicitly.
export default async function CenterLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('center')
  const nav = resolveNav('center', t)
  return (
    <ScopedIntlProvider namespaces={['common', 'terms', 'center', 'staff']}>
      <AuthProvider>
      <div className="min-h-screen bg-slate-950">
        <TenantWatcher />
        <Sidebar nav={nav} title={t('sidebarTitle')} titleTerm="centerManager" />
        <ContentShell>
          <Header nav={nav} />
          <main className="p-4 lg:p-6">{children}</main>
        </ContentShell>
      </div>
    </AuthProvider>
    </ScopedIntlProvider>
  )
}
