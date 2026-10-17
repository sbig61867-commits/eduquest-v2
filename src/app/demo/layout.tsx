import { ScopedIntlProvider } from '@/i18n/provider'

// The root provider ships only `common` + `auth` to the browser. The demo's
// client pieces (the shell, the dashboards) read `public.demo`, so it is
// scoped in here rather than added to every page of the app. `.eq-public`
// gives the whole tour the public light/dark appearance (src/app/globals.css).
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <ScopedIntlProvider namespaces={['common', 'public']} only={{ public: ['shell', 'demo'] }}>
      <div className="eq-public">{children}</div>
    </ScopedIntlProvider>
  )
}
