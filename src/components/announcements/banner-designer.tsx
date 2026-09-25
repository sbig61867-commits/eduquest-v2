'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { ImagePlus, Upload, X } from 'lucide-react'

// In-browser banner designer. Everything renders on a <canvas> on the
// author's own device — no design service, no AI image model, no cost.
// The final banner is exported as a compressed WebP (PNG where the browser
// can't encode WebP) and uploaded through the existing, validated
// /api/announcements/upload route; the database only ever stores its URL.

const W = 1200
const H = 400

interface Template {
  id: string
  bg: [string, string]
  text: string
  accent: string
  shape: 'circles' | 'diagonal' | 'dots' | 'waves' | 'none'
}

const TEMPLATES: Template[] = [
  { id: 'navy',   bg: ['#0f172a', '#1e3a8a'], text: '#ffffff', accent: '#60a5fa', shape: 'circles' },
  { id: 'emerald',        bg: ['#064e3b', '#047857'], text: '#ffffff', accent: '#6ee7b7', shape: 'diagonal' },
  { id: 'sunset',        bg: ['#7c2d12', '#ea580c'], text: '#ffffff', accent: '#fed7aa', shape: 'waves' },
  { id: 'violet',      bg: ['#2e1065', '#6d28d9'], text: '#ffffff', accent: '#c4b5fd', shape: 'dots' },
  { id: 'light',        bg: ['#f8fafc', '#e2e8f0'], text: '#0f172a', accent: '#2563eb', shape: 'diagonal' },
  { id: 'mono',   bg: ['#020617', '#111827'], text: '#f8fafc', accent: '#fbbf24', shape: 'none' },
]

interface Design {
  templateId: string
  headline: string
  subline: string
  badge: string
  footer: string
  accent: string
  overlay: number
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = word
      if (lines.length === maxLines) break
    } else {
      line = test
    }
  }
  if (lines.length < maxLines && line) lines.push(line)
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
    let last = lines[maxLines - 1]
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1)
    lines[maxLines - 1] = `${last}…`
  }
  return lines
}

