'use client'

import { useState } from 'react'
import { KeyRound, Copy, Check } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { confirmDialog } from '@/lib/confirm-dialog'

/**
 * Staff action on a member row: issue a temporary password for someone who
 * forgot theirs (/api/admin/reset-password). The password is shown once, here,
 * for staff to hand over; the member must replace it at the next sign-in.
 */
export function ResetPasswordButton({ userId, name, memberCode }: { userId: string; name: string; memberCode?: string | null }) {
  const t = useTranslations('staff.resetPassword')
  const [busy, setBusy] = useState(false)
  const [password, setPassword] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  async function reset() {
    if (!(await confirmDialog(t('confirm', { name }), { danger: false }))) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || typeof data.password !== 'string') { setError(typeof data.error === 'string' ? data.error : t('failed')); return }
      setPassword(data.password)
    } catch {
      setError(t('failed'))
    } finally {
      setBusy(false)
    }
  }

  const close = () => { setPassword(null); setError(''); setCopied(false) }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={reset} loading={busy} aria-label={t('action', { name })} title={t('action', { name })}>
        <KeyRound className="w-4 h-4" />
      </Button>
      <Modal open={password !== null || error !== ''} onClose={close} title={t('title', { name })} size="sm">
        {error ? (
          <p role="alert" className="text-body-sm text-danger">{error}</p>
        ) : (
          <div className="space-y-4">
            {memberCode && (
              <p className="text-body-sm text-fg-2">{t('memberId')} <span dir="ltr" className="font-mono text-fg">{memberCode}</span></p>
            )}
            <div className="rounded-control border border-line bg-canvas p-4">
              <p className="text-meta text-fg-muted">{t('temporary')}</p>
              <div className="mt-2 flex items-center gap-2">
                <p dir="ltr" className="flex-1 font-mono text-h2 text-fg">{password}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={copied ? t('copied') : t('copy')}
                  onClick={() => { if (password) { void navigator.clipboard.writeText(password); setCopied(true) } }}
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>
            <p className="text-body-sm text-fg-2">{t('handOver')}</p>
            <Button onClick={close}>{t('done')}</Button>
          </div>
        )}
      </Modal>
    </>
  )
}
