'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import type { UsageTenantRow } from '@/lib/ai/usage-report'
import type { UsageFormatters } from '@/lib/ai/usage-format'

// Writes straight to `tenants` with the super_admin's own session: the
// tenants_manage policy lets only super_admin write that table, so an
// institution can never raise its own allowance.

/** '' → null (unlimited); otherwise a whole number ≥ 0, or undefined when invalid. */
function parseLimit(raw: string): number | null | undefined {
  const v = raw.trim()
  if (v === '') return null
  if (!/^\d+$/.test(v)) return undefined
  const n = Number(v)
  return Number.isSafeInteger(n) ? n : undefined
}

export function TenantLimitsModal({ tenant, fmt, onClose }: {
  tenant: UsageTenantRow
  fmt: UsageFormatters
  onClose: () => void
}) {
  const t = useTranslations('superAdmin.aiUsage.limits')
  const router = useRouter()
  const [requests, setRequests] = useState(tenant.request_limit?.toString() ?? '')
  const [tokens, setTokens] = useState(tenant.token_limit?.toString() ?? '')
  const [action, setAction] = useState<'block' | 'warn'>(tenant.limit_action)
  const [threshold, setThreshold] = useState(String(tenant.alert_threshold_pct))
  const [saving, setSaving] = useState(false)

  const reqLimit = parseLimit(requests)
  const tokLimit = parseLimit(tokens)
  const pct = Number(threshold)
  const pctValid = /^\d+$/.test(threshold.trim()) && pct >= 1 && pct <= 100

  async function save() {
    if (reqLimit === undefined || tokLimit === undefined || !pctValid) return
    setSaving(true)
    const { error } = await createClient()
      .from('tenants')
      .update({
        ai_monthly_request_limit: reqLimit,
        ai_monthly_token_limit: tokLimit,
        ai_limit_action: action,
        ai_alert_threshold_pct: pct,
      })
      .eq('id', tenant.tenant_id)
    setSaving(false)
    if (error) { toast.error(t('saveFailed')); return }
    toast.success(t('saved'))
    onClose()
    router.refresh()
  }

  return (
    <Modal open onClose={onClose} title={t('title', { name: tenant.tenant_name })}>
      <div className="p-5 space-y-4">
        <p className="text-slate-400 text-sm">
          {t('usage', { requests: fmt.int(tenant.month_requests), tokens: fmt.int(tenant.month_tokens) })}
        </p>

        <Input
          label={t('requestLimit')}
          inputMode="numeric"
          value={requests}
          onChange={e => setRequests(e.target.value)}
          error={reqLimit === undefined ? t('invalid') : undefined}
        />
        <Input
          label={t('tokenLimit')}
          inputMode="numeric"
          value={tokens}
          onChange={e => setTokens(e.target.value)}
          error={tokLimit === undefined ? t('invalid') : undefined}
        />
        <p className="text-slate-500 text-xs -mt-2">{t('blankHint')}</p>

        <fieldset className="space-y-2">
          <legend className="block text-sm font-medium text-slate-300 mb-1">{t('action')}</legend>
          {(['block', 'warn'] as const).map(a => (
            <label key={a} className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input
                type="radio"
                name="ai-limit-action"
                checked={action === a}
                onChange={() => setAction(a)}
                className="accent-blue-500"
              />
              {a === 'block' ? t('actionBlock') : t('actionWarn')}
            </label>
          ))}
        </fieldset>

        <Input
          label={t('threshold')}
          inputMode="numeric"
          value={threshold}
          onChange={e => setThreshold(e.target.value)}
          error={pctValid ? undefined : t('invalidThreshold')}
        />
        <p className="text-slate-500 text-xs -mt-2">{t('thresholdHint')}</p>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
          <Button
            onClick={save}
            loading={saving}
            disabled={reqLimit === undefined || tokLimit === undefined || !pctValid}
          >
            {t('save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
