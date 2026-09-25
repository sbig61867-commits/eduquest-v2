import type { Metadata } from 'next'
import { Geist, IBM_Plex_Sans_Arabic } from 'next/font/google'
import { getLocale, getTranslations } from 'next-intl/server'
import { AuthProvider } from '@/components/shared/auth-provider'
import { Toaster } from '@/components/ui/toast'
import { dirFor, toLocale } from '@/i18n/config'
import { ScopedIntlProvider } from '@/i18n/provider'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })

// Arabic glyphs only (subset 'arabic' ships a unicode-range limited to the
// Arabic block). Listed first in the body font stack, it renders Arabic text
// while Latin characters fall through to Arial unchanged — so the existing
// look of English text is untouched. adjustFontFallback is off because the
// generated metric-adjusted fallback face has no unicode-range and would
// otherwise resize Latin text too.
const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-arabic',
  adjustFontFallback: false,
  display: 'swap',
})

// Resolved per request: a static `metadata` export is evaluated once and
// would pin the browser tab title to one language for every visitor.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common.meta')
  return { title: t('title'), description: t('description') }
}

// `lang` and `dir` are derived from the resolved locale — neither is hardcoded
// any more. The locale comes from the eq_locale cookie (set once in
// src/proxy.ts from the user → tenant → platform chain); absent a cookie it is
// the platform default, which on this branch is `ar`, so the rendered output
// is byte-identical to the previous hardcoded version until a locale is
// actually chosen. One shared tree — there is no second layout per language.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = toLocale(await getLocale())

  return (
    <html
      lang={locale}
      dir={dirFor(locale)}
      className={`${geist.variable} ${plexArabic.variable} h-full`}
      suppressHydrationWarning
      translate="no"
    >
      <body className="h-full bg-slate-950 antialiased">
        {/* C1: `common` and `auth` are shipped at root level. Every page sits
            under this provider; `auth` is shared across public auth routes
            (login, join, reset-password, forgot-password). Route-specific
            namespaces belong on a route-group provider — see
            src/app/(admin)/layout.tsx. */}
        <ScopedIntlProvider namespaces={['common', 'auth']}>
          <AuthProvider>{children}</AuthProvider>
          <Toaster />
        </ScopedIntlProvider>
      </body>
    </html>
  )
}