function drawShapes(ctx: CanvasRenderingContext2D, t: Template, accent: string) {
  ctx.save()
  ctx.globalAlpha = t.id === 'light' ? 0.12 : 0.18
  ctx.fillStyle = accent
  ctx.strokeStyle = accent
  switch (t.shape) {
    case 'circles':
      ;[[120, 60, 180], [260, 380, 120], [40, 300, 60]].forEach(([x, y, r]) => {
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
      })
      break
    case 'diagonal':
      for (let i = -H; i < 420; i += 46) {
        ctx.lineWidth = 14
        ctx.beginPath(); ctx.moveTo(i, H); ctx.lineTo(i + H, 0); ctx.stroke()
      }
      break
    case 'dots':
      for (let x = 30; x < 420; x += 34) for (let y = 30; y < H; y += 34) {
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill()
      }
      break
    case 'waves':
      ctx.lineWidth = 10
      for (let k = 0; k < 5; k++) {
        ctx.beginPath()
        for (let x = 0; x <= 460; x += 10) {
          const y = 80 + k * 70 + Math.sin(x / 45 + k) * 22
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
      break
  }
  ctx.restore()
}

function render(ctx: CanvasRenderingContext2D, d: Design, photo: HTMLImageElement | null, fontFamily: string, fallbackHeadline: string) {
  const t = TEMPLATES.find(x => x.id === d.templateId) ?? TEMPLATES[0]
  ctx.clearRect(0, 0, W, H)

  const grad = ctx.createLinearGradient(0, 0, W, H)
  grad.addColorStop(0, t.bg[0]); grad.addColorStop(1, t.bg[1])
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  if (photo) {
    // "cover" fit, then a readability overlay the author controls.
    const scale = Math.max(W / photo.width, H / photo.height)
    const pw = photo.width * scale
    const ph = photo.height * scale
    ctx.drawImage(photo, (W - pw) / 2, (H - ph) / 2, pw, ph)
    ctx.fillStyle = t.id === 'light' ? `rgba(248,250,252,${d.overlay})` : `rgba(2,6,23,${d.overlay})`
    ctx.fillRect(0, 0, W, H)
  } else {
    drawShapes(ctx, t, d.accent)
  }

  ctx.direction = 'rtl'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'alphabetic'
  const right = W - 72
  const maxW = photo ? W - 144 : W - 520
  let y = 96

  if (d.badge.trim()) {
    ctx.font = `600 26px ${fontFamily}`
    const bw = ctx.measureText(d.badge.trim()).width + 40
    ctx.fillStyle = d.accent
    ctx.beginPath()
    ctx.roundRect(right - bw, y - 36, bw, 50, 25)
    ctx.fill()
    ctx.fillStyle = t.id === 'light' ? '#ffffff' : t.bg[0]
    ctx.fillText(d.badge.trim(), right - 20, y - 2)
    y += 58
  }

  ctx.fillStyle = t.text
  ctx.font = `700 60px ${fontFamily}`
  for (const line of wrapLines(ctx, d.headline.trim() || fallbackHeadline, maxW, 2)) {
    ctx.fillText(line, right, y + 40)
    y += 72
  }

  if (d.subline.trim()) {
    ctx.globalAlpha = 0.88
    ctx.font = `400 30px ${fontFamily}`
    for (const line of wrapLines(ctx, d.subline.trim(), maxW, 2)) {
      ctx.fillText(line, right, y + 30)
      y += 44
    }
    ctx.globalAlpha = 1
  }

  if (d.footer.trim()) {
    ctx.fillStyle = d.accent
    ctx.fillRect(right - 64, H - 78, 64, 5)
    ctx.fillStyle = t.text
    ctx.font = `600 26px ${fontFamily}`
    ctx.fillText(d.footer.trim(), right, H - 38)
  }
}

export function BannerDesigner({ initialHeadline, initialSubline, onUploaded, onCancel }: {
  initialHeadline: string
  initialSubline: string
  onUploaded: (url: string) => void
  onCancel: () => void
}) {
  const t = useTranslations('staff.banner')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null)
  const [fontsReady, setFontsReady] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [design, setDesign] = useState<Design>({
    templateId: TEMPLATES[0].id,
    headline: initialHeadline,
    subline: initialSubline.split('\n')[0]?.slice(0, 140) ?? '',
    badge: '',
    footer: '',
    accent: TEMPLATES[0].accent,
    overlay: 0.55,
  })

  // Canvas text needs the web font loaded, or the first paint falls back.
  useEffect(() => {
    let cancelled = false
    document.fonts.ready.then(() => { if (!cancelled) setFontsReady(true) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const family = getComputedStyle(document.body).fontFamily || 'sans-serif'
    render(ctx, design, photo, family, t('fallbackHeadline'))
  }, [design, photo, fontsReady, t])

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.src) }, [photo])

  function pickTemplate(t: Template) {
    setDesign(d => ({ ...d, templateId: t.id, accent: t.accent }))
  }

  function loadPhoto(file: File) {
    if (!file.type.startsWith('image/')) return toast.error(t('notAnImage'))
    if (file.size > 10 * 1024 * 1024) return toast.error(t('tooLarge'))
    const img = new Image()
    img.onload = () => setPhoto(img)
    img.onerror = () => toast.error(t('loadFailed'))
    img.src = URL.createObjectURL(file)
  }

  async function exportAndUpload() {
    const canvas = canvasRef.current
    if (!canvas) return
    setUploading(true)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.85))
    if (!blob) { setUploading(false); return toast.error(t('exportFailed')) }
    const ext = blob.type === 'image/webp' ? 'webp' : 'png'
    const fd = new FormData()
    fd.append('file', new File([blob], `banner.${ext}`, { type: blob.type }))
    const res = await fetch('/api/announcements/upload', { method: 'POST', body: fd })
    const data = await res.json().catch(() => ({}))
    setUploading(false)
    if (!res.ok) return toast.error(data.error ?? t('uploadFailed'))
    toast.success(t('uploaded', { size: Math.round(blob.size / 1024) }))
    onUploaded(data.url)
  }

  const field = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm'

  return (
    <div className="space-y-4">
      <div className="rounded-xl overflow-hidden border border-slate-700 bg-slate-950">
        <canvas ref={canvasRef} width={W} height={H} className="w-full h-auto block" aria-label={t('canvasAria')} />
      </div>

      <div className="flex gap-2 flex-wrap">
        {TEMPLATES.map(tpl => (
          <button
            key={tpl.id}
            onClick={() => pickTemplate(tpl)}
            aria-pressed={design.templateId === tpl.id}
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs border ${
              design.templateId === tpl.id ? 'border-blue-500 text-white' : 'border-slate-700 text-slate-400'
            }`}
          >
            <span className="w-5 h-5 rounded" style={{ background: `linear-gradient(135deg, ${tpl.bg[0]}, ${tpl.bg[1]})` }} />
            {t(`themes.${tpl.id}`)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="space-y-1 block text-sm text-slate-300">
          <span>{t('headline')}</span>
          <input className={field} maxLength={80} value={design.headline}
            onChange={e => setDesign(d => ({ ...d, headline: e.target.value }))} />
        </label>
        <label className="space-y-1 block text-sm text-slate-300">
          <span>{t('subline')}</span>
          <input className={field} maxLength={140} value={design.subline}
            onChange={e => setDesign(d => ({ ...d, subline: e.target.value }))} />
        </label>
        <label className="space-y-1 block text-sm text-slate-300">
          <span>{t('badge')}</span>
          <input className={field} maxLength={30} value={design.badge}
            onChange={e => setDesign(d => ({ ...d, badge: e.target.value }))} />
        </label>
        <label className="space-y-1 block text-sm text-slate-300">
          <span>{t('footer')}</span>
          <input className={field} maxLength={60} value={design.footer}
            onChange={e => setDesign(d => ({ ...d, footer: e.target.value }))} />
        </label>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          {t('accent')}
          <input type="color" value={design.accent}
            onChange={e => setDesign(d => ({ ...d, accent: e.target.value }))}
            className="w-9 h-9 rounded bg-transparent border border-slate-700" />
        </label>
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) loadPhoto(f); e.target.value = '' }} />
        {photo ? (
          <>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              {t('overlay')}
              <input type="range" min={0} max={0.85} step={0.05} value={design.overlay}
                onChange={e => setDesign(d => ({ ...d, overlay: Number(e.target.value) }))} />
            </label>
            <Button variant="ghost" size="sm" onClick={() => setPhoto(null)}><X className="w-3.5 h-3.5" /> {t('removePhoto')}</Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
            <ImagePlus className="w-3.5 h-3.5" /> {t('bgPhoto')}
          </Button>
        )}
      </div>

      <p className="text-slate-500 text-xs">
        {t('privacyNote')}
      </p>

      <div className="flex gap-2 justify-end">
        <Button variant="ghost" onClick={onCancel}>{t('cancel')}</Button>
        <Button loading={uploading} onClick={exportAndUpload}><Upload className="w-4 h-4" /> {t('use')}</Button>
      </div>
    </div>
  )
}
