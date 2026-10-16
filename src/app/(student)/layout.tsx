import { getTranslations } from 'next-intl/server'

import { Sidebar } from '@/components/shared/sidebar'
import { resolveNav } from '@/lib/navigation'
import { Header } from '@/components/shared/header'
import { ContentShell } from '@/components/shared/content-shell'
import { TenantWatcher } from '@/components/shared/tenant-watcher'
import { StudentQuickAccessPanel } from '@/components/student/quick-access-panel'
import { AnnouncementPopup } from '@/components/student/announcement-popup'
import { ScopedIntlProvider } from '@/i18n/provider'
import { AuthProvider } from '@/components/shared/auth-provider'
import { AssistantOrb } from '@/components/assistant/assistant-orb'
import { audienceApproved } from '@/lib/ai/privacy'

// The nav is built per request from the `student` namespace rather than held
// in a module-level constant: a constant is evaluated once at import time,
// which would freeze whichever locale happened to render first and serve it
// to everyone.
export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('student')

  const nav = resolveNav('student', t)

  return (
    <ScopedIntlProvider namespaces={['common', 'student', 'terms']}>
      <AuthProvider>
      <div className="min-h-screen bg-slate-950">
        <TenantWatcher />
        <Sidebar nav={nav} title={t('roleTitle')} centreTraineeTitle={t('centreTraineeTitle')} />
        <ContentShell>
          <Header nav={nav} />
          <main className="p-4 lg:p-6">{children}</main>
        </ContentShell>
        <StudentQuickAccessPanel />
        <AnnouncementPopup />
        {/* Study assistant on every student page. Free questions (Ask) need a provider
            approved for personal content; nudges, the plan and summaries do not. */}
        <AssistantOrb chatEnabled={audienceApproved(['personal'])} />
      </div>
    </AuthProvider>
    </ScopedIntlProvider>
  )
}
