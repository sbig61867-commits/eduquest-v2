'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { AccountPanel } from './account-panel'
import { PreferencesCard } from './preferences-card'

/** Same rule as /api/account/password and the forced first change. */
const MIN_PASSWORD_LENGTH = 8

const CARD = 'rounded-overlay border border-line bg-surface p-6'

/**
 * The account section every role shares (2026-10-17): my details, change
 * password, language and appearance. Role pages add their own sections below
 * it (the institution profile for an institution admin, platform settings for
 * the super admin).
 */
export function AccountSettings() {
  const t = useTranslations('common.account')
  return (
    <div className="space-y-6">
      <h1 className="text-h1 text-fg">{t('settings')}</h1>
      <AccountDetailsCard />
      <PasswordCard />
      <PreferencesCard />
    </div>
  )
}

/** Read-only: what the institution set (name, ID, email, role, institution). */
export function AccountDetailsCard() {
  const t = useTranslations('common.account')
  const { user, tenant } = useAuthStore()
  if (!user) return null
  return (
    <section aria-labelledby="account-details-title" className={CARD}>
      <h2 id="account-details-title" className="text-h3 text-fg mb-4">{t('details')}</h2>
      <AccountPanel user={user} tenant={tenant} />
    </section>
  )
}

function Field({ label, value, onChange, autoComplete, hint }: {
  label: string
  value: string
  onChange: (v: string) => void
  autoComplete: 'current-password' | 'new-password'
  hint?: string
}) {
  const id = useId()
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-body-sm text-fg-2">{label}</label>
      <input
        id={id}
        type="password"
        dir="ltr"
        value={value}
        onChange={e => onChange(e.target.value)}
        autoComplete={autoComplete}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="eq-focus w-full rounded-control border border-line bg-canvas px-3 py-2 text-fg"
      />
      {hint && <p id={`${id}-hint`} className="text-meta text-fg-muted">{hint}</p>}
    </div>
  )
}

/** Change password: the current one is required (checked on the server). */
export function PasswordCard() {
  const t = useTranslations('common.account')
  const tState = useTranslations('common.state')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaved(false)
    if (next.length < MIN_PASSWORD_LENGTH) { setError(t('passwordHint', { min: MIN_PASSWORD_LENGTH })); return }
    if (next !== confirm) { setError(t('passwordMismatch')); return }
    setError('')
    setSaving(true)
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current, next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(typeof data.error === 'string' ? data.error : tState('error')); return }
      setCurrent(''); setNext(''); setConfirm('')
      setSaved(true)
    } catch {
      setError(tState('error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="password-title" className={CARD}>
      <h2 id="password-title" className="text-h3 text-fg">{t('changePassword')}</h2>
      <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
        <Field label={t('currentPassword')} value={current} onChange={setCurrent} autoComplete="current-password" />
        <Field label={t('newPassword')} value={next} onChange={setNext} autoComplete="new-password" hint={t('passwordHint', { min: MIN_PASSWORD_LENGTH })} />
        <Field label={t('confirmPassword')} value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <div role="status" aria-live="polite">
          {error && <p className="text-body-sm text-danger">{error}</p>}
          {saved && <p className="text-body-sm text-success">{t('passwordSaved')}</p>}
        </div>
        <Button type="submit" loading={saving} disabled={!current || !next || !confirm}>{t('updatePassword')}</Button>
      </form>
    </section>
  )
}
