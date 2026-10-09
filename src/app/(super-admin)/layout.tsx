import { Sidebar } from '@/components/shared/sidebar'
import { resolveNav } from '@/lib/navigation'
import { Header } from '@/components/shared/header'
import { ContentShell } from '@/components/shared/content-shell'
import { ScopedIntlProvider } from '@/i18n/provider'
import { getTranslations } from 'next-intl/server'
import { AuthProvider } from '@/components/shared/auth-provider'

// `staff` rides along because the invitations page and the permissions editor
// are the shared staff components, rendered here for the platform owner.
export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('superAdmin')
  const nav = resolveNav('superAdmin', t)
  return (
    <ScopedIntlProvider namespaces={['common', 'terms', 'superAdmin', 'staff']}>
      <AuthProvider>
      <div className="min-h-screen bg-slate-950">
        <Sidebar nav={nav} title={t('sidebarTitle')} />
        <ContentShell>
          <Header nav={nav} />
          <main className="p-4 lg:p-6">{children}</main>
        </ContentShell>
      </div>
    </AuthProvider>
    </ScopedIntlProvider>
  )
}
