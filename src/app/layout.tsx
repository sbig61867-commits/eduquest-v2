import type { Metadata } from 'next'
import { Geist, IBM_Plex_Sans_Arabic } from 'next/font/google'
import { AuthProvider } from '@/components/shared/auth-provider'
import { Toaster } from '@/components/ui/toast'
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

export const metadata: Metadata = {
  title: 'EduQuest — Educational SaaS Platform',
  description: 'Multi-tenant educational platform with AI-powered learning tools',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${plexArabic.variable} h-full`} suppressHydrationWarning translate="no">
      <body className="h-full bg-slate-950 antialiased">
        <AuthProvider>{children}</AuthProvider>
        <Toaster />
      </body>
    </html>
  )
}
