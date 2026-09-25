'use client'
import { confirmDialog } from '@/lib/confirm-dialog'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { Badge } from '@/components/ui/badge'
import { Plus, Building2, Archive, ArchiveRestore, Trash2, UserPlus, Mail } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import type { Tenant, InstitutionType, StructureMode } from '@/types'
import { INSTITUTION_TYPES, getTerms } from '@/lib/terminology'
import { useTranslations, useLocale } from 'next-intl'
import type { Locale } from '@/i18n/config'

interface Props { initialTenants: Tenant[] }

export function TenantsClient({ initialTenants }: Props) {
  const t = useTranslations('superAdmin.tenants')
  const tc = useTranslations('common.actions')
  const locale = useLocale() as Locale
  const [tenants, setTenants] = useState(initialTenants)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<{ name: string; slug: string; institution_type: InstitutionType; has_center: boolean }>({ name: '', slug: '', institution_type: 'university', has_center: true })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Manual add admin modal
  const [adminTarget, setAdminTarget] = useState<Tenant | null>(null)
  const [adminForm, setAdminForm] = useState({ full_name: '', email: '', password: '' })
  const [adminLoading, setAdminLoading] = useState(false)
  const [adminError, setAdminError] = useState('')
  const [adminSuccess, setAdminSuccess] = useState('')

  const supabase = createClient()
  const router = useRouter()

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const slug = form.slug || form.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const { data, error: err } = await supabase
      .from('tenants')
      .insert({
        name: form.name, slug,
        // Omitted for the default so creation still works before
        // institution_type_migration.sql is applied.
        ...(form.institution_type !== 'university' ? { institution_type: form.institution_type } : {}),
        ...(!form.has_center ? { has_center: false } : {}),
      })
      .select()
      .single()
    if (err) { setError(err.message); setLoading(false); return }
    setTenants(prev => [data, ...prev])
    setForm({ name: '', slug: '', institution_type: 'university', has_center: true })
    setShowAdd(false)
    setLoading(false)
    router.refresh()
  }

  async function toggleTenant(tenant: Tenant) {
    const archive = tenant.is_active // active -> archive (suspend); suspended -> restore
    if (archive && !(await confirmDialog(t('archiveConfirm', { name: tenant.name })))) return
    const res = await fetch('/api/admin/archive-tenant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenant.id, archive }),
    })
    const data = await res.json()
    if (!res.ok) { toast.error(data.error ?? t('updateFailed')); return }
    setTenants(prev => prev.map(t => t.id === tenant.id ? data.tenant : t))
    router.refresh()
  }

  async function deleteTenant(tenant: Tenant) {
    if (!(await confirmDialog(t('deleteConfirm', { name: tenant.name })))) return
    if (!(await confirmDialog(t('deleteConfirmFinal', { name: tenant.name })))) return
    const res = await fetch(`/api/admin/delete-tenant?id=${tenant.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) { toast.error(data.error ?? t('deleteFailed')); return }
    setTenants(prev => prev.filter(t => t.id !== tenant.id))
    // Invalidate the router cache so revisiting the page doesn't show the
    // deleted tenant from a stale server render.
    router.refresh()
  }

  async function changeType(tenant: Tenant, institution_type: InstitutionType) {
    const { data, error: err } = await supabase
      .from('tenants').update({ institution_type }).eq('id', tenant.id).select().single()
    if (err) { toast.error(err.message); return }
    setTenants(prev => prev.map(t => t.id === tenant.id ? data : t))
    router.refresh()
  }

  // The academic structure is opt-in per institution; the original ('flat')
  // structure stays the default. Switching back never deletes anything.
  async function changeHasCenter(tenant: Tenant, has_center: boolean) {
    const message = t(has_center ? 'centerOn' : 'centerOff', { name: tenant.name })
    if (!(await confirmDialog(message))) return
    const { data, error: err } = await supabase
      .from('tenants').update({ has_center }).eq('id', tenant.id).select().single()
    if (err) { toast.error(err.message); return }
    setTenants(prev => prev.map(t => t.id === tenant.id ? data : t))
    router.refresh()
  }

  async function changeStructureMode(tenant: Tenant, structure_mode: StructureMode) {
    const message = t(structure_mode === 'academic' ? 'academicOn' : 'academicOff', { name: tenant.name })
    if (!(await confirmDialog(message))) return
    const { data, error: err } = await supabase
      .from('tenants').update({ structure_mode }).eq('id', tenant.id).select().single()
    if (err) { toast.error(err.message); return }
    setTenants(prev => prev.map(t => t.id === tenant.id ? data : t))
    router.refresh()
  }

  // ── Manual add admin ──────────────────────────────────────
  function openAddAdmin(tenant: Tenant) {
    setAdminTarget(tenant)
    setAdminForm({ full_name: '', email: '', password: '' })
    setAdminError('')
    setAdminSuccess('')
  }

  async function handleAddAdmin(e: React.FormEvent) {
    e.preventDefault()
    if (!adminTarget) return
    setAdminLoading(true)
    setAdminError('')
    setAdminSuccess('')

    const res = await fetch('/api/admin/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...adminForm,
        role: 'university_admin',
        tenant_id: adminTarget.id,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      setAdminError(data.error ?? t('adminCreateFailed'))
    } else {
      setAdminSuccess(t('adminCreated', { name: data.user.full_name, email: adminForm.email }))
      setAdminForm({ full_name: '', email: '', password: '' })
    }
    setAdminLoading(false)
  }


  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">{t('title')}</h2>
          <p className="text-slate-400 mt-1">{t('count', { count: tenants.length })}</p>
        </div>
        <Button onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> {t('newTenant')}</Button>
      </div>

      {tenants.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <Building2 className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 mb-2">{t('empty')}</p>
          <p className="text-slate-500 text-sm">{t('emptyHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {tenants.map(tenant => (
            <div key={tenant.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors">
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-xl bg-blue-600/20 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-blue-400" />
                </div>
                <Badge variant={tenant.is_active ? 'green' : 'red'}>
                  {tenant.is_active ? t('active') : t('archived')}
                </Badge>
              </div>
              <h3 className="text-white font-semibold text-lg mb-1">{tenant.name}</h3>
              <p className="text-slate-500 text-sm mb-1 font-mono">{tenant.slug}</p>
              <select
                aria-label={t('typeLabel')}
                value={tenant.institution_type ?? 'university'}
                onChange={e => changeType(tenant, e.target.value as InstitutionType)}
                className="mb-2 w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-xs px-2 py-1.5"
              >
                {INSTITUTION_TYPES.map(type => <option key={type} value={type}>{getTerms(type, locale).institutionTypeLabel}</option>)}
              </select>
              <select
                aria-label={t('structureLabel')}
                value={tenant.structure_mode ?? 'flat'}
                onChange={e => changeStructureMode(tenant, e.target.value as StructureMode)}
                className="mb-2 w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-xs px-2 py-1.5"
              >
                <option value="flat">{t('structureFlat')}</option>
                <option value="academic">{t('structureAcademic')}</option>
              </select>
              <label className="mb-2 flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={tenant.has_center !== false}
                  onChange={e => changeHasCenter(tenant, e.target.checked)}
                />
                {t('hasCenter')}
              </label>
              <p className="text-slate-500 text-xs mb-4">{t('createdAt', { date: formatDate(tenant.created_at, locale) })}</p>

              <div className="space-y-2 pt-3 border-t border-slate-800">
                {/* Add admin manually */}
                <Button variant="secondary" size="sm" className="w-full" onClick={() => openAddAdmin(tenant)}>
                  <UserPlus className="w-4 h-4" /> {t('addAdminManual')}
                </Button>
                {/* Invite admin via link — redirects to the Invitations page */}
                <Button variant="secondary" size="sm" className="w-full !bg-blue-600/10 !border-blue-500/20 !text-blue-400 hover:!bg-blue-600/20" onClick={() => router.push('/super-admin/invitations')}>
                  <Mail className="w-4 h-4" /> {t('inviteAdmin')}
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => toggleTenant(tenant)}
                    className={`flex-1 ${tenant.is_active ? 'hover:text-amber-400 hover:bg-amber-500/10' : 'hover:text-emerald-400 hover:bg-emerald-500/10'}`}
                  >
                    {tenant.is_active
                      ? <><Archive className="w-4 h-4" /> {t('archive')}</>
                      : <><ArchiveRestore className="w-4 h-4" /> {t('restore')}</>}
                  </Button>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => deleteTenant(tenant)}
                    title={t('deletePermanent')}
                    aria-label={t('deletePermanent')}
                    className="hover:text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Institution Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={t('addModalTitle')}>
        <form onSubmit={handleAdd} className="space-y-4">
          {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
          <Input
            label={t('name')}
            value={form.name}
            onChange={e => {
              const name = e.target.value
              setForm(p => ({ ...p, name, slug: name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') }))
            }}
            required
            placeholder={t('namePlaceholder')}
          />
          <Input
            label={t('slug')}
            value={form.slug}
            onChange={e => setForm(p => ({ ...p, slug: e.target.value }))}
            required
            placeholder={'king-abdullah-university'}
          />
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">{t('type')}</label>
            <select
              value={form.institution_type}
              // A continuing-education centre is typical for universities only; editable below.
              onChange={e => {
                const institution_type = e.target.value as InstitutionType
                setForm(p => ({ ...p, institution_type, has_center: institution_type === 'university' }))
              }}
              className="w-full rounded-lg bg-slate-800 border border-slate-700 text-white text-sm px-3 py-2"
            >
              {INSTITUTION_TYPES.map(type => <option key={type} value={type}>{getTerms(type, locale).institutionTypeLabel}</option>)}
            </select>
            <label className="mt-2 flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={form.has_center}
                onChange={e => setForm(p => ({ ...p, has_center: e.target.checked }))} />
              {t('hasCenterLong')}
            </label>
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setShowAdd(false)} className="flex-1">{tc('cancel')}</Button>
            <Button type="submit" loading={loading} className="flex-1">{t('create')}</Button>
          </div>
        </form>
      </Modal>

      {/* Manual Add Admin Modal */}
      <Modal open={!!adminTarget} onClose={() => setAdminTarget(null)} title={t('addAdminTitle', { name: adminTarget?.name ?? '' })}>
        <form onSubmit={handleAddAdmin} className="space-y-4">
          {adminError && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{adminError}</p>}
          {adminSuccess && <p className="text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">{adminSuccess}</p>}
          <p className="text-slate-400 text-sm">
            {t.rich('addAdminHint', { name: adminTarget?.name ?? '', b: chunks => <span className="text-white font-medium">{chunks}</span> })}
          </p>
          <Input label={t('fullName')} value={adminForm.full_name} onChange={e => setAdminForm(p => ({ ...p, full_name: e.target.value }))} required placeholder={t('fullNamePlaceholder')} />
          <Input label={t('email')} type="email" value={adminForm.email} onChange={e => setAdminForm(p => ({ ...p, email: e.target.value }))} required placeholder="admin@university.edu" />
          <Input label={t('password')} type="password" value={adminForm.password} onChange={e => setAdminForm(p => ({ ...p, password: e.target.value }))} required placeholder={t('passwordPlaceholder')} />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setAdminTarget(null)} className="flex-1">{tc('close')}</Button>
            <Button type="submit" loading={adminLoading} className="flex-1">{t('createAdmin')}</Button>
          </div>
        </form>
      </Modal>

    </div>
  )
}
