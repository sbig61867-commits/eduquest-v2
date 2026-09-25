// Pure canvas renderer for the announcement banner designer. No React, no
// network — everything is drawn on the author's device. Split out of
// banner-designer.tsx so the gallery thumbnails and the full-size preview
// share exactly the same drawing code (a thumbnail is the real render,
// scaled down, not an approximation).

export const W = 1200
export const H = 400

export type Layout = 'classic' | 'centered' | 'split' | 'event' | 'card' | 'ribbon' | 'minimal' | 'frame'
export type Pattern = 'circles' | 'diagonal' | 'dots' | 'waves' | 'grid' | 'triangles' | 'rings' | 'confetti' | 'stars' | 'none'
export type HeadlineSize = 'sm' | 'md' | 'lg'
export type TextDir = 'auto' | 'rtl' | 'ltr'

export const LAYOUTS: Layout[] = ['classic', 'centered', 'split', 'event', 'card', 'ribbon', 'minimal', 'frame']
export const PATTERNS: Pattern[] = ['circles', 'diagonal', 'dots', 'waves', 'grid', 'triangles', 'rings', 'confetti', 'stars', 'none']

export interface Palette {
  id: string
  bg: [string, string]
  text: string
  accent: string
  /** Light background: dark overlay text, lighter pattern alpha, light photo overlay. */
  light?: boolean
}

export const PALETTES: Palette[] = [
  { id: 'navy',     bg: ['#0f172a', '#1e3a8a'], text: '#ffffff', accent: '#60a5fa' },
  { id: 'emerald',  bg: ['#064e3b', '#047857'], text: '#ffffff', accent: '#6ee7b7' },
  { id: 'sunset',   bg: ['#7c2d12', '#ea580c'], text: '#ffffff', accent: '#fed7aa' },
  { id: 'violet',   bg: ['#2e1065', '#6d28d9'], text: '#ffffff', accent: '#c4b5fd' },
  { id: 'rose',     bg: ['#500724', '#be185d'], text: '#ffffff', accent: '#fbcfe8' },
  { id: 'teal',     bg: ['#042f2e', '#0f766e'], text: '#ffffff', accent: '#5eead4' },
  { id: 'sky',      bg: ['#0c4a6e', '#0284c7'], text: '#ffffff', accent: '#bae6fd' },
  { id: 'crimson',  bg: ['#450a0a', '#b91c1c'], text: '#ffffff', accent: '#fde047' },
  { id: 'heritage', bg: ['#052e16', '#14532d'], text: '#fefce8', accent: '#facc15' },
  { id: 'mono',     bg: ['#020617', '#111827'], text: '#f8fafc', accent: '#fbbf24' },
  { id: 'light',    bg: ['#f8fafc', '#e2e8f0'], text: '#0f172a', accent: '#2563eb', light: true },
  { id: 'sand',     bg: ['#fffbeb', '#fde68a'], text: '#422006', accent: '#b45309', light: true },
]

export const ICONS = ['', '📢', '🎓', '📝', '📚', '⏰', '📅', '🎉', '🏆', '⭐', '💡', '⚠️', '💻', '🌙', '🕌', '🎁', '✅', '🔔']

/** Text fields a template can pre-fill with sample wording (from the i18n catalogue). */
export type TextField = 'badge' | 'headline' | 'subline' | 'footer' | 'highlight' | 'caption'

export interface Preset {
  id: string
  layout: Layout
  palette: string
  pattern: Pattern
  icon: string
  size: HeadlineSize
  /** Which fields have sample wording under `staff.banner.presets.<id>.<field>`. */
  samples: TextField[]
}

