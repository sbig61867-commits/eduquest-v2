'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import type { Locale } from '@/i18n/config'
import { formatDate } from '@/lib/utils'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Settings, CheckCircle2 } from 'lucide-react'

interface Tenant {
  id: string
  name: string
  slug: string
  logo_url: string | null
  is_active: boolean
  created_at: string
}

export function AdminSettingsClient({ tenant }: { tenant: Tenant | null }) {
  const t = useTranslations('admin.settings')
  const locale = useLocale() as Locale
  const [form, setForm] = useState({
    name: tenant?.name ?? '',
    logo_url: tenant?.logo_url ?? '',
  })
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!tenant) return
    setLoading(true)
    setError('')
    setSaved(false)

    // Goes through the API route: a direct browser update of `tenants` is
    // silently filtered to 0 rows by RLS for a university_admin (no error),
    // which used to show "saved" while nothing was stored.
    try {
      const res = await fetch('/api/admin/tenant-branding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim(), logo_url: form.logo_url.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? t('saveFailed'))
      } else {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } catch {
      setError(t('networkError'))
    }
    setLoading(false)
  }

  if (!tenant) {
    return (
      <div className="text-center py-20 text-slate-400">
        {t('notFound')}
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center">
          <Settings className="w-5 h-5 text-slate-400" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white">{t('title')}</h2>
          <p className="text-slate-400 text-sm mt-0.5">{t('subtitle')}</p>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-400">{t('id')}</span>
          <span className="text-slate-300 font-mono">{tenant.slug}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">{t('status')}</span>
          <span className={tenant.is_active ? 'text-emerald-400' : 'text-red-400'}>
            {tenant.is_active ? t('active') : t('suspended')}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">{t('createdAt')}</span>
          <span className="text-slate-300">{formatDate(tenant.created_at, locale)}</span>
        </div>
      </div>

      <form onSubmit={handleSave} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-semibold">{t('editProfile')}</h3>

        {error && (
          <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
        )}
        {saved && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4" /> {t('saved')}
          </div>
        )}

        <Input
          label={t('name')}
          value={form.name}
          onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
          required
          placeholder={t('namePlaceholder')}
        />
        <Input
          label={t('logo')}
          value={form.logo_url}
          onChange={e => setForm(p => ({ ...p, logo_url: e.target.value }))}
          placeholder="https://example.com/logo.png"
        />

        {form.logo_url && (
          <div className="flex items-center gap-3 p-3 bg-slate-800 rounded-lg">
            <Image
              src={form.logo_url}
              alt={t('logoAlt')}
              width={48}
              height={48}
              className="rounded-lg object-contain bg-white p-1"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
            <span className="text-slate-400 text-sm">{t('logoPreview')}</span>
          </div>
        )}

        <div className="pt-2">
          <Button type="submit" loading={loading}>{t('save')}</Button>
        </div>
      </form>
    </div>
  )
}
