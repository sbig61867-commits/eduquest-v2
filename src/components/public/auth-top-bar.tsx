'use client'

import Link from 'next/link'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import type { Locale } from '@/i18n/config'
import { writeLocaleCookie } from '@/components/shared/locale-switcher'
import { LocaleToggle } from './locale-toggle'
import { ThemeToggle } from './theme-toggle'
import { BrandMark } from '@/components/shared/brand-mark'

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
      <Link href="/" dir="ltr" className="eq-brand flex items-center gap-2.5">
        <BrandMark size={36} />
        <span className="text-white font-bold text-lg">EduQuest</span>
      </Link>
      <div className={`flex items-center gap-2 ${switching ? 'opacity-60' : ''}`}>
        <ThemeToggle />
        <LocaleToggle active={locale} onPick={pickLocale} />
      </div>
    </div>
  )
}
