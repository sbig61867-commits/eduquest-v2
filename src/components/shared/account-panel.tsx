'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import type { Locale } from '@/i18n/config'
import { getRoleLabel } from '@/lib/utils'
import type { Tenant, User } from '@/types'

/**
 * The signed-in account's own details, with the member ID it signs in with.
 * Used in the header's account menu and in the welcome window shown right
 * after registration.
 */
export function AccountPanel({ user, tenant }: { user: User; tenant: Tenant | null }) {
  const t = useTranslations('common.account')
  const locale = useLocale() as Locale
  const [copied, setCopied] = useState(false)
  const code = user.member_code
  // An account created by ID has no email; its email field holds the ID.
  const email = user.email && user.email !== code ? user.email : null

  const rows: { label: string; value: string }[] = [
    { label: t('name'), value: user.full_name },
    ...(email ? [{ label: t('email'), value: email }] : []),
    { label: t('role'), value: getRoleLabel(user.role, tenant?.institution_type, locale) },
    ...(tenant?.name ? [{ label: t('institution'), value: tenant.name }] : []),
  ]

  return (
    <div className="space-y-4">
      {code && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4">
          <p className="text-blue-300 text-xs font-semibold">{t('memberId')}</p>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-white text-xl font-mono font-bold flex-1" dir="ltr">{code}</p>
            <button
              type="button"
              aria-label={copied ? t('copied') : t('copy')}
              onClick={() => { void navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
              className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-slate-400 text-xs mt-2">{t('memberIdHint')}</p>
        </div>
      )}
      <dl className="divide-y divide-slate-800">
        {rows.map(r => (
          <div key={r.label} className="flex justify-between gap-4 py-2 text-sm">
            <dt className="text-slate-400 shrink-0">{r.label}</dt>
            <dd className="text-white text-end break-words min-w-0">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
