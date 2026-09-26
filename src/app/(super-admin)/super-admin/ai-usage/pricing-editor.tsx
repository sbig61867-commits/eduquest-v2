'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Trash2, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { priceKey, type AiPricing } from '@/lib/ai/pricing'

// Provider ids as the ledger records them (src/lib/ai/chat.ts, groq.ts).
const PROVIDERS = ['groq', 'xkiro', 'cohere', 'gemini', 'openrouter'] as const

/** `locked`: a built-in model — its id is fixed and it cannot be removed, only re-priced. */
interface Row { model: string; input: string; output: string; locked?: boolean }

const toRows = (p: AiPricing, defaults: AiPricing): Row[] =>
  Object.entries(p.models).map(([model, price]) => ({
    model, input: String(price.input), output: String(price.output), locked: model in defaults.models,
  }))

const validPrice = (v: string) => v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0

// Saved to platform_settings.ai_pricing with the super_admin's session
// (settings_write_super_admin). The metering code re-reads it within a minute
// and merges it over the verified defaults in src/lib/ai/pricing.ts.
export function PricingEditor({ pricing, defaults }: { pricing: AiPricing; defaults: AiPricing }) {
  const t = useTranslations('superAdmin.aiUsage.pricing')
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>(() => toRows(pricing, defaults))
  const [billed, setBilled] = useState<string[]>(pricing.billedProviders)
  const [saving, setSaving] = useState(false)

  const valid = rows.every(r => r.model.trim() && validPrice(r.input) && validPrice(r.output))

  const update = (i: number, patch: Partial<Row>) =>
    setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  async function save() {
    if (!valid) { toast.error(t('invalid')); return }
    setSaving(true)
    const models: AiPricing['models'] = {}
    for (const r of rows) models[priceKey(r.model)] = { input: Number(r.input), output: Number(r.output) }
    const { error } = await createClient()
      .from('platform_settings')
      .upsert({ key: 'ai_pricing', value: { models, billedProviders: billed }, updated_at: new Date().toISOString() })
    setSaving(false)
    if (error) { toast.error(t('saveFailed')); return }
    toast.success(t('saved'))
    router.refresh()
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
      <div>
        <h3 className="text-white font-semibold">{t('title')}</h3>
        <p className="text-slate-400 text-sm mt-1">{t('hint')}</p>
        <p className="text-slate-500 text-xs mt-1">{t('verified')}</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-start py-2 pe-3 text-xs font-medium text-slate-400">{t('columns.model')}</th>
              <th className="text-start py-2 pe-3 text-xs font-medium text-slate-400 w-32">{t('columns.input')}</th>
              <th className="text-start py-2 pe-3 text-xs font-medium text-slate-400 w-32">{t('columns.output')}</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="py-2 pe-3">
                  <input
                    value={r.model}
                    onChange={e => update(i, { model: e.target.value })}
                    placeholder={t('modelPlaceholder')}
                    readOnly={r.locked}
                    dir="ltr"
                    aria-label={t('columns.model')}
                    className="w-full min-w-48 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono text-xs read-only:bg-transparent read-only:border-transparent"
                  />
                </td>
                {(['input', 'output'] as const).map(k => (
                  <td key={k} className="py-2 pe-3">
                    <div className="relative">
                      <span className="absolute inset-y-0 start-2.5 flex items-center text-slate-500 text-xs">$</span>
                      <input
                        value={r[k]}
                        onChange={e => update(i, { [k]: e.target.value })}
                        inputMode="decimal"
                        dir="ltr"
                        aria-label={`${r.model} ${t(`columns.${k}`)}`}
                        className={`w-full bg-slate-800 border rounded-lg ps-6 pe-2.5 py-1.5 text-white text-xs tabular-nums ${validPrice(r[k]) ? 'border-slate-700' : 'border-red-500'}`}
                      />
                    </div>
                  </td>
                ))}
                <td className="py-2 text-end">
                  {!r.locked && (
                    <button
                      onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-slate-800"
                      aria-label={t('remove')}
                      title={t('remove')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        onClick={() => setRows(rs => [...rs, { model: '', input: '0', output: '0' }])}
        className="inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300"
      >
        <Plus className="w-4 h-4" /> {t('add')}
      </button>

      <fieldset className="border-t border-slate-800 pt-4">
        <legend className="sr-only">{t('billed')}</legend>
        <p className="text-sm font-medium text-slate-300">{t('billed')}</p>
        <p className="text-slate-500 text-xs mt-1 mb-3">{t('billedHint')}</p>
        <div className="flex flex-wrap gap-4">
          {PROVIDERS.map(p => (
            <label key={p} className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer capitalize">
              <input
                type="checkbox"
                checked={billed.includes(p)}
                onChange={e => setBilled(b => (e.target.checked ? [...b, p] : b.filter(x => x !== p)))}
                className="accent-blue-500"
              />
              {p}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => { setRows(toRows(defaults, defaults)); setBilled(defaults.billedProviders) }}>
          {t('reset')}
        </Button>
        <Button onClick={save} loading={saving} disabled={!valid}>{t('save')}</Button>
      </div>
    </div>
  )
}
