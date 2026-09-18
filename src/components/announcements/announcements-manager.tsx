'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/lib/confirm-dialog'
import { formatDate } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { getTerms } from '@/lib/terminology'
import { AnnouncementsBanner } from '@/components/student/announcements-banner'
import { Modal } from '@/components/ui/modal'
import { BannerDesigner } from '@/components/announcements/banner-designer'
import { type AnnouncementAudience } from '@/lib/announcement-audience'
import { Megaphone, Plus, Trash2, Eye, EyeOff, ImagePlus, X, Users, Globe, Pencil, Palette, Sparkles, GraduationCap, Building2, Lock } from 'lucide-react'

interface CopySuggestion { title: string; body: string; cta_label: string }

// datetime-local inputs carry no timezone — the browser means "local time"
// but a bare string like "2026-09-13T22:13" is stored by Postgres as UTC,
// silently shifting every window by the viewer's UTC offset. Convert
// explicitly at the boundary in both directions.
function localInputToIso(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : d.toISOString()
}
function isoToLocalInput(value: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type Status = 'draft' | 'scheduled' | 'live' | 'ended'
function announcementStatus(a: Pick<AnnouncementRow, 'is_published' | 'starts_at' | 'ends_at'>): Status {
  if (!a.is_published) return 'draft'
  const now = Date.now()
  if (a.starts_at && new Date(a.starts_at).getTime() > now) return 'scheduled'
  if (a.ends_at && new Date(a.ends_at).getTime() < now) return 'ended'
  return 'live'
}
const STATUS_LABEL: Record<Status, string> = { draft: 'مسودة', scheduled: 'مجدول', live: 'ظاهر الآن', ended: 'منتهٍ' }
const STATUS_CLASS: Record<Status, string> = {
  draft: 'text-slate-400 bg-slate-500/10',
  scheduled: 'text-amber-400 bg-amber-500/10',
  live: 'text-emerald-400 bg-emerald-500/10',
  ended: 'text-rose-400 bg-rose-500/10',
}

export interface AnnouncementRow {
  id: string
  title: string
  body: string | null
  image_url: string | null
  link_url: string | null
  cta_label: string | null
  audience: AnnouncementAudience
  center_students_only: boolean
  is_published: boolean
  starts_at: string | null
  ends_at: string | null
  created_at: string
  group_ids: string[]
}
export interface GroupOption { id: string; name: string }

// Audience choices, in the order they are offered. `all` and `university` need
// the `announce_to_university` capability; the other two are always available
// to anyone who may manage announcements.
const AUDIENCE_OPTIONS: {
  value: AnnouncementAudience
  label: string
  icon: typeof Globe
  needsUniversity: boolean
}[] = [
  { value: 'all',        label: 'كل الطلاب',    icon: Globe,         needsUniversity: true },
  { value: 'university', label: 'طلاب الجامعة', icon: GraduationCap, needsUniversity: true },
  { value: 'center',     label: 'طلاب المركز',  icon: Building2,     needsUniversity: false },
  { value: 'groups',     label: 'مجموعات محددة', icon: Users,        needsUniversity: false },
]

const AUDIENCE_LABEL: Record<AnnouncementAudience, string> =
  Object.fromEntries(AUDIENCE_OPTIONS.map(o => [o.value, o.label])) as Record<AnnouncementAudience, string>

const emptyForm = (canTargetUniversity: boolean) => ({
  title: '', body: '', image_url: '', link_url: '', cta_label: '',
  audience: (canTargetUniversity ? 'all' : 'center') as AnnouncementAudience,
  group_ids: [] as string[],
  starts_at: '', ends_at: '', is_published: true,
})

export function AnnouncementsManager({ announcements, groups, canTargetUniversity, hasCenter = true }: {
  announcements: AnnouncementRow[]
  groups: GroupOption[]
  /** Holds `announce_to_university`; otherwise every announcement is pinned to centre students. */
  canTargetUniversity: boolean
  /** Institution has a continuing-education centre; without one the university/centre audiences don't exist. */
  hasCenter?: boolean
}) {
  const terms = getTerms(useAuthStore(s => s.tenant?.institution_type))
  const audienceLabel = (value: AnnouncementAudience) =>
    value === 'university' ? terms.institutionStudentsAr : AUDIENCE_LABEL[value]
  const EMPTY = emptyForm(canTargetUniversity)
  const router = useRouter()
  const [composing, setComposing] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const fileRef = useRef<HTMLInputElement>(null)
  const [designing, setDesigning] = useState(false)
  const [brief, setBrief] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const [suggestions, setSuggestions] = useState<CopySuggestion[]>([])

  async function suggestCopy() {
    if (brief.trim().length < 5) return toast.error('اكتب وصفاً مختصراً للإعلان أولاً')
    setSuggesting(true)
    const res = await fetch('/api/ai/announcement-copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief: brief.trim() }),
    })
    const data = await res.json().catch(() => ({}))
    setSuggesting(false)
    if (!res.ok) return toast.error(data.error ?? 'تعذّر توليد الاقتراحات')
    setSuggestions(data.suggestions ?? [])
  }

  function applySuggestion(s: CopySuggestion) {
    setForm(f => ({ ...f, title: s.title, body: s.body, cta_label: s.cta_label || f.cta_label }))
    setSuggestions([])
    toast.success('تم تطبيق الاقتراح — راجعه قبل الحفظ')
  }

  function startCreate() {
    setEditingId(null)
    setForm(EMPTY)
    setComposing(true)
  }

  function startEdit(a: AnnouncementRow) {
    setEditingId(a.id)
    setForm({
      title: a.title,
      body: a.body ?? '',
      image_url: a.image_url ?? '',
      link_url: a.link_url ?? '',
      cta_label: a.cta_label ?? '',
      audience: a.audience,
      group_ids: a.group_ids,
      starts_at: isoToLocalInput(a.starts_at),
      ends_at: isoToLocalInput(a.ends_at),
      is_published: a.is_published,
    })
    setComposing(true)
  }

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

  async function save() {
    if (!form.title.trim()) return toast.error('اكتب عنوان الإعلان')
    if (form.audience === 'groups' && form.group_ids.length === 0) {
      return toast.error('اختر مجموعة واحدة على الأقل')
    }
    const starts_at = localInputToIso(form.starts_at)
    const ends_at = localInputToIso(form.ends_at)
    if (form.starts_at && !starts_at) return toast.error('تاريخ البداية غير صالح')
    if (form.ends_at && !ends_at) return toast.error('تاريخ النهاية غير صالح')
    if (starts_at && ends_at && new Date(ends_at).getTime() <= new Date(starts_at).getTime()) {
      return toast.error('يجب أن يكون تاريخ النهاية بعد تاريخ البداية')
    }
    // A published announcement whose end is already past saves fine but is
    // invisible to every student — the exact silent failure seen live.
    if (form.is_published && ends_at && new Date(ends_at).getTime() <= Date.now()) {
      return toast.error('تاريخ النهاية مضى — لن يظهر الإعلان لأي طالب. غيّره أو اتركه فارغاً')
    }

    setBusy(true)
    const editing = editingId
    const res = await fetch('/api/announcements', {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, ...(editing ? { id: editing } : {}), starts_at, ends_at }),
    })
    const data = await res.json()
    setBusy(false)
    if (!res.ok) return toast.error(data.error ?? (editing ? 'تعذّر تحديث الإعلان' : 'تعذّر إنشاء الإعلان'))
    toast.success(editing ? 'تم حفظ التعديلات' : (form.is_published ? 'تم نشر الإعلان' : 'تم حفظ المسودة'))
    setForm(EMPTY)
    setEditingId(null)
    setComposing(false)
    router.refresh()
  }

  async function togglePublish(a: AnnouncementRow) {
    if (!a.is_published && announcementStatus({ ...a, is_published: true }) === 'ended') {
      return toast.error('انتهت مدة هذا الإعلان — عدّل تاريخ النهاية أولاً ليظهر للطلاب')
    }
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
          <h2 className="text-2xl font-bold text-white">الإعلانات</h2>
          <p className="text-slate-400 mt-1">
            {announcements.length} إعلان · {announcements.filter(a => a.is_published).length} منشور
          </p>
        </div>
        <Button onClick={() => {
          if (composing) { setComposing(false); setEditingId(null); setForm(EMPTY) } else { startCreate() }
        }}>
          <Plus className="w-4 h-4" /> إعلان جديد
        </Button>
      </div>

      {composing && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <h3 className="text-white font-semibold">{editingId ? 'تعديل الإعلان' : 'إعلان جديد'}</h3>

          {/* Free AI copy helper (Groq, text only) */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-2">
            <span className="text-sm text-slate-300 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-400" /> مساعد الصياغة (اختياري)
            </span>
            <div className="flex gap-2 flex-col sm:flex-row">
              <input
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                value={brief}
                maxLength={600}
                onChange={e => setBrief(e.target.value)}
                placeholder="صف الإعلان باختصار: دورة إكسل للمبتدئين، تبدأ الأحد، 4 أسابيع…"
              />
              <Button variant="ghost" loading={suggesting} onClick={suggestCopy}>اقترح صياغات</Button>
            </div>
            {suggestions.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {suggestions.map((s, i) => (
                  <button key={i} onClick={() => applySuggestion(s)}
                    className="text-start rounded-lg border border-slate-700 hover:border-blue-500 bg-slate-900 p-3 transition-colors">
                    <p className="text-white text-sm font-semibold">{s.title}</p>
                    <p className="text-slate-400 text-xs mt-1 line-clamp-3">{s.body}</p>
                    {s.cta_label && <p className="text-blue-300 text-xs mt-1.5">{s.cta_label}</p>}
                  </button>
                ))}
              </div>
            )}
            <p className="text-slate-600 text-xs">الاقتراحات نصية فقط ولا تُحفظ حتى تضغط «حفظ». راجع أي تاريخ أو رقم بنفسك.</p>
          </div>

          <label className="text-sm text-slate-300 space-y-1.5 block">
            <span>العنوان</span>
            <input
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="مثال: فتح التسجيل لدورة اللغة الإنجليزية"
            />
          </label>

          <label className="text-sm text-slate-300 space-y-1.5 block">
            <span>النص</span>
            <textarea
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm min-h-[90px]"
              value={form.body}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              placeholder="تفاصيل الإعلان…"
            />
          </label>

          {/* Image */}
          <div className="space-y-2">
            <span className="text-sm text-slate-300">صورة / تصميم (اختياري)</span>
            {form.image_url ? (
              <div className="relative w-full max-w-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={form.image_url} alt="معاينة" className="rounded-lg border border-slate-700 w-full object-cover max-h-48" />
                <button
                  onClick={() => setForm(f => ({ ...f, image_url: '' }))}
                  className="absolute top-2 start-2 bg-slate-900/80 rounded-full p-1.5 text-slate-300 hover:text-white"
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
                <div className="flex gap-2 flex-wrap">
                  <Button variant="ghost" onClick={() => setDesigning(true)}>
                    <Palette className="w-4 h-4" /> صمّم بانر
                  </Button>
                  <Button variant="ghost" loading={uploading} onClick={() => fileRef.current?.click()}>
                    <ImagePlus className="w-4 h-4" /> رفع صورة
                  </Button>
                </div>
                <p className="text-slate-500 text-xs mt-1">صمّم بانراً من قالب جاهز، أو ارفع صورة JPG / PNG / WebP / GIF حتى 4 ميغابايت</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-sm text-slate-300 space-y-1.5 block">
              <span>رابط (اختياري)</span>
              <input
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                value={form.link_url}
                onChange={e => setForm(f => ({ ...f, link_url: e.target.value }))}
                placeholder="https://…"
              />
            </label>
            <label className="text-sm text-slate-300 space-y-1.5 block">
              <span>نص الزر (اختياري)</span>
              <input
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                value={form.cta_label}
                onChange={e => setForm(f => ({ ...f, cta_label: e.target.value }))}
                placeholder="سجّل الآن"
              />
            </label>
          </div>

          {/* Audience */}
          <div className="space-y-2">
            <span className="text-sm text-slate-300">الجمهور</span>
            <div className="flex gap-2 flex-wrap">
              {AUDIENCE_OPTIONS.filter(opt => hasCenter || (opt.value !== 'university' && opt.value !== 'center')).map(opt => {
                const locked = opt.needsUniversity && !canTargetUniversity
                const Icon = locked ? Lock : opt.icon
                return (
                  <button
                    key={opt.value}
                    disabled={locked}
                    title={locked ? `تحتاج صلاحية «مخاطبة ${terms.institutionStudentsAr}»` : undefined}
                    onClick={() => setForm(f => ({ ...f, audience: opt.value }))}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-colors ${
                      locked
                        ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed'
                        : form.audience === opt.value
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-300'
                    }`}
                  ><Icon className="w-4 h-4" /> {audienceLabel(opt.value)}</button>
                )
              })}
            </div>
            {!canTargetUniversity && (
              <p className="text-slate-500 text-xs">
                إعلاناتك تصل لطلاب المركز فقط (المسجّلين في دورة، أو غير المصنّفين {terms.institutionStudentAr}).
                لمخاطبة {terms.institutionStudentsAr} اطلب صلاحية «مخاطبة {terms.institutionStudentsAr}».
              </p>
            )}
            {form.audience === 'groups' && (
              <div className="flex flex-wrap gap-2 pt-1">
                {groups.length === 0 && <p className="text-slate-500 text-xs">لا توجد مجموعات.</p>}
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
                        on ? 'bg-blue-600/20 border-blue-600 text-blue-300' : 'bg-slate-800 border-slate-700 text-slate-400'
                      }`}
                    >{g.name}</button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-sm text-slate-300 space-y-1.5 block">
              <span>يبدأ في (اختياري)</span>
              <input type="datetime-local"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                value={form.starts_at}
                onChange={e => setForm(f => ({ ...f, starts_at: e.target.value }))}
              />
            </label>
            <label className="text-sm text-slate-300 space-y-1.5 block">
              <span>ينتهي في (اختياري)</span>
              <input type="datetime-local"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                value={form.ends_at}
                onChange={e => setForm(f => ({ ...f, ends_at: e.target.value }))}
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.is_published}
              onChange={e => setForm(f => ({ ...f, is_published: e.target.checked }))} />
            نشر مباشرةً
          </label>

          {(form.title.trim() || form.body.trim() || form.image_url) && (
            <div className="space-y-1.5">
              <span className="text-sm text-slate-300">معاينة (كما يظهر للطالب)</span>
              <AnnouncementsBanner announcements={[{
                id: 'preview',
                title: form.title.trim() || 'عنوان الإعلان',
                body: form.body.trim() || null,
                image_url: form.image_url || null,
                link_url: form.link_url || null,
                cta_label: form.cta_label || null,
              }]} />
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => { setComposing(false); setEditingId(null); setForm(EMPTY) }}>إلغاء</Button>
            <Button loading={busy} onClick={save}>{editingId ? 'حفظ التعديلات' : 'حفظ'}</Button>
          </div>
        </div>
      )}

      <Modal open={designing} onClose={() => setDesigning(false)} title="تصميم بانر الإعلان" size="xl">
        {designing && (
          <BannerDesigner
            initialHeadline={form.title}
            initialSubline={form.body}
            onCancel={() => setDesigning(false)}
            onUploaded={url => { setForm(f => ({ ...f, image_url: url })); setDesigning(false) }}
          />
        )}
      </Modal>

      {announcements.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <Megaphone className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">لا توجد إعلانات بعد.</p>
          <p className="text-slate-500 text-sm mt-1">أنشئ إعلاناً ليظهر لطلابك في صفحتهم الرئيسية.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {announcements.map(a => {
            const status = announcementStatus(a)
            return (
            <div key={a.id} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              {a.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.image_url} alt="" className="h-36 w-full object-cover bg-slate-800" />
              )}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-white font-semibold">{a.title}</h3>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${STATUS_CLASS[status]}`}>
                    {STATUS_LABEL[status]}
                  </span>
                </div>
                {a.body && <p className="text-slate-400 text-sm mt-1 line-clamp-2">{a.body}</p>}
                <p className="text-slate-500 text-xs mt-2 flex items-center gap-1.5">
                  {a.audience === 'groups'
                    ? <><Users className="w-3 h-3" /> {a.group_ids.length} مجموعة</>
                    : <><Globe className="w-3 h-3" /> {AUDIENCE_LABEL[a.audience]}</>}
                  {a.center_students_only && a.audience !== 'center' && ' · طلاب المركز فقط'}
                  {' · '}{formatDate(a.created_at)}
                </p>
                <div className="flex gap-2 mt-3 flex-wrap">
                  <Button size="sm" variant="ghost" loading={busy} onClick={() => startEdit(a)}>
                    <Pencil className="w-3.5 h-3.5" /> تعديل
                  </Button>
                  <Button size="sm" variant="ghost" loading={busy} onClick={() => togglePublish(a)}>
                    {a.is_published ? <><EyeOff className="w-3.5 h-3.5" /> إخفاء</> : <><Eye className="w-3.5 h-3.5" /> نشر</>}
                  </Button>
                  <Button size="sm" variant="ghost" loading={busy} onClick={() => remove(a)}>
                    <Trash2 className="w-3.5 h-3.5" /> حذف
                  </Button>
                </div>
              </div>
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
