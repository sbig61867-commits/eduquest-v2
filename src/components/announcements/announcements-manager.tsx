'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/lib/confirm-dialog'
import { formatDate } from '@/lib/utils'
import { Megaphone, Plus, Trash2, Eye, EyeOff, ImagePlus, X, Users, Globe } from 'lucide-react'

export interface AnnouncementRow {
  id: string
  title: string
  body: string | null
  image_url: string | null
  link_url: string | null
  cta_label: string | null
  audience: 'all' | 'groups'
  is_published: boolean
  starts_at: string | null
  ends_at: string | null
  created_at: string
  group_ids: string[]
}
export interface GroupOption { id: string; name: string }

const EMPTY = {
  title: '', body: '', image_url: '', link_url: '', cta_label: '',
  audience: 'all' as 'all' | 'groups', group_ids: [] as string[],
  starts_at: '', ends_at: '', is_published: true,
}

export function AnnouncementsManager({ announcements, groups }: {
  announcements: AnnouncementRow[]
  groups: GroupOption[]
}) {
  const router = useRouter()
  const [composing, setComposing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const fileRef = useRef<HTMLInputElement>(null)

  async function uploadImage(file: File) {
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/announcements/upload', { method: 'POST', body: fd })
    const data = await res.json()
    setUploading(false)
    if (!res.ok) return toast.error(data.error ?? 'تعذّر رفع الصورة')
    setForm(f => ({ ...f, image_url: data.url }))
    toast.success('تم رفع الصورة')
  }

  async function create() {
    if (!form.title.trim()) return toast.error('اكتب عنوان الإعلان')
    if (form.audience === 'groups' && form.group_ids.length === 0) {
      return toast.error('اختر مجموعة واحدة على الأقل')
    }
    setBusy(true)
    const res = await fetch('/api/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        starts_at: form.starts_at || null,
        ends_at: form.ends_at || null,
      }),
    })
    const data = await res.json()
    setBusy(false)
    if (!res.ok) return toast.error(data.error ?? 'تعذّر إنشاء الإعلان')
    toast.success('تم نشر الإعلان')
    setForm(EMPTY)
    setComposing(false)
    router.refresh()
  }

  async function togglePublish(a: AnnouncementRow) {
    setBusy(true)
    const res = await fetch('/api/announcements', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: a.id, is_published: !a.is_published }),
    })
    setBusy(false)
    if (!res.ok) { const d = await res.json(); return toast.error(d.error ?? 'تعذّر التحديث') }
    router.refresh()
  }

  async function remove(a: AnnouncementRow) {
    if (!(await confirmDialog(`حذف الإعلان "${a.title}"؟`))) return
    setBusy(true)
    const res = await fetch('/api/announcements', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: a.id }),
    })
    setBusy(false)
    if (!res.ok) { const d = await res.json(); return toast.error(d.error ?? 'تعذّر الحذف') }
    toast.success('تم الحذف')
    router.refresh()
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-fg">الإعلانات</h2>
          <p className="text-fg-secondary mt-1">
            {announcements.length} إعلان · {announcements.filter(a => a.is_published).length} منشور
          </p>
        </div>
        <Button onClick={() => setComposing(v => !v)}><Plus className="w-4 h-4" /> إعلان جديد</Button>
      </div>

      {composing && (
        <div className="bg-surface border border-border rounded-lg p-5 space-y-4">
          <h3 className="text-fg font-semibold">إعلان جديد</h3>

          <label className="text-sm text-fg-secondary space-y-1.5 block">
            <span>العنوان</span>
            <input
              className="w-full bg-surface border border-border-strong rounded-lg px-3 py-2 text-fg text-sm"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="مثال: فتح التسجيل لدورة اللغة الإنجليزية"
            />
          </label>

          <label className="text-sm text-fg-secondary space-y-1.5 block">
            <span>النص</span>
            <textarea
              className="w-full bg-surface border border-border-strong rounded-lg px-3 py-2 text-fg text-sm min-h-[90px]"
              value={form.body}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              placeholder="تفاصيل الإعلان…"
            />
          </label>

          {/* Image */}
          <div className="space-y-2">
            <span className="text-sm text-fg-secondary">صورة / تصميم (اختياري)</span>
            {form.image_url ? (
              <div className="relative w-full max-w-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={form.image_url} alt="معاينة" className="rounded-lg border border-border-strong w-full object-cover max-h-48" />
                <button
                  onClick={() => setForm(f => ({ ...f, image_url: '' }))}
                  className="absolute top-2 left-2 bg-surface/80 rounded-full p-1.5 text-fg-secondary hover:text-fg"
                  aria-label="إزالة الصورة"
                ><X className="w-4 h-4" /></button>
              </div>
            ) : (
              <div>
                <input
                  ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f) }}
                />
                <Button variant="ghost" loading={uploading} onClick={() => fileRef.current?.click()}>
                  <ImagePlus className="w-4 h-4" /> رفع صورة
                </Button>
                <p className="text-fg-muted text-xs mt-1">JPG / PNG / WebP / GIF · حتى 4 ميغابايت</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-sm text-fg-secondary space-y-1.5 block">
              <span>رابط (اختياري)</span>
              <input
                className="w-full bg-surface border border-border-strong rounded-lg px-3 py-2 text-fg text-sm"
                value={form.link_url}
                onChange={e => setForm(f => ({ ...f, link_url: e.target.value }))}
                placeholder="https://…"
              />
            </label>
            <label className="text-sm text-fg-secondary space-y-1.5 block">
              <span>نص الزر (اختياري)</span>
              <input
                className="w-full bg-surface border border-border-strong rounded-lg px-3 py-2 text-fg text-sm"
                value={form.cta_label}
                onChange={e => setForm(f => ({ ...f, cta_label: e.target.value }))}
                placeholder="سجّل الآن"
              />
            </label>
          </div>

          {/* Audience */}
          <div className="space-y-2">
            <span className="text-sm text-fg-secondary">الجمهور</span>
            <div className="flex gap-2">
              <button
                onClick={() => setForm(f => ({ ...f, audience: 'all' }))}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-colors ${
                  form.audience === 'all' ? 'bg-accent border-accent text-accent-fg' : 'bg-surface border-border-strong text-fg-secondary'
                }`}
              ><Globe className="w-4 h-4" /> كل الطلاب</button>
              <button
                onClick={() => setForm(f => ({ ...f, audience: 'groups' }))}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-colors ${
                  form.audience === 'groups' ? 'bg-accent border-accent text-accent-fg' : 'bg-surface border-border-strong text-fg-secondary'
                }`}
              ><Users className="w-4 h-4" /> مجموعات محددة</button>
            </div>
            {form.audience === 'groups' && (
              <div className="flex flex-wrap gap-2 pt-1">
                {groups.length === 0 && <p className="text-fg-muted text-xs">لا توجد مجموعات.</p>}
                {groups.map(g => {
                  const on = form.group_ids.includes(g.id)
                  return (
                    <button
                      key={g.id}
                      onClick={() => setForm(f => ({
                        ...f,
                        group_ids: on ? f.group_ids.filter(x => x !== g.id) : [...f.group_ids, g.id],
                      }))}
                      className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                        on ? 'bg-accent-subtle border-blue-600 text-accent' : 'bg-surface border-border-strong text-fg-secondary'
                      }`}
                    >{g.name}</button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-sm text-fg-secondary space-y-1.5 block">
              <span>يبدأ في (اختياري)</span>
              <input type="datetime-local"
                className="w-full bg-surface border border-border-strong rounded-lg px-3 py-2 text-fg text-sm"
                value={form.starts_at}
                onChange={e => setForm(f => ({ ...f, starts_at: e.target.value }))}
              />
            </label>
            <label className="text-sm text-fg-secondary space-y-1.5 block">
              <span>ينتهي في (اختياري)</span>
              <input type="datetime-local"
                className="w-full bg-surface border border-border-strong rounded-lg px-3 py-2 text-fg text-sm"
                value={form.ends_at}
                onChange={e => setForm(f => ({ ...f, ends_at: e.target.value }))}
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm text-fg-secondary">
            <input type="checkbox" checked={form.is_published}
              onChange={e => setForm(f => ({ ...f, is_published: e.target.checked }))} />
            نشر مباشرةً
          </label>

          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => { setComposing(false); setForm(EMPTY) }}>إلغاء</Button>
            <Button loading={busy} onClick={create}>حفظ</Button>
          </div>
        </div>
      )}

      {announcements.length === 0 ? (
        <div className="text-center py-20 bg-surface border border-border rounded-lg">
          <Megaphone className="w-12 h-12 text-fg-muted mx-auto mb-3" />
          <p className="text-fg-secondary">لا توجد إعلانات بعد.</p>
          <p className="text-fg-muted text-sm mt-1">أنشئ إعلاناً ليظهر لطلابك في صفحتهم الرئيسية.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {announcements.map(a => (
            <div key={a.id} className="bg-surface border border-border rounded-lg overflow-hidden">
              {a.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.image_url} alt="" className="h-36 w-full object-cover bg-surface" />
              )}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-fg font-semibold">{a.title}</h3>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${
                    a.is_published ? 'text-accent bg-accent-subtle' : 'text-fg-secondary bg-surface'
                  }`}>{a.is_published ? 'منشور' : 'مسودة'}</span>
                </div>
                {a.body && <p className="text-fg-secondary text-sm mt-1 line-clamp-2">{a.body}</p>}
                <p className="text-fg-muted text-xs mt-2 flex items-center gap-1.5">
                  {a.audience === 'all'
                    ? <><Globe className="w-3 h-3" /> كل الطلاب</>
                    : <><Users className="w-3 h-3" /> {a.group_ids.length} مجموعة</>}
                  {' · '}{formatDate(a.created_at)}
                </p>
                <div className="flex gap-2 mt-3">
                  <Button size="sm" variant="ghost" loading={busy} onClick={() => togglePublish(a)}>
                    {a.is_published ? <><EyeOff className="w-3.5 h-3.5" /> إخفاء</> : <><Eye className="w-3.5 h-3.5" /> نشر</>}
                  </Button>
                  <Button size="sm" variant="ghost" loading={busy} onClick={() => remove(a)}>
                    <Trash2 className="w-3.5 h-3.5" /> حذف
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
