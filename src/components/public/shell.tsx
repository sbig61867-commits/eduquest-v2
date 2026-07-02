'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Languages } from 'lucide-react'

export type Lang = 'ar' | 'en'

// Shared language state for the public (pre-login) pages, persisted so the
// choice survives navigation between landing / privacy / terms.
export function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang>('ar')
  useEffect(() => {
    // Intentional one-time post-hydration sync: the server always renders 'ar'
    // (no access to localStorage), so the saved choice must be applied after
    // mount — a hydration-safe pattern, not a cascading-render bug.
    const saved = localStorage.getItem('public-lang')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === 'en') setLangState('en')
  }, [])
  const setLang = (l: Lang) => {
    setLangState(l)
    localStorage.setItem('public-lang', l)
  }
  return [lang, setLang]
}

export function PublicNav({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  const t = lang === 'ar'
    ? { login: 'تسجيل الدخول', toggle: 'English' }
    : { login: 'Sign In', toggle: 'العربية' }
  return (
    <nav className="sticky top-0 z-20 bg-slate-950/80 backdrop-blur border-b border-slate-800">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold text-lg shrink-0">E</span>
          <span className="text-white font-bold text-lg hidden min-[400px]:inline">EduQuest</span>
        </Link>
        <div className="flex items-center gap-1 sm:gap-3 shrink-0">
          <button
            onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
            className="flex items-center gap-1.5 px-2 sm:px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 text-sm transition-colors whitespace-nowrap"
          >
            <Languages className="w-4 h-4" /> {t.toggle}
          </button>
          <Link
            href="/login"
            className="px-3 sm:px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors whitespace-nowrap"
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
    ? { rights: 'جميع الحقوق محفوظة', privacy: 'سياسة الخصوصية', terms: 'شروط الاستخدام', contact: 'تواصل معنا' }
    : { rights: 'All rights reserved', privacy: 'Privacy Policy', terms: 'Terms of Use', contact: 'Contact Us' }
  return (
    <footer className="border-t border-slate-800 mt-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-slate-500 text-sm">© {new Date().getFullYear()} EduQuest — {t.rights}</p>
        <div className="flex items-center gap-5 text-sm">
          <Link href="/privacy" className="text-slate-400 hover:text-white transition-colors">{t.privacy}</Link>
          <Link href="/terms" className="text-slate-400 hover:text-white transition-colors">{t.terms}</Link>
          <a href="mailto:sbig61867@gmail.com" className="text-slate-400 hover:text-white transition-colors">{t.contact}</a>
        </div>
      </div>
    </footer>
  )
}