export const PRESETS: Preset[] = [
  { id: 'general',      layout: 'classic',  palette: 'navy',     pattern: 'circles',   icon: '📢', size: 'md', samples: ['badge', 'headline', 'subline', 'footer'] },
  { id: 'registration', layout: 'split',    palette: 'emerald',  pattern: 'diagonal',  icon: '📝', size: 'md', samples: ['badge', 'headline', 'subline', 'footer'] },
  { id: 'exam',         layout: 'event',    palette: 'crimson',  pattern: 'grid',      icon: '⏰', size: 'md', samples: ['badge', 'headline', 'subline', 'highlight', 'caption'] },
  { id: 'event',        layout: 'centered', palette: 'violet',   pattern: 'confetti',  icon: '🎉', size: 'lg', samples: ['badge', 'headline', 'subline', 'footer'] },
  { id: 'achievement',  layout: 'card',     palette: 'heritage', pattern: 'stars',     icon: '🏆', size: 'md', samples: ['badge', 'headline', 'subline', 'footer'] },
  { id: 'holiday',      layout: 'frame',    palette: 'teal',     pattern: 'stars',     icon: '🌙', size: 'lg', samples: ['headline', 'subline', 'footer'] },
  { id: 'urgent',       layout: 'ribbon',   palette: 'mono',     pattern: 'diagonal',  icon: '⚠️', size: 'md', samples: ['badge', 'headline', 'subline', 'footer'] },
  { id: 'offer',        layout: 'split',    palette: 'sunset',   pattern: 'rings',     icon: '🎁', size: 'md', samples: ['badge', 'headline', 'subline', 'highlight', 'caption'] },
  { id: 'webinar',      layout: 'minimal',  palette: 'light',    pattern: 'dots',      icon: '💻', size: 'md', samples: ['badge', 'headline', 'subline', 'footer'] },
  { id: 'course',       layout: 'classic',  palette: 'sky',      pattern: 'waves',     icon: '📚', size: 'md', samples: ['badge', 'headline', 'subline', 'footer'] },
  { id: 'deadline',     layout: 'event',    palette: 'sand',     pattern: 'triangles', icon: '📅', size: 'md', samples: ['badge', 'headline', 'subline', 'highlight', 'caption'] },
  { id: 'welcome',      layout: 'centered', palette: 'rose',     pattern: 'rings',     icon: '🎓', size: 'lg', samples: ['headline', 'subline', 'footer'] },
]

export interface Design {
  layout: Layout
  pattern: Pattern
  paletteId: string
  bg1: string
  bg2: string
  text: string
  accent: string
  icon: string
  size: HeadlineSize
  dir: TextDir
  headline: string
  subline: string
  badge: string
  footer: string
  highlight: string
  caption: string
  overlay: number
}

export function paletteById(id: string): Palette {
  return PALETTES.find(p => p.id === id) ?? PALETTES[0]
}

const RTL_CHARS = /[֐-ࣿיִ-﷿ﹰ-﻿]/
const LTR_CHARS = /[A-Za-zÀ-ɏ]/

/** Direction of the banner text: explicit, else the first strong character, else the UI locale. */
export function resolveDir(d: Pick<Design, 'dir' | 'headline' | 'subline'>, fallback: 'rtl' | 'ltr'): 'rtl' | 'ltr' {
  if (d.dir !== 'auto') return d.dir
  for (const ch of `${d.headline} ${d.subline}`) {
    if (RTL_CHARS.test(ch)) return 'rtl'
    if (LTR_CHARS.test(ch)) return 'ltr'
  }
  return fallback
}

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 0
  const n = parseInt(m[1], 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

/** Readable ink for text drawn on top of `bg`. */
export function inkOn(bg: string): string {
  return luminance(bg) > 0.45 ? '#0f172a' : '#ffffff'
}

export function isLightColor(hex: string): boolean {
  return luminance(hex) > 0.5
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): { lines: string[]; truncated: boolean } {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  let i = 0
  for (; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i]
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = words[i]
      if (lines.length === maxLines) break
    } else {
      line = test
    }
  }
  if (lines.length < maxLines && line) { lines.push(line); line = '' }
  // A single word wider than the box, or text left over after maxLines.
  let truncated = lines.length === maxLines && i < words.length
  const out = lines.map(l => {
    if (ctx.measureText(l).width <= maxWidth) return l
    truncated = true
    return l
  })
  if (truncated) {
    let last = out[out.length - 1] ?? ''
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1)
    out[out.length - 1] = `${last}…`
  }
  return { lines: out, truncated }
}

