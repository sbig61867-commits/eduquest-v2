'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { dirFor, type Locale } from '@/i18n/config'
import { Download, ImagePlus, Shuffle, Upload, X } from 'lucide-react'
import {
  H, ICONS, LAYOUTS, PALETTES, PATTERNS, PRESETS, W,
  paletteById, renderBanner,
  type Design, type HeadlineSize, type Preset, type TextDir, type TextField,
} from './banner-render'

// In-browser banner designer. Everything renders on a <canvas> on the
// author's own device — no design service, no AI image model, no cost.
// The final banner is exported as a compressed WebP (PNG where the browser
// can't encode WebP) and uploaded through the existing, validated
// /api/announcements/upload route; the database only ever stores its URL.
// Drawing lives in ./banner-render so the template gallery thumbnails are
// the real renderer, scaled down.

type Tab = 'templates' | 'text' | 'style' | 'image'
const TABS: Tab[] = ['templates', 'text', 'style', 'image']
const TEXT_FIELDS: TextField[] = ['headline', 'subline', 'badge', 'footer', 'highlight', 'caption']
const MAX_LEN: Record<TextField, number> = { headline: 80, subline: 140, badge: 30, footer: 60, highlight: 8, caption: 20 }
const THUMB_SCALE = 0.25

function fontFamily(): string {
  return getComputedStyle(document.body).fontFamily || 'sans-serif'
}

function styleOf(p: Preset): Pick<Design, 'layout' | 'pattern' | 'paletteId' | 'bg1' | 'bg2' | 'text' | 'accent' | 'icon' | 'size'> {
  const pal = paletteById(p.palette)
  return {
    layout: p.layout, pattern: p.pattern, paletteId: pal.id,
    bg1: pal.bg[0], bg2: pal.bg[1], text: pal.text, accent: pal.accent,
    icon: p.icon, size: p.size,
  }
}

function sampleText(t: (key: string) => string, p: Preset, f: TextField): string {
  return p.samples.includes(f) ? t(`presets.${p.id}.${f}`) : ''
}

function Thumb({ design, photo, fallbackHeadline, fallbackDir, fontsReady }: {
  design: Design
  photo: HTMLImageElement | null
  fallbackHeadline: string
  fallbackDir: 'rtl' | 'ltr'
  fontsReady: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    ctx.setTransform(THUMB_SCALE, 0, 0, THUMB_SCALE, 0, 0)
    renderBanner(ctx, design, photo, fontFamily(), fallbackHeadline, fallbackDir)
  }, [design, photo, fallbackHeadline, fallbackDir, fontsReady])
  return <canvas ref={ref} width={W * THUMB_SCALE} height={H * THUMB_SCALE} className="w-full h-auto block" />
}

