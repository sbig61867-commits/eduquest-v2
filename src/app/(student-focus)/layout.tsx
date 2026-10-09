import { ScopedIntlProvider } from '@/i18n/provider'
import { AuthProvider } from '@/components/shared/auth-provider'
import { TenantWatcher } from '@/components/shared/tenant-watcher'

// Student pages that must keep the reader on one thing — a lesson — so they
// carry no dashboard sidebar or header. Same providers as (student)/layout.tsx;
// the /student prefix keeps the proxy's role gate exactly as for the rest.
export default function StudentFocusLayout({ children }: { children: React.ReactNode }) {
  return (
    <ScopedIntlProvider namespaces={['common', 'student', 'terms']}>
      <AuthProvider>
        <div className="min-h-screen bg-canvas">
          <TenantWatcher />
          {children}
        </div>
      </AuthProvider>
    </ScopedIntlProvider>
  )
}
