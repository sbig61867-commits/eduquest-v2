import { ScopedIntlProvider } from '@/i18n/provider'

// The root provider ships only `common` + `auth` to the browser. The demo's
// client pieces (the shell, the dashboards) read `public.demo`, so it is
// scoped in here rather than added to every page of the app.
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <ScopedIntlProvider namespaces={['common', 'public']}>{children}</ScopedIntlProvider>
}
