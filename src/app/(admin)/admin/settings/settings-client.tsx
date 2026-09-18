'use client'

import { useState } from 'react'
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
        setError(data.error ?? 'تعذّر حفظ الإعدادات')
      } else {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } catch {
      setError('خطأ في الشبكة، حاول مرة أخرى')
    }
    setLoading(false)
  }

  if (!tenant) {
    return (
      <div className="text-center py-20 text-slate-400">
        لم يُعثر على بيانات المؤسسة.
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
          <h2 className="text-2xl font-bold text-white">إعدادات المؤسسة</h2>
          <p className="text-slate-400 text-sm mt-0.5">أدر ملف مؤسستك</p>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-400">المعرّف</span>
          <span className="text-slate-300 font-mono">{tenant.slug}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">الحالة</span>
          <span className={tenant.is_active ? 'text-emerald-400' : 'text-red-400'}>
            {tenant.is_active ? 'نشط' : 'موقوف'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">تاريخ الإنشاء</span>
          <span className="text-slate-300">{formatDate(tenant.created_at)}</span>
        </div>
      </div>

      <form onSubmit={handleSave} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-semibold">تعديل الملف الشخصي</h3>

        {error && (
          <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
        )}
        {saved && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4" /> تم حفظ الإعدادات بنجاح
          </div>
        )}

        <Input
          label="اسم المؤسسة"
          value={form.name}
          onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
          required
          placeholder="مثال: مدرسة النور"
        />
        <Input
          label="رابط الشعار (اختياري)"
          value={form.logo_url}
          onChange={e => setForm(p => ({ ...p, logo_url: e.target.value }))}
          placeholder="https://example.com/logo.png"
        />

        {form.logo_url && (
          <div className="flex items-center gap-3 p-3 bg-slate-800 rounded-lg">
            <Image
              src={form.logo_url}
              alt="Logo preview"
              width={48}
              height={48}
              className="rounded-lg object-contain bg-white p-1"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
            <span className="text-slate-400 text-sm">معاينة الشعار</span>
          </div>
        )}

        <div className="pt-2">
          <Button type="submit" loading={loading}>حفظ التغييرات</Button>
        </div>
      </form>
    </div>
  )
}
