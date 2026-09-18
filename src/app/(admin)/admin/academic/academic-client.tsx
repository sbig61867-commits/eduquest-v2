'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Archive, ChevronRight, CalendarRange, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/lib/confirm-dialog'
import { formatDate } from '@/lib/utils'
import type { Terms } from '@/lib/terminology'

export interface AcademicUnit {
  id: string
  parent_id: string | null
  level: 1 | 2
  name: string
  code: string | null
  sort_order: number
}

export interface AcademicTerm {
  id: string
  name: string
  starts_on: string
  ends_on: string
  is_current: boolean
}

interface Props {
  terms: Terms
  initialUnits: AcademicUnit[]
  initialTerms: AcademicTerm[]
}

type UnitForm = { id?: string; parent_id: string | null; name: string; code: string }
type TermForm = { id?: string; name: string; starts_on: string; ends_on: string; is_current: boolean }

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? 'Request failed')
  return data
}

export function AcademicClient({ terms: t, initialUnits, initialTerms }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<'units' | 'terms'>('units')
  const [units, setUnits] = useState(initialUnits)
  const [periods, setPeriods] = useState(initialTerms)
  const [unitForm, setUnitForm] = useState<UnitForm | null>(null)
  const [termForm, setTermForm] = useState<TermForm | null>(null)
  const [saving, setSaving] = useState(false)

  const level1 = units.filter(u => u.level === 1)
  const childrenOf = (id: string) => units.filter(u => u.parent_id === id)

  async function saveUnit(e: React.FormEvent) {
    e.preventDefault()
    if (!unitForm) return
    setSaving(true)
    try {
      if (unitForm.id) {
        const { unit } = await send('/api/academic/units', 'PATCH', { id: unitForm.id, name: unitForm.name, code: unitForm.code })
        setUnits(prev => prev.map(u => u.id === unit.id ? unit : u))
      } else {
        const { unit } = await send('/api/academic/units', 'POST', {
          name: unitForm.name, code: unitForm.code, parent_id: unitForm.parent_id,
          sort_order: (unitForm.parent_id ? childrenOf(unitForm.parent_id) : level1).length,
        })
        setUnits(prev => [...prev, unit])
      }
      setUnitForm(null)
      router.refresh()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function archiveUnit(unit: AcademicUnit) {
    const extra = unit.level === 1 && childrenOf(unit.id).length
      ? ` and its ${childrenOf(unit.id).length} ${t.unitsL2.toLowerCase()}` : ''
    if (!(await confirmDialog(`Archive "${unit.name}"${extra}? Linked groups and courses keep their data.`))) return
    try {
      await send('/api/academic/units', 'DELETE', { id: unit.id })
      setUnits(prev => prev.filter(u => u.id !== unit.id && u.parent_id !== unit.id))
      router.refresh()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  async function saveTerm(e: React.FormEvent) {
    e.preventDefault()
    if (!termForm) return
    setSaving(true)
    try {
      const { id, ...fields } = termForm
      const { term } = await send('/api/academic/terms', id ? 'PATCH' : 'POST', id ? { id, ...fields } : fields)
      setPeriods(prev => {
        const rest = prev.filter(p => p.id !== term.id).map(p => term.is_current ? { ...p, is_current: false } : p)
        return [term, ...rest].sort((a, b) => b.starts_on.localeCompare(a.starts_on))
      })
      setTermForm(null)
      router.refresh()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function makeCurrent(term: AcademicTerm) {
    try {
      await send('/api/academic/terms', 'PATCH', { id: term.id, is_current: true })
      setPeriods(prev => prev.map(p => ({ ...p, is_current: p.id === term.id })))
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  async function archiveTerm(term: AcademicTerm) {
    if (!(await confirmDialog(`Archive "${term.name}"?`))) return
    try {
      await send('/api/academic/terms', 'DELETE', { id: term.id })
      setPeriods(prev => prev.filter(p => p.id !== term.id))
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const tabClass = (active: boolean) =>
    `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${active ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">الهيكل الأكاديمي</h2>
          <p className="text-slate-400 mt-1">
            {t.unitsL1} › {t.unitsL2} · {t.terms}
          </p>
        </div>
        {tab === 'units'
          ? <Button onClick={() => setUnitForm({ parent_id: null, name: '', code: '' })}><Plus className="w-4 h-4" /> New {t.unitL1}</Button>
          : <Button onClick={() => setTermForm({ name: '', starts_on: '', ends_on: '', is_current: periods.length === 0 })}><Plus className="w-4 h-4" /> New {t.term}</Button>}
      </div>

      <div className="flex gap-2">
        <button className={tabClass(tab === 'units')} onClick={() => setTab('units')}>{t.unitsL1} &amp; {t.unitsL2}</button>
        <button className={tabClass(tab === 'terms')} onClick={() => setTab('terms')}>{t.terms}</button>
      </div>

      {tab === 'units' && (
        level1.length === 0 ? (
          <div className="text-center py-16 bg-slate-900 border border-slate-800 rounded-xl">
            <p className="text-slate-400">No {t.unitsL1.toLowerCase()} yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {level1.map(unit => (
              <div key={unit.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-white font-semibold truncate">{unit.name}</p>
                    {unit.code && <p className="text-slate-500 text-xs font-mono">{unit.code}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => setUnitForm({ parent_id: unit.id, name: '', code: '' })}>
                      <Plus className="w-4 h-4" /> {t.unitL2}
                    </Button>
                    <Button variant="ghost" size="sm" aria-label="تعديل" onClick={() => setUnitForm({ id: unit.id, parent_id: null, name: unit.name, code: unit.code ?? '' })}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" aria-label="Archive" className="hover:text-amber-400" onClick={() => archiveUnit(unit)}>
                      <Archive className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                {childrenOf(unit.id).length > 0 && (
                  <ul className="mt-3 space-y-1 border-t border-slate-800 pt-3">
                    {childrenOf(unit.id).map(child => (
                      <li key={child.id} className="flex items-center justify-between gap-3 ps-2">
                        <span className="flex items-center gap-2 text-slate-300 text-sm min-w-0">
                          <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                          <span className="truncate">{child.name}</span>
                          {child.code && <span className="text-slate-500 text-xs font-mono">{child.code}</span>}
                        </span>
                        <span className="flex items-center gap-1 shrink-0">
                          <Button variant="ghost" size="sm" aria-label="تعديل" onClick={() => setUnitForm({ id: child.id, parent_id: unit.id, name: child.name, code: child.code ?? '' })}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" aria-label="Archive" className="hover:text-amber-400" onClick={() => archiveUnit(child)}>
                            <Archive className="w-3.5 h-3.5" />
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'terms' && (
        periods.length === 0 ? (
          <div className="text-center py-16 bg-slate-900 border border-slate-800 rounded-xl">
            <CalendarRange className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400">No {t.terms.toLowerCase()} yet.</p>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-xl divide-y divide-slate-800">
            {periods.map(term => (
              <div key={term.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-white font-medium flex items-center gap-2">
                    {term.name}
                    {term.is_current && <Badge variant="green">الحالي</Badge>}
                  </p>
                  <p className="text-slate-500 text-xs">{formatDate(term.starts_on)} – {formatDate(term.ends_on)}</p>
                </div>
                <div className="flex items-center gap-1">
                  {!term.is_current && (
                    <Button variant="ghost" size="sm" onClick={() => makeCurrent(term)}>
                      <Star className="w-4 h-4" /> تعيين كحالي
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" aria-label="تعديل" onClick={() => setTermForm({ ...term })}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label="Archive" className="hover:text-amber-400" onClick={() => archiveTerm(term)}>
                    <Archive className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      <Modal
        open={!!unitForm}
        onClose={() => setUnitForm(null)}
        title={`${unitForm?.id ? 'تعديل' : 'جديد'} ${unitForm?.parent_id ? t.unitL2 : t.unitL1}`}
      >
        {unitForm && (
          <form onSubmit={saveUnit} className="space-y-4">
            {unitForm.parent_id && (
              <p className="text-slate-400 text-sm">
                {t.unitL1}: <span className="text-white">{units.find(u => u.id === unitForm.parent_id)?.name}</span>
              </p>
            )}
            <Input label="الاسم" value={unitForm.name} maxLength={120} required
              onChange={e => setUnitForm(f => f && { ...f, name: e.target.value })} />
            <Input label="الرمز (اختياري)" value={unitForm.code} maxLength={30}
              onChange={e => setUnitForm(f => f && { ...f, code: e.target.value })} />
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="secondary" className="flex-1" onClick={() => setUnitForm(null)}>إلغاء</Button>
              <Button type="submit" loading={saving} className="flex-1">حفظ</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!termForm} onClose={() => setTermForm(null)} title={`${termForm?.id ? 'تعديل' : 'جديد'} ${t.term}`}>
        {termForm && (
          <form onSubmit={saveTerm} className="space-y-4">
            <Input label="الاسم" value={termForm.name} maxLength={120} required placeholder="2026–2027 · 1"
              onChange={e => setTermForm(f => f && { ...f, name: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="يبدأ" type="date" value={termForm.starts_on} required
                onChange={e => setTermForm(f => f && { ...f, starts_on: e.target.value })} />
              <Input label="ينتهي" type="date" value={termForm.ends_on} required min={termForm.starts_on || undefined}
                onChange={e => setTermForm(f => f && { ...f, ends_on: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={termForm.is_current}
                onChange={e => setTermForm(f => f && { ...f, is_current: e.target.checked })} />
              Current {t.term.toLowerCase()}
            </label>
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="secondary" className="flex-1" onClick={() => setTermForm(null)}>إلغاء</Button>
              <Button type="submit" loading={saving} className="flex-1">حفظ</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
