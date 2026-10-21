import type { Metadata } from 'next'
import { IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from 'next/font/google'
import { getLocale, getTranslations } from 'next-intl/server'
import { Toaster } from '@/components/ui/toast'
import { dirFor, toLocale } from '@/i18n/config'
import { ScopedIntlProvider } from '@/i18n/provider'
import { siteUrl } from '@/i18n/public-routes'
import { THEME_BOOT_SCRIPT } from '@/lib/theme'
import './globals.css'

// Geist used to be loaded here too, preloaded on every page, yet nothing ever
// rendered with it (its variable was --font-geist while globals.css asked for
// --font-geist-sans): a wasted font download per page. Removed 2026-09-29.
// Arabic glyphs only (subset 'arabic' ships a unicode-range limited to the
// Arabic block). Listed first in the body font stack, it renders Arabic text
// while Latin characters fall through to --font-latin below. adjustFontFallback is off because the
// generated metric-adjusted fallback face has no unicode-range and would
// otherwise resize Latin text too.
const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-arabic',
  adjustFontFallback: false,
  display: 'swap',
})

// Latin text and digits (D3 design tokens, 2026-10-06): the Latin companion of
// Plex Arabic, replacing the Arial fallback. Second in the body font stack, so
// Arabic glyphs still come from --font-arabic.
const plexLatin = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-latin',
  display: 'swap',
})

// D3.1: the body stack names each family WITHOUT its generated fallback. Under
// Turbopack, next/font emits "IBM Plex Sans Arabic Fallback" (local Arial, no
// unicode-range) even with adjustFontFallback: false, and inside --font-arabic
// it sat before Plex Sans and caught every Latin letter and digit. The first
// name of each generated family is exposed as --font-arabic-face /
// --font-latin-face; Arial stays the last fallback (globals.css).
const firstFamily = (stack: string) => stack.split(',')[0].trim()
const fontFaceVars = {
  '--font-arabic-face': firstFamily(plexArabic.style.fontFamily),
  '--font-latin-face': firstFamily(plexLatin.style.fontFamily),
} as React.CSSProperties

// Resolved per request: a static `metadata` export is evaluated once and
// would pin the browser tab title to one language for every visitor.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common.meta')
  // metadataBase turns the marketing pages' relative canonical/hreflang URLs
  // (src/i18n/public-routes.ts) into absolute ones.
  return { metadataBase: new URL(siteUrl()), title: t('title'), description: t('description') }
}

// `lang` and `dir` are derived from the resolved locale — neither is hardcoded
// any more. The locale comes from the eq_locale cookie (set once in
// src/proxy.ts from the user → tenant → platform chain) or, on a
// /<locale>/ marketing URL, from the URL itself; absent both it is the
// platform default (DEFAULT_LOCALE). One shared tree — there is no second
// layout per language.
const SUPABASE_ORIGIN = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin } catch { return '' }
})()

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = toLocale(await getLocale())

  return (
    <html
      lang={locale}
      dir={dirFor(locale)}
      className={`${plexArabic.variable} ${plexLatin.variable} h-full`}
      style={fontFaceVars}
      suppressHydrationWarning
      translate="no"
    >
      <head>
        {/* Light/dark choice for the public surface, applied before first paint
            from the eq_theme cookie in the browser — never read on the server,
            so public HTML stays cacheable (src/lib/theme.ts). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        {/* Open the TLS connection to Supabase while the page loads, so the
            first auth/data request does not pay the handshake's round trips
            (each costs 0.3–0.8 s on high-latency networks). A hint only:
            no request, no cookie, public HTML stays cacheable. */}
        {SUPABASE_ORIGIN && <link rel="preconnect" href={SUPABASE_ORIGIN} crossOrigin="anonymous" />}
      </head>
      <body className="h-full bg-slate-950 antialiased">
        {/* C1: `common` and `auth` are shipped at root level. Every page sits
            under this provider; `auth` is shared across public auth routes
            (login, join, reset-password, forgot-password). Route-specific
            namespaces belong on a route-group provider — see
            src/app/(admin)/layout.tsx. */}
        <ScopedIntlProvider namespaces={['common', 'auth']}>
          {/* No AuthProvider here: it pulls the Supabase client into every public
              page. Each signed-in route group mounts it (perf audit 2026-09-30). */}
          {children}
          <Toaster />
        </ScopedIntlProvider>
      </body>
    </html>
  )
}
