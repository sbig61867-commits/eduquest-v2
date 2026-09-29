'use client'

import Link from 'next/link'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import type { Locale } from '@/i18n/config'
import { writeLocaleCookie } from '@/components/shared/locale-switcher'
import { LocaleToggle } from './locale-toggle'
import { ThemeToggle } from './theme-toggle'

// Header of the signed-out pages (sign-in, recovery, invitation): the brand on
// one side, appearance and language on the other. Language switches in place
// (cookie + refresh) because these pages have no per-language URL.
export function AuthTopBar({ className = '' }: { className?: string }) {
  const locale = useLocale() as Locale
  const router = useRouter()
  const [switching, startTransition] = useTransition()

  function pickLocale(next: Locale) {
    writeLocaleCookie(next)
    startTransition(() => router.refresh())
  }

  return (
    <div className={`relative flex items-center justify-between gap-3 ${className}`}>
      <Link href="/" dir="ltr" className="flex items-center gap-2.5">
        <span aria-hidden="true" className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-on-accent font-bold text-lg">E</span>
        <span className="text-white font-bold text-lg">EduQuest</span>
      </Link>
      <div className={`flex items-center gap-2 ${switching ? 'opacity-60' : ''}`}>
        <ThemeToggle />
        <LocaleToggle active={locale} onPick={pickLocale} />
      </div>
    </div>
  )
}
