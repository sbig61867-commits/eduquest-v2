import { Sidebar } from '@/components/shared/sidebar'
import { resolveNav } from '@/lib/navigation'
import { Header } from '@/components/shared/header'
import { ContentShell } from '@/components/shared/content-shell'
import { TenantWatcher } from '@/components/shared/tenant-watcher'
import { ScopedIntlProvider } from '@/i18n/provider'
import { getTranslations } from 'next-intl/server'
import { AuthProvider } from '@/components/shared/auth-provider'


// C1 in practice: this subtree gets `common` + `admin` and nothing else. The
// teacher and student dictionaries are never serialized into an /admin page.
// The remaining route groups adopt this same wrapper when their strings are
// extracted — Phase 0b deliberately proves the pattern on one group rather
// than touching all five.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('admin')
  const nav = resolveNav('admin', t)
  return (
    <ScopedIntlProvider namespaces={['common', 'terms', 'admin', 'staff']}>
      <AuthProvider>
      <div className="min-h-screen bg-slate-950">
        <TenantWatcher />
        <Sidebar nav={nav} title={t('sidebarTitle')} titleTerm="institutionAdmin" />
        <ContentShell>
          <Header nav={nav} />
          <main className="p-4 lg:p-6">{children}</main>
        </ContentShell>
      </div>
    </AuthProvider>
    </ScopedIntlProvider>
  )
}
