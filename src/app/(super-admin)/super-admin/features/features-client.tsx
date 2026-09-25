'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2 } from 'lucide-react'
import type { FeatureFlag } from '@/types'
import { useTranslations } from 'next-intl'

interface Tenant { id: string; name: string }
interface Props { initialFlags: FeatureFlag[]; tenants: Tenant[] }

const GLOBAL_FEATURES = ['ai_lesson_generation', 'proctoring', 'file_uploads', 'realtime_updates'] as const
const isGlobal = (name: string) => (GLOBAL_FEATURES as readonly string[]).includes(name)

export function FeaturesClient({ initialFlags, tenants }: Props) {
  const t = useTranslations('superAdmin.features')
  const tc = useTranslations('common.actions')
  const router = useRouter()
  const [flags, setFlags] = useState(initialFlags)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', tenant_id: '' })
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  async function toggleFlag(flag: FeatureFlag) {
    const { data } = await supabase.from('feature_flags').update({ is_enabled: !flag.is_enabled }).eq('id', flag.id).select().single()
    if (data) { setFlags(prev => prev.map(f => f.id === flag.id ? data : f)); router.refresh() }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { data } = await supabase.from('feature_flags').insert({ name: form.name, tenant_id: form.tenant_id || null, is_enabled: true }).select().single()
    if (data) { setFlags(prev => [...prev, data]); router.refresh() }
    setShowAdd(false)
    setLoading(false)
  }

  async function deleteFlag(id: string) {
    const { error } = await supabase.from('feature_flags').delete().eq('id', id)
    if (!error) { setFlags(prev => prev.filter(f => f.id !== id)); router.refresh() }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">{t('title')}</h2>
          <p className="text-slate-400 mt-1">{t('killSwitchSubtitle')}</p>
        </div>
        <Button onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> {t('addFlag')}</Button>
      </div>

      {/* Predefined global features */}
      <div>
        <h3 className="text-slate-400 text-xs uppercase tracking-wider font-medium mb-3">{t('platformFeatures')}</h3>
        <div className="space-y-2">
          {GLOBAL_FEATURES.map(name => {
            const flag = flags.find(f => f.name === name && !f.tenant_id)
            const label = t(`items.${name}.label`)
            return (
              <div key={name} className="bg-slate-900 border border-slate-800 rounded-xl px-5 py-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-white font-medium">{label}</p>
                  <p className="text-slate-400 text-sm">{t(`items.${name}.description`)}</p>
                </div>
                <button
                  aria-label={t('toggle', { name: label })}
                  aria-pressed={flag?.is_enabled !== false}
                  onClick={async () => {
                    if (flag) { toggleFlag(flag) } else {
                      const { data } = await supabase.from('feature_flags').insert({ name, is_enabled: true }).select().single()
                      if (data) { setFlags(prev => [...prev, data]); router.refresh() }
                    }
                  }}
                  className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ${flag?.is_enabled !== false ? 'bg-blue-600' : 'bg-slate-700'}`}
                >
                  <div className={`absolute top-1 start-0 w-4 h-4 rounded-full bg-white transition-transform ${flag?.is_enabled !== false ? 'translate-x-7 rtl:-translate-x-7' : 'translate-x-1 rtl:-translate-x-1'}`} />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Custom flags */}
      {flags.filter(f => !isGlobal(f.name)).length > 0 && (
        <div>
          <h3 className="text-slate-400 text-xs uppercase tracking-wider font-medium mb-3">{t('customFlags')}</h3>
          <div className="space-y-2">
            {flags.filter(f => !isGlobal(f.name)).map(flag => (
              <div key={flag.id} className="bg-slate-900 border border-slate-800 rounded-xl px-5 py-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-white font-medium font-mono text-sm">{flag.name}</p>
                  {flag.tenant_id && <p className="text-slate-500 text-xs">{t('tenantLabel', { name: tenants.find(x => x.id === flag.tenant_id)?.name ?? flag.tenant_id })}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={flag.is_enabled ? 'green' : 'red'}>{flag.is_enabled ? t('on') : t('off')}</Badge>
                  <button onClick={() => toggleFlag(flag)} aria-label={t('toggle', { name: flag.name })} aria-pressed={flag.is_enabled} className={`relative w-12 h-6 rounded-full transition-colors ${flag.is_enabled ? 'bg-blue-600' : 'bg-slate-700'}`}>
                    <div className={`absolute top-1 start-0 w-4 h-4 rounded-full bg-white transition-transform ${flag.is_enabled ? 'translate-x-7 rtl:-translate-x-7' : 'translate-x-1 rtl:-translate-x-1'}`} />
                  </button>
                  <Button variant="ghost" size="sm" onClick={() => deleteFlag(flag.id)} aria-label={tc('delete')} className="hover:text-red-400 hover:bg-red-500/10"><Trash2 className="w-4 h-4" /></Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={t('addModalTitle')}>
        <form onSubmit={handleAdd} className="space-y-4">
          <Input label={t('flagName')} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required placeholder={'custom_feature_name'} />
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-300">{t('tenantOptional')}</label>
            <select value={form.tenant_id} onChange={e => setForm(p => ({ ...p, tenant_id: e.target.value }))} className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">{t('global')}</option>
              {tenants.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setShowAdd(false)} className="flex-1">{tc('cancel')}</Button>
            <Button type="submit" loading={loading} className="flex-1">{t('addFlag')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