export function BannerDesigner({ initialHeadline, initialSubline, onUploaded, onCancel }: {
  initialHeadline: string
  initialSubline: string
  onUploaded: (url: string) => void
  onCancel: () => void
}) {
  const t = useTranslations('staff.banner')
  const locale = useLocale() as Locale
  const uiDir = dirFor(locale)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<Tab>('templates')
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null)
  const [fontsReady, setFontsReady] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [presetId, setPresetId] = useState(PRESETS[0].id)

  const sample = (p: Preset, f: TextField) => sampleText(t, p, f)

  // Fields the author typed themselves; picking another template keeps them
  // and only swaps the sample wording of fields they never touched.
  const [edited, setEdited] = useState<Set<TextField>>(() => {
    const s = new Set<TextField>()
    if (initialHeadline.trim()) s.add('headline')
    if (initialSubline.trim()) s.add('subline')
    return s
  })

  const [design, setDesign] = useState<Design>(() => {
    const p = PRESETS[0]
    const texts = Object.fromEntries(TEXT_FIELDS.map(f => [f, sample(p, f)])) as Record<TextField, string>
    if (initialHeadline.trim()) texts.headline = initialHeadline.trim().slice(0, MAX_LEN.headline)
    const sub = initialSubline.split('\n')[0]?.trim().slice(0, MAX_LEN.subline) ?? ''
    if (sub) texts.subline = sub
    return { ...styleOf(p), dir: 'auto', overlay: 0.55, ...texts }
  })

  // Canvas text needs the web font loaded, or the first paint falls back —
  // and next/font only fetches a weight once the page uses it, so the bold
  // Arabic face may never have been requested yet. Ask for each weight.
  useEffect(() => {
    let cancelled = false
    const family = fontFamily()
    Promise.allSettled(['400', '600', '700'].map(w => document.fonts.load(`${w} 40px ${family}`, '\u0627\u0628\u062c\u062f abc')))
      .then(() => document.fonts.ready)
      .then(() => { if (!cancelled) setFontsReady(true) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    renderBanner(ctx, design, photo, fontFamily(), t('fallbackHeadline'), uiDir)
  }, [design, photo, fontsReady, t, uiDir])

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.src) }, [photo])

  // Each gallery card previews the author's own wording in that template.
  const presetDesigns = useMemo(() => PRESETS.map(p => {
    const texts = Object.fromEntries(TEXT_FIELDS.map(f => [f, edited.has(f) ? design[f] : sampleText(t, p, f)])) as Record<TextField, string>
    return { preset: p, design: { ...design, ...styleOf(p), ...texts } as Design }
  }), [design, edited, t])

  function applyPreset(p: Preset) {
    setPresetId(p.id)
    setDesign(d => {
      const texts = Object.fromEntries(TEXT_FIELDS.map(f => [f, edited.has(f) ? d[f] : sample(p, f)])) as Record<TextField, string>
      return { ...d, ...styleOf(p), ...texts }
    })
  }

  function setText(f: TextField, value: string) {
    setEdited(s => (s.has(f) ? s : new Set(s).add(f)))
    setDesign(d => ({ ...d, [f]: value }))
  }

  function pickPalette(id: string) {
    const pal = paletteById(id)
    setDesign(d => ({ ...d, paletteId: pal.id, bg1: pal.bg[0], bg2: pal.bg[1], text: pal.text, accent: pal.accent }))
  }

  function shuffle() {
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)]
    const pal = pick(PALETTES)
    setDesign(d => ({
      ...d,
      layout: pick(LAYOUTS),
      pattern: pick(PATTERNS),
      paletteId: pal.id, bg1: pal.bg[0], bg2: pal.bg[1], text: pal.text, accent: pal.accent,
    }))
  }

  function loadPhoto(file: File) {
    if (!file.type.startsWith('image/')) return toast.error(t('notAnImage'))
    if (file.size > 10 * 1024 * 1024) return toast.error(t('tooLarge'))
    const img = new Image()
    img.onload = () => setPhoto(img)
    img.onerror = () => toast.error(t('loadFailed'))
    img.src = URL.createObjectURL(file)
  }

  function toBlob(type: string, quality?: number) {
    return new Promise<Blob | null>(resolve => {
      const canvas = canvasRef.current
      if (!canvas) return resolve(null)
      canvas.toBlob(resolve, type, quality)
    })
  }

  async function download() {
    const blob = await toBlob('image/png')
    if (!blob) return toast.error(t('exportFailed'))
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'banner.png'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function exportAndUpload() {
    setUploading(true)
    try {
      const blob = await toBlob('image/webp', 0.85)
      if (!blob) return toast.error(t('exportFailed'))
      const ext = blob.type === 'image/webp' ? 'webp' : 'png'
      const fd = new FormData()
      fd.append('file', new File([blob], `banner.${ext}`, { type: blob.type }))
      const res = await fetch('/api/announcements/upload', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(data.error ?? t('uploadFailed'))
      toast.success(t('uploaded', { size: Math.round(blob.size / 1024) }))
      onUploaded(data.url)
    } catch {
      // Network failure: without this the button stayed in its loading state forever.
      toast.error(t('uploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  const field = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm'
  const chip = (on: boolean) =>
    `px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${on ? 'border-blue-500 bg-blue-500/10 text-white' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`

  return (
    <div className="space-y-4">
      <div className="rounded-xl overflow-hidden border border-slate-700 bg-slate-950">
        <canvas ref={canvasRef} width={W} height={H} className="w-full h-auto block" aria-label={t('canvasAria')} />
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1 bg-slate-800/60 rounded-lg p-1" role="tablist">
          {TABS.map(id => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${tab === id ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
              {t(`tabs.${id}`)}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={shuffle}><Shuffle className="w-3.5 h-3.5" /> {t('shuffle')}</Button>
      </div>

      {tab === 'templates' && (
        <div className="space-y-2">
          <p className="text-slate-500 text-xs">{t('templatesHint')}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[21rem] overflow-y-auto pe-1">
            {presetDesigns.map(({ preset, design: pd }) => (
              <button key={preset.id} onClick={() => applyPreset(preset)} aria-pressed={presetId === preset.id}
                className={`text-start rounded-lg overflow-hidden border-2 transition-colors ${presetId === preset.id ? 'border-blue-500' : 'border-slate-800 hover:border-slate-600'}`}>
                <Thumb design={pd} photo={photo} fallbackHeadline={t('fallbackHeadline')} fallbackDir={uiDir} fontsReady={fontsReady} />
                <span className="block px-2 py-1.5 text-xs text-slate-300 bg-slate-900">{t(`presets.${preset.id}.name`)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === 'text' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {TEXT_FIELDS.map(f => (
            <label key={f} className="space-y-1 block text-sm text-slate-300">
              <span>{t(f)}</span>
              <input className={field} maxLength={MAX_LEN[f]} value={design[f]} dir="auto"
                onChange={e => setText(f, e.target.value)} />
            </label>
          ))}
          <p className="text-slate-500 text-xs md:col-span-2">{t('highlightHint')}</p>
        </div>
      )}

      {tab === 'style' && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <span className="text-sm text-slate-300">{t('layout')}</span>
            <div className="flex gap-2 flex-wrap">
              {LAYOUTS.map(l => (
                <button key={l} className={chip(design.layout === l)} aria-pressed={design.layout === l}
                  onClick={() => setDesign(d => ({ ...d, layout: l }))}>{t(`layouts.${l}`)}</button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-sm text-slate-300">{t('palette')}</span>
            <div className="flex gap-2 flex-wrap">
              {PALETTES.map(p => (
                <button key={p.id} onClick={() => pickPalette(p.id)} aria-pressed={design.paletteId === p.id}
                  className={`flex items-center gap-2 ${chip(design.paletteId === p.id)}`}>
                  <span className="w-5 h-5 rounded relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${p.bg[0]}, ${p.bg[1]})` }}>
                    <span className="absolute bottom-0 end-0 w-2 h-2 rounded-tl" style={{ background: p.accent }} />
                  </span>
                  {t(`themes.${p.id}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-sm text-slate-300">{t('pattern')}</span>
            <div className="flex gap-2 flex-wrap">
              {PATTERNS.map(p => (
                <button key={p} className={chip(design.pattern === p)} aria-pressed={design.pattern === p}
                  onClick={() => setDesign(d => ({ ...d, pattern: p }))}>{t(`patterns.${p}`)}</button>
              ))}
            </div>
            {photo && <p className="text-slate-500 text-xs">{t('patternHiddenByPhoto')}</p>}
          </div>

          <div className="space-y-1.5">
            <span className="text-sm text-slate-300">{t('icon')}</span>
            <div className="flex gap-1.5 flex-wrap">
              {ICONS.map(ic => (
                <button key={ic || 'none'} onClick={() => setDesign(d => ({ ...d, icon: ic }))} aria-pressed={design.icon === ic}
                  aria-label={ic || t('noIcon')}
                  className={`w-9 h-9 rounded-lg border text-lg flex items-center justify-center ${design.icon === ic ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700'}`}>
                  {ic || <X className="w-4 h-4 text-slate-500" />}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-6 flex-wrap">
            <div className="space-y-1.5">
              <span className="text-sm text-slate-300">{t('size')}</span>
              <div className="flex gap-2">
                {(['sm', 'md', 'lg'] as HeadlineSize[]).map(s => (
                  <button key={s} className={chip(design.size === s)} aria-pressed={design.size === s}
                    onClick={() => setDesign(d => ({ ...d, size: s }))}>{t(`sizes.${s}`)}</button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <span className="text-sm text-slate-300">{t('direction')}</span>
              <div className="flex gap-2">
                {(['auto', 'rtl', 'ltr'] as TextDir[]).map(v => (
                  <button key={v} className={chip(design.dir === v)} aria-pressed={design.dir === v}
                    onClick={() => setDesign(d => ({ ...d, dir: v }))}>{t(`directions.${v}`)}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            {(['bg1', 'bg2', 'text', 'accent'] as const).map(k => (
              <label key={k} className="flex items-center gap-2 text-sm text-slate-300">
                {t(`colors.${k}`)}
                <input type="color" value={design[k]}
                  onChange={e => setDesign(d => ({ ...d, [k]: e.target.value }))}
                  className="w-9 h-9 rounded bg-transparent border border-slate-700" />
              </label>
            ))}
          </div>
        </div>
      )}

      {tab === 'image' && (
        <div className="space-y-3">
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) loadPhoto(f); e.target.value = '' }} />
          <div className="flex items-center gap-4 flex-wrap">
            {photo ? (
              <>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  {t('overlay')}
                  <input type="range" min={0} max={0.85} step={0.05} value={design.overlay}
                    onChange={e => setDesign(d => ({ ...d, overlay: Number(e.target.value) }))} />
                </label>
                <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
                  <ImagePlus className="w-3.5 h-3.5" /> {t('replacePhoto')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setPhoto(null)}><X className="w-3.5 h-3.5" /> {t('removePhoto')}</Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
                <ImagePlus className="w-3.5 h-3.5" /> {t('bgPhoto')}
              </Button>
            )}
          </div>
          <p className="text-slate-500 text-xs">{t('privacyNote')}</p>
        </div>
      )}

      <div className="flex gap-2 justify-end flex-wrap">
        <Button variant="ghost" onClick={onCancel}>{t('cancel')}</Button>
        <Button variant="ghost" onClick={download}><Download className="w-4 h-4" /> {t('download')}</Button>
        <Button loading={uploading} onClick={exportAndUpload}><Upload className="w-4 h-4" /> {t('use')}</Button>
      </div>
    </div>
  )
}
