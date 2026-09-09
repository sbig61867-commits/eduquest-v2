'use client'

import { useState } from 'react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
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
  const [form, setForm] = useState({
    name: tenant?.name ?? '',
    logo_url: tenant?.logo_url ?? '',
  })
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!tenant) return
    setLoading(true)
    setError('')
    setSaved(false)

    const { error: err } = await supabase
      .from('tenants')
      .update({ name: form.name.trim(), logo_url: form.logo_url.trim() || null })
      .eq('id', tenant.id)

    if (err) {
      setError(err.message)
    } else {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }
    setLoading(false)
  }

  if (!tenant) {
    return (
      <div className="text-center py-20 text-fg-secondary">
        No institution data found.
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-surface flex items-center justify-center">
          <Settings className="w-5 h-5 text-fg-secondary" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-fg">Institution Settings</h2>
          <p className="text-fg-secondary text-sm mt-0.5">Manage your university profile</p>
        </div>
      </div>

      <div className="bg-surface border border-border rounded-lg p-6 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-fg-secondary">Slug</span>
          <span className="text-fg-secondary font-mono">{tenant.slug}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-fg-secondary">Status</span>
          <span className={tenant.is_active ? 'text-accent' : 'text-error'}>
            {tenant.is_active ? 'Active' : 'Suspended'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-fg-secondary">Created</span>
          <span className="text-fg-secondary">{new Date(tenant.created_at).toLocaleDateString()}</span>
        </div>
      </div>

      <form onSubmit={handleSave} className="bg-surface border border-border rounded-lg p-6 space-y-4">
        <h3 className="text-fg font-semibold">Edit Profile</h3>

        {error && (
          <p className="text-error text-sm bg-error-subtle border border-error/25 rounded-lg px-3 py-2">{error}</p>
        )}
        {saved && (
          <div className="flex items-center gap-2 text-accent text-sm bg-accent-subtle border border-success/25 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4" /> Settings saved successfully
          </div>
        )}

        <Input
          label="Institution Name"
          value={form.name}
          onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
          required
          placeholder="e.g. University of Technology"
        />
        <Input
          label="Logo URL (optional)"
          value={form.logo_url}
          onChange={e => setForm(p => ({ ...p, logo_url: e.target.value }))}
          placeholder="https://example.com/logo.png"
        />

        {form.logo_url && (
          <div className="flex items-center gap-3 p-3 bg-surface rounded-lg">
            <Image
              src={form.logo_url}
              alt="Logo preview"
              width={48}
              height={48}
              className="rounded-lg object-contain bg-white p-1"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
            <span className="text-fg-secondary text-sm">Logo preview</span>
          </div>
        )}

        <div className="pt-2">
          <Button type="submit" loading={loading}>Save Changes</Button>
        </div>
      </form>
    </div>
  )
}
