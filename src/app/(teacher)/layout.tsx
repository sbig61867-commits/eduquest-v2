import { Sidebar } from '@/components/shared/sidebar'
import { resolveNav } from '@/lib/navigation'
import { Header } from '@/components/shared/header'
import { ContentShell } from '@/components/shared/content-shell'
import { TenantWatcher } from '@/components/shared/tenant-watcher'
import { getTranslations } from 'next-intl/server'
import { ScopedIntlProvider } from '@/i18n/provider'
import { AuthProvider } from '@/components/shared/auth-provider'

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('teacher')
  const nav = resolveNav('teacher', t)
  return (
    <ScopedIntlProvider namespaces={['common', 'teacher', 'terms']}>
      <AuthProvider>
      <div className="min-h-screen bg-slate-950">
        <TenantWatcher />
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
