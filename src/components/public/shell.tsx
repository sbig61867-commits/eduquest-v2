'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'

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
    ? { login: 'تسجيل الدخول', features: 'المميزات', contact: 'تواصل معنا' }
    : { login: 'Sign In', features: 'Features', contact: 'Contact' }
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  return (
    <nav className="sticky top-0 z-20 bg-white/95 backdrop-blur-sm border-b border-[#ebdde2] shadow-[0_1px_8px_rgba(11,54,88,0.06)]">
      <div className="max-w-6xl mx-auto px-2 sm:px-6 h-16 flex items-center justify-between gap-1">
        <div className="flex items-center gap-0.5 sm:gap-6 min-w-0">
          <Link href="/" className="flex items-center gap-2.5 shrink-0 px-1">
            <span className="w-9 h-9 rounded-[12px] bg-[#062045] flex items-center justify-center text-white font-black text-lg shrink-0">E</span>
            <span className="text-[#062045] font-black text-lg hidden md:inline" style={{letterSpacing: '-0.01em'}}>EduQuest</span>
          </Link>
          <div className="flex items-center gap-0.5 sm:gap-2">
            <Link href="/features" className="px-1.5 sm:px-3 py-2 rounded-lg text-[#3b4e66] hover:text-[#062045] hover:bg-[#f9e9ed] text-sm font-medium transition-colors whitespace-nowrap">
              {t.features}
            </Link>
            <Link href="/contact" className="px-1.5 sm:px-3 py-2 rounded-lg text-[#3b4e66] hover:text-[#062045] hover:bg-[#f9e9ed] text-sm font-medium transition-colors whitespace-nowrap">
              {t.contact}
            </Link>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Language dropdown */}
          <div ref={ref} className="relative">
            <button
              onClick={() => setOpen(o => !o)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#ebdde2] text-[#3b4e66] hover:border-[#dcc7ce] hover:text-[#062045] text-sm font-semibold transition-colors"
            >
              {lang === 'ar' ? 'AR' : 'EN'}
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
              <div className="absolute top-full mt-1.5 end-0 bg-white border border-[#ebdde2] rounded-[12px] shadow-[0_8px_24px_rgba(11,54,88,0.10)] overflow-hidden min-w-[96px] z-50">
                {(['ar', 'en'] as Lang[]).map(l => (
                  <button
                    key={l}
                    onClick={() => { setLang(l); setOpen(false) }}
                    className={`w-full text-start px-4 py-2.5 text-sm font-medium transition-colors ${lang === l ? 'bg-[#f9e9ed] text-[#062045]' : 'text-[#3b4e66] hover:bg-[#fbf3f5] hover:text-[#062045]'}`}
                  >
                    {l === 'ar' ? 'العربية' : 'English'}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Link
            href="/login"
            className="px-2.5 sm:px-4 py-2 rounded-[20px] bg-[#062045] hover:bg-[#0c3468] text-white text-sm font-semibold transition-colors whitespace-nowrap shadow-[0_2px_8px_rgba(78,154,217,0.25)]"
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
    ? { rights: 'جميع الحقوق محفوظة', privacy: 'سياسة الخصوصية', terms: 'شروط الاستخدام', cookies: 'سياسة الكوكيز', pricing: 'الأسعار', contact: 'تواصل معنا' }
    : { rights: 'All rights reserved', privacy: 'Privacy Policy', terms: 'Terms of Use', cookies: 'Cookie Policy', pricing: 'Pricing', contact: 'Contact Us' }
  return (
    <footer className="border-t border-[#ebdde2] bg-[#fbf3f5] mt-0">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-[#5f6e85] text-sm">© {new Date().getFullYear()} EduQuest · {t.rights}</p>
        <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-5 text-sm">
          <Link href="/pricing" className="text-[#3b4e66] hover:text-[#062045] transition-colors">{t.pricing}</Link>
          <Link href="/privacy" className="text-[#3b4e66] hover:text-[#062045] transition-colors">{t.privacy}</Link>
          <Link href="/terms" className="text-[#3b4e66] hover:text-[#062045] transition-colors">{t.terms}</Link>
          <Link href="/cookies" className="text-[#3b4e66] hover:text-[#062045] transition-colors">{t.cookies}</Link>
          <Link href="/contact" className="text-[#3b4e66] hover:text-[#062045] transition-colors">{t.contact}</Link>
        </div>
      </div>
    </footer>
  )
}
