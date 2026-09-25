'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { writeLocaleCookie } from '@/components/shared/locale-switcher'
import { Languages } from 'lucide-react'
import { pricingEnabled } from '@/lib/pricing/plans'

export type Lang = 'ar' | 'en'

// Language state for the public (pre-login) pages.
//
// This used to be a second, parallel language system — its own
// `public-lang` localStorage key, its own default, applied only after
// hydration — so a visitor who chose English here signed in and landed in
// whatever `eq_locale` said, and every public page flashed Arabic first.
//
// It now reads and writes `eq_locale`, the same cookie the app shell and the
// server render from: one choice, carried across sign-in, rendered correctly
// on the first byte. The `[lang, setLang]` signature is kept so the pages'
// existing `lang === 'ar' ? … : …` copy keeps working unchanged.
//
// Those inline ternaries are still hardcoded copy, not message files — these
// files stay in the i18n ratchet backlog until that is extracted. Nothing here
// hides that.
export function useLang(): [Lang, (l: Lang) => void] {
  const lang = useLocale() as Lang
  const router = useRouter()
  const setLang = (l: Lang) => {
    if (l === lang) return
    writeLocaleCookie(l)
    router.refresh()
  }
  return [lang, setLang]
}

export function PublicNav({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  const t = lang === 'ar'
    ? { login: 'تسجيل الدخول', toggle: 'English', features: 'المميزات', pricing: 'الأسعار', contact: 'تواصل معنا' }
    : { login: 'Sign In', toggle: 'العربية', features: 'Features', pricing: 'Pricing', contact: 'Contact' }
  return (
    <nav className="sticky top-0 z-20 bg-slate-950/80 backdrop-blur border-b border-slate-800">
      <div className="max-w-6xl mx-auto px-2 sm:px-6 h-16 flex items-center justify-between gap-1">
        <div className="flex items-center gap-0.5 sm:gap-6 min-w-0">
          <Link href="/" className="flex items-center gap-2.5 shrink-0 px-1">
            <span className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold text-lg shrink-0">E</span>
            <span className="text-white font-bold text-lg hidden md:inline">EduQuest</span>
          </Link>
          <div className="flex items-center gap-0.5 sm:gap-2">
            <Link href="/features" className="px-1.5 sm:px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 text-sm transition-colors whitespace-nowrap">
              {t.features}
            </Link>
            {pricingEnabled && (
              <Link href="/pricing" className="px-1.5 sm:px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 text-sm transition-colors whitespace-nowrap">
                {t.pricing}
              </Link>
            )}
            <Link href="/contact" className="px-1.5 sm:px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 text-sm transition-colors whitespace-nowrap">
              {t.contact}
            </Link>
          </div>
        </div>
        <div className="flex items-center gap-0.5 sm:gap-3 shrink-0">
          <button
            onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
            className="flex items-center gap-1.5 px-1.5 sm:px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 text-sm transition-colors whitespace-nowrap"
            aria-label={t.toggle}
          >
            <Languages className="w-4 h-4" /> <span className="hidden lg:inline">{t.toggle}</span>
          </button>
          <Link
            href="/login"
            className="px-2.5 sm:px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors whitespace-nowrap"
          >
            {t.login}
          </Link>
        </div>
      </div>
    </nav>
  )
}

export function PublicFooter({ lang }: { lang: Lang }) {
  const t = lang === 'ar'
    ? { rights: 'جميع الحقوق محفوظة', pricing: 'الأسعار', privacy: 'سياسة الخصوصية', terms: 'شروط الاستخدام', contact: 'تواصل معنا' }
    : { rights: 'All rights reserved', pricing: 'Pricing', privacy: 'Privacy Policy', terms: 'Terms of Use', contact: 'Contact Us' }
  return (
    <footer className="border-t border-slate-800 mt-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-slate-400 text-sm">© {new Date().getFullYear()} EduQuest — {t.rights}</p>
        <div className="flex items-center gap-5 text-sm">
          {pricingEnabled && <Link href="/pricing" className="text-slate-400 hover:text-white transition-colors">{t.pricing}</Link>}
          <Link href="/privacy" className="text-slate-400 hover:text-white transition-colors">{t.privacy}</Link>
          <Link href="/terms" className="text-slate-400 hover:text-white transition-colors">{t.terms}</Link>
          <Link href="/contact" className="text-slate-400 hover:text-white transition-colors">{t.contact}</Link>
        </div>
      </div>
    </footer>
  )
}