// Deterministic pseudo-random numbers so confetti doesn't jump on every keystroke.
function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

interface Rect { x: number; y: number; w: number; h: number }

function drawPattern(ctx: CanvasRenderingContext2D, pattern: Pattern, color: string, r: Rect, alpha: number) {
  if (pattern === 'none') return
  ctx.save()
  ctx.beginPath()
  ctx.rect(r.x, r.y, r.w, r.h)
  ctx.clip()
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.strokeStyle = color
  switch (pattern) {
    case 'circles':
      ;[[0.25, 0.15, 180], [0.6, 0.95, 120], [0.08, 0.75, 60], [0.9, 0.3, 40]].forEach(([fx, fy, rad]) => {
        ctx.beginPath(); ctx.arc(r.x + fx * r.w, r.y + fy * r.h, rad, 0, Math.PI * 2); ctx.fill()
      })
      break
    case 'diagonal':
      ctx.lineWidth = 14
      for (let i = r.x - r.h; i < r.x + r.w; i += 46) {
        ctx.beginPath(); ctx.moveTo(i, r.y + r.h); ctx.lineTo(i + r.h, r.y); ctx.stroke()
      }
      break
    case 'dots':
      for (let x = r.x + 20; x < r.x + r.w; x += 34) for (let y = r.y + 20; y < r.y + r.h; y += 34) {
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill()
      }
      break
    case 'waves':
      ctx.lineWidth = 10
      for (let k = 0; k < Math.ceil(r.h / 70) + 1; k++) {
        ctx.beginPath()
        for (let x = r.x; x <= r.x + r.w; x += 10) {
          const y = r.y + 40 + k * 70 + Math.sin(x / 45 + k) * 22
          if (x === r.x) ctx.moveTo(x, y); else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
      break
    case 'grid':
      ctx.lineWidth = 2
      for (let x = r.x; x <= r.x + r.w; x += 40) { ctx.beginPath(); ctx.moveTo(x, r.y); ctx.lineTo(x, r.y + r.h); ctx.stroke() }
      for (let y = r.y; y <= r.y + r.h; y += 40) { ctx.beginPath(); ctx.moveTo(r.x, y); ctx.lineTo(r.x + r.w, y); ctx.stroke() }
      break
    case 'triangles': {
      ctx.lineWidth = 3
      const s = 70
      const h = s * 0.866
      for (let row = 0, y = r.y - h; y < r.y + r.h; row++, y += h) {
        for (let x = r.x - s + (row % 2 ? s / 2 : 0); x < r.x + r.w; x += s) {
          ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + s / 2, y); ctx.lineTo(x + s, y + h); ctx.closePath(); ctx.stroke()
        }
      }
      break
    }
    case 'rings': {
      ctx.lineWidth = 8
      const cx = r.x + r.w * 0.5
      const cy = r.y + r.h * 0.5
      for (let rad = 30; rad < Math.max(r.w, r.h); rad += 44) {
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke()
      }
      break
    }
    case 'confetti': {
      const rnd = seeded(7)
      const count = Math.round((r.w * r.h) / 2600)
      for (let i = 0; i < count; i++) {
        ctx.save()
        ctx.translate(r.x + rnd() * r.w, r.y + rnd() * r.h)
        ctx.rotate(rnd() * Math.PI)
        ctx.globalAlpha = alpha * (0.6 + rnd() * 0.8)
        if (rnd() > 0.5) ctx.fillRect(-7, -3, 14, 6)
        else { ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill() }
        ctx.restore()
      }
      break
    }
    case 'stars': {
      // Eight-point star lattice (two overlaid squares) — a light nod to
      // geometric patterns without any image asset.
      ctx.lineWidth = 2.5
      const step = 80
      for (let row = 0, y = r.y; y < r.y + r.h + step; row++, y += step) {
        for (let x = r.x + (row % 2 ? step / 2 : 0); x < r.x + r.w + step; x += step) {
          for (const rot of [0, Math.PI / 4]) {
            ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.strokeRect(-18, -18, 36, 36); ctx.restore()
          }
        }
      }
      break
    }
  }
  ctx.restore()
}

function emojiFont(px: number, family: string) {
  return `${px}px ${family}, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
}

interface TextBox {
  /** Anchor x: the right edge for rtl, left edge for ltr, the centre for centred. */
  x: number
  top: number
  bottom: number
  maxW: number
  align: 'start' | 'center'
}

interface Ctx {
  ctx: CanvasRenderingContext2D
  d: Design
  dir: 'rtl' | 'ltr'
  font: string
  fallbackHeadline: string
}

function canvasAlign(c: Ctx, align: 'start' | 'center'): CanvasTextAlign {
  if (align === 'center') return 'center'
  return c.dir === 'rtl' ? 'right' : 'left'
}

function drawBadge(c: Ctx, text: string, x: number, y: number, align: 'start' | 'center') {
  const { ctx, d } = c
  ctx.font = `600 26px ${c.font}`
  const bw = ctx.measureText(text).width + 40
  const left = align === 'center' ? x - bw / 2 : c.dir === 'rtl' ? x - bw : x
  ctx.fillStyle = d.accent
  ctx.beginPath()
  ctx.roundRect(left, y, bw, 48, 24)
  ctx.fill()
  ctx.fillStyle = inkOn(d.accent)
  ctx.textAlign = 'center'
  ctx.fillText(text, left + bw / 2, y + 33)
}

/**
 * Lays out badge · headline · subline, vertically centred in the box, with the
 * footer pinned to the bottom. The headline shrinks until it fits in two lines
 * rather than being cut off — the old designer truncated long titles.
 */
function drawTextBlock(c: Ctx, box: TextBox, opts: { badge?: boolean; icon?: boolean; underline?: boolean } = {}) {
  const { ctx, d } = c
  const badge = opts.badge !== false ? d.badge.trim() : ''
  const icon = opts.icon ? d.icon : ''
  const footer = d.footer.trim()
  const base = d.size === 'sm' ? 50 : d.size === 'lg' ? 72 : 62
  const headlineText = d.headline.trim() || c.fallbackHeadline

  const footerH = footer ? 68 : 0
  const avail = box.bottom - footerH - box.top

  // Fit, in order of what to give up first: shrink the headline, then drop
  // the icon, then cut the subline to one line. Nothing is ever drawn outside
  // the box — the old designer overflowed long titles into the footer.
  const fit = (size: number, withIcon: boolean, subMax: number) => {
    ctx.font = `700 ${size}px ${c.font}`
    const head = wrapLines(ctx, headlineText, box.maxW, 2)
    const subSize = Math.round(Math.max(24, size * 0.46))
    ctx.font = `400 ${subSize}px ${c.font}`
    const sub = d.subline.trim() ? wrapLines(ctx, d.subline.trim(), box.maxW, subMax).lines : []
    const lineH = Math.round(size * 1.18)
    const subLineH = Math.round(subSize * 1.4)
    const total = (withIcon ? 76 : 0) + (badge ? 66 : 0) + head.lines.length * lineH
      + (opts.underline ? 28 : 0) + (sub.length ? 10 + sub.length * subLineH : 0)
    return { size, withIcon, head, sub, subSize, lineH, subLineH, total, ok: !head.truncated && total <= avail }
  }
  const phases: [boolean, number][] = icon ? [[true, 2], [false, 2], [false, 1]] : [[false, 2], [false, 1]]
  let m = fit(base, !!icon, 2)
  search: for (let i = 0; i < phases.length; i++) {
    const floor = i === phases.length - 1 ? 34 : 44
    for (let s = base; s >= floor; s -= 4) {
      m = fit(s, phases[i][0], phases[i][1])
      if (m.ok) break search
    }
  }
  const { size, head, sub, subSize, lineH, subLineH, total } = m
  const showIcon = m.withIcon
  let y = box.top + Math.max(0, (avail - total) / 2)

  ctx.direction = c.dir
  ctx.textBaseline = 'alphabetic'

  if (showIcon) {
    ctx.font = emojiFont(60, c.font)
    ctx.textAlign = canvasAlign(c, box.align)
    ctx.fillText(icon, box.x, y + 60)
    y += 76
  }
  if (badge) {
    drawBadge(c, badge, box.x, y, box.align)
    y += 66
  }

  ctx.textAlign = canvasAlign(c, box.align)
  ctx.fillStyle = d.text
  ctx.font = `700 ${size}px ${c.font}`
  for (const line of head.lines) {
    ctx.fillText(line, box.x, y + size)
    y += lineH
  }

  if (opts.underline) {
    ctx.fillStyle = d.accent
    const uw = 120
    const ux = box.align === 'center' ? box.x - uw / 2 : c.dir === 'rtl' ? box.x - uw : box.x
    ctx.fillRect(ux, y + 8, uw, 6)
    y += 28
  }

  if (sub.length) {
    y += 10
    ctx.fillStyle = d.text
    ctx.globalAlpha = 0.88
    ctx.font = `400 ${subSize}px ${c.font}`
    for (const line of sub) {
      ctx.fillText(line, box.x, y + subSize)
      y += subLineH
    }
    ctx.globalAlpha = 1
  }

  if (footer) {
    const fy = box.bottom - 14
    ctx.font = `600 26px ${c.font}`
    ctx.fillStyle = d.text
    ctx.textAlign = canvasAlign(c, box.align)
    const fw = Math.min(ctx.measureText(footer).width, box.maxW)
    ctx.fillText(footer, box.x, fy, box.maxW)
    // short accent rule before the footer text
    ctx.fillStyle = d.accent
    if (box.align === 'center') ctx.fillRect(box.x - 32, fy - 38, 64, 5)
    else {
      const rx = c.dir === 'rtl' ? box.x - Math.min(64, fw) : box.x
      ctx.fillRect(rx, fy - 38, Math.min(64, fw), 5)
    }
  }
}

/** Big centred highlight (e.g. "15" / "Oct", "30%" / "off") or the icon when there is none. */
function drawHighlight(c: Ctx, cx: number, cy: number, ink: string, maxW: number) {
  const { ctx, d } = c
  const hl = d.highlight.trim()
  const cap = d.caption.trim()
  ctx.save()
  ctx.direction = c.dir
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = ink
  if (hl) {
    let size = 112
    ctx.font = `700 ${size}px ${c.font}`
    while (size > 40 && ctx.measureText(hl).width > maxW) { size -= 6; ctx.font = `700 ${size}px ${c.font}` }
    const capSize = 32
    const total = size * 0.8 + (cap ? capSize + 18 : 0)
    const top = cy - total / 2
    ctx.fillText(hl, cx, top + size * 0.8)
    if (cap) {
      ctx.font = `600 ${capSize}px ${c.font}`
      ctx.globalAlpha = 0.9
      ctx.fillText(cap, cx, top + size * 0.8 + 18 + capSize, maxW)
    }
  } else if (d.icon) {
    ctx.font = emojiFont(120, c.font)
    ctx.textBaseline = 'middle'
    ctx.fillText(d.icon, cx, cy + 6)
  } else if (d.badge.trim()) {
    ctx.font = `700 44px ${c.font}`
    ctx.fillText(d.badge.trim(), cx, cy + 16, maxW)
  }
  ctx.restore()
}

export function renderBanner(
  ctx: CanvasRenderingContext2D,
  d: Design,
  photo: HTMLImageElement | null,
  fontFamily: string,
  fallbackHeadline: string,
  fallbackDir: 'rtl' | 'ltr',
) {
  const dir = resolveDir(d, fallbackDir)
  const c: Ctx = { ctx, d, dir, font: fontFamily, fallbackHeadline }
  const lightBg = isLightColor(d.bg1)
  const patternAlpha = lightBg ? 0.12 : 0.18
  const M = 72
  // "start" = the side text begins on; "end" = the opposite side.
  const startX = dir === 'rtl' ? W - M : M
  const endSide = (w: number): Rect => (dir === 'rtl' ? { x: 0, y: 0, w, h: H } : { x: W - w, y: 0, w, h: H })

  ctx.save()
  ctx.clearRect(0, 0, W, H)
  const grad = ctx.createLinearGradient(0, 0, W, H)
  grad.addColorStop(0, d.bg1); grad.addColorStop(1, d.bg2)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  if (photo) {
    // "cover" fit, then a readability overlay the author controls.
    const scale = Math.max(W / photo.width, H / photo.height)
    const pw = photo.width * scale
    const ph = photo.height * scale
    ctx.drawImage(photo, (W - pw) / 2, (H - ph) / 2, pw, ph)
    ctx.fillStyle = lightBg ? `rgba(248,250,252,${d.overlay})` : `rgba(2,6,23,${d.overlay})`
    ctx.fillRect(0, 0, W, H)
  }
  const pattern: Pattern = photo ? 'none' : d.pattern

  switch (d.layout) {
    case 'classic': {
      drawPattern(ctx, pattern, d.accent, endSide(460), patternAlpha)
      if (d.icon && !photo) {
        const r = endSide(460)
        ctx.save()
        ctx.font = emojiFont(130, fontFamily)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(d.icon, r.x + r.w / 2, H / 2 + 6)
        ctx.restore()
      }
      drawTextBlock(c, { x: startX, top: 44, bottom: H - 30, maxW: photo ? W - 2 * M : W - 460 - M - 40, align: 'start' })
      break
    }
    case 'centered':
      drawPattern(ctx, pattern, d.accent, { x: 0, y: 0, w: W, h: H }, patternAlpha * 0.6)
      drawTextBlock(c, { x: W / 2, top: 36, bottom: H - 26, maxW: W - 240, align: 'center' }, { icon: true })
      break
    case 'split': {
      const pw = 400
      const slant = 60
      ctx.save()
      ctx.beginPath()
      if (dir === 'rtl') { ctx.moveTo(0, 0); ctx.lineTo(pw + slant, 0); ctx.lineTo(pw, H); ctx.lineTo(0, H) }
      else { ctx.moveTo(W, 0); ctx.lineTo(W - pw - slant, 0); ctx.lineTo(W - pw, H); ctx.lineTo(W, H) }
      ctx.closePath()
      ctx.fillStyle = d.accent
      ctx.fill()
      ctx.clip()
      drawPattern(ctx, pattern, inkOn(d.accent), endSide(pw + slant), 0.12)
      ctx.restore()
      const cx = dir === 'rtl' ? pw / 2 + 10 : W - pw / 2 - 10
      drawHighlight(c, cx, H / 2, inkOn(d.accent), pw - 70)
      drawTextBlock(c, { x: startX, top: 44, bottom: H - 30, maxW: W - pw - slant - M - 40, align: 'start' })
      break
    }
    case 'event': {
      drawPattern(ctx, pattern, d.accent, { x: 0, y: 0, w: W, h: H }, patternAlpha * 0.5)
      const size = 240
      const bx = dir === 'rtl' ? 80 : W - 80 - size
      const by = (H - size) / 2
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.25)'
      ctx.shadowBlur = 24
      ctx.shadowOffsetY = 8
      ctx.fillStyle = d.accent
      ctx.beginPath(); ctx.roundRect(bx, by, size, size, 28); ctx.fill()
      ctx.restore()
      // calendar-style top strip
      ctx.fillStyle = 'rgba(0,0,0,0.18)'
      ctx.beginPath(); ctx.roundRect(bx, by, size, 44, [28, 28, 0, 0]); ctx.fill()
      drawHighlight(c, bx + size / 2, by + size / 2 + 20, inkOn(d.accent), size - 40)
      drawTextBlock(c, { x: startX, top: 44, bottom: H - 30, maxW: W - size - 80 - M - 56, align: 'start' })
      break
    }
    case 'card': {
      drawPattern(ctx, pattern, d.accent, { x: 0, y: 0, w: W, h: H }, patternAlpha)
      const inset = { x: 48, y: 40, w: W - 96, h: H - 80 }
      ctx.save()
      ctx.fillStyle = lightBg ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.09)'
      ctx.strokeStyle = d.accent
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.roundRect(inset.x, inset.y, inset.w, inset.h, 26); ctx.fill(); ctx.stroke()
      ctx.fillStyle = d.accent
      const barX = dir === 'rtl' ? inset.x + inset.w - 10 : inset.x
      ctx.beginPath(); ctx.roundRect(barX, inset.y + 40, 10, inset.h - 80, 5); ctx.fill()
      ctx.restore()
      const iconW = d.icon ? 170 : 0
      if (d.icon) {
        ctx.save()
        ctx.font = emojiFont(100, fontFamily)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(d.icon, dir === 'rtl' ? inset.x + 100 : inset.x + inset.w - 100, H / 2 + 6)
        ctx.restore()
      }
      const x = dir === 'rtl' ? inset.x + inset.w - 50 : inset.x + 50
      drawTextBlock(c, { x, top: inset.y + 18, bottom: inset.y + inset.h - 10, maxW: inset.w - 100 - iconW, align: 'start' })
      break
    }
    case 'ribbon': {
      drawPattern(ctx, pattern, d.accent, endSide(420), patternAlpha * 0.8)
      // bottom accent bar
      ctx.fillStyle = d.accent
      ctx.fillRect(0, H - 12, W, 12)
      const badge = d.badge.trim()
      if (badge) {
        ctx.save()
        const cx = dir === 'rtl' ? 0 : W
        ctx.translate(cx, 0)
        ctx.rotate(dir === 'rtl' ? -Math.PI / 4 : Math.PI / 4)
        ctx.fillStyle = d.accent
        ctx.shadowColor = 'rgba(0,0,0,0.3)'
        ctx.shadowBlur = 12
        ctx.fillRect(-260, 120, 520, 64)
        ctx.shadowColor = 'transparent'
        ctx.fillStyle = inkOn(d.accent)
        ctx.font = `700 28px ${fontFamily}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.direction = dir
        ctx.fillText(badge, 0, 153, 250)
        ctx.restore()
      }
      if (d.icon && !photo) {
        const r = endSide(420)
        ctx.save()
        ctx.font = emojiFont(110, fontFamily)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(d.icon, r.x + r.w / 2 + (dir === 'rtl' ? 40 : -40), H / 2 + 30)
        ctx.restore()
      }
      drawTextBlock(c, { x: startX, top: 40, bottom: H - 36, maxW: W - 420 - M - 20, align: 'start' }, { badge: false })
      break
    }
    case 'minimal': {
      const corner = dir === 'rtl' ? { x: 0, y: H - 200, w: 260, h: 200 } : { x: W - 260, y: H - 200, w: 260, h: 200 }
      drawPattern(ctx, pattern, d.accent, corner, patternAlpha)
      ctx.fillStyle = d.accent
      ctx.fillRect(dir === 'rtl' ? W - 14 : 0, 0, 14, H)
      drawTextBlock(c, { x: startX, top: 40, bottom: H - 30, maxW: W - 2 * M - 200, align: 'start' }, { underline: true })
      break
    }
    case 'frame': {
      drawPattern(ctx, pattern, d.accent, { x: 0, y: 0, w: W, h: H }, patternAlpha * 0.55)
      ctx.save()
      ctx.strokeStyle = d.accent
      ctx.lineWidth = 3
      ctx.strokeRect(22, 22, W - 44, H - 44)
      ctx.globalAlpha = 0.55
      ctx.lineWidth = 1.5
      ctx.strokeRect(36, 36, W - 72, H - 72)
      ctx.globalAlpha = 1
      ctx.fillStyle = d.accent
      for (const [x, y] of [[22, 22], [W - 22, 22], [22, H - 22], [W - 22, H - 22]]) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-10, -10, 20, 20); ctx.restore()
      }
      ctx.restore()
      drawTextBlock(c, { x: W / 2, top: 50, bottom: H - 44, maxW: W - 260, align: 'center' }, { icon: true })
      break
    }
  }
  ctx.restore()
}
