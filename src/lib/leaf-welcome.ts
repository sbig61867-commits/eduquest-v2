/**
 * The post-sign-in welcome, drawn on one <canvas> (components/shared/brand-intro.tsx).
 *
 * A body of golden maple leaves (the 11-point leaf of the Canadian flag) walks
 * across the screen in the reading direction like an inchworm: each wave of
 * contraction starts at the tail and runs forward, the leaves bunching and then
 * stretching as the head surges on. It sheds leaves as it goes and more drift
 * down everywhere, settling on the ground. Then leaves peel off the body, fly
 * to the letters of the greeting and the user's first name, and melt into them,
 * leaving clean, crisp text with nothing left that reads as a leaf.
 *
 * About five seconds, once per sign-in. Leaves are pre-rendered to small sprite
 * canvases, so a frame is a few hundred drawImage calls — no per-leaf path
 * filling. All motion is scaled by the real frame time, so a 120 Hz screen
 * plays it at the same speed as a 60 Hz one.
 */

export interface LeafWelcomeOptions {
  greeting: string
  /** Read when the name starts forming; null while the account is still loading. */
  getName: () => string | null | undefined
  /** True once the account is known (name or not), so we stop waiting for it. */
  isReady: () => boolean
  rtl: boolean
  light: boolean
  /** Called when the welcome has finished and can fade out. */
  onDone: () => void
}

// ── Leaf geometry ─────────────────────────────────────────────────────────
const HALF: [number, number][] = [
  [0.22, -0.86], [0.18, -0.55], [0.42, -0.62], [0.38, -0.5], [0.62, -0.46], [0.54, -0.34],
  [0.7, -0.2], [0.4, -0.1], [0.5, 0.12], [0.1, 0.1], [0.06, 0.12], [0.05, 0.42],
]
const OUTLINE: [number, number][] = [
  [0, -1], [0.1, -0.8], ...HALF, ...HALF.slice().reverse().map(([x, y]) => [-x, y] as [number, number]), [-0.1, -0.8],
]

// ── Timeline (ms) ─────────────────────────────────────────────────────────
const CROSS = 4600          // the body's whole crossing
const FORM_AT = 2100        // leaves start leaving for the letters
const NAME_WAIT = 1200      // longest wait for a still-loading account
const FORM = 1300           // the writing sweep, start to end of the name
const FLY = 650             // one leaf's flight to its letter
const MELT = 380            // a leaf dissolving into the stroke
const HOLD = 800            // the finished greeting stays this long
const SEGMENTS = 26

const DARK = { leaves: ['#e3c788', '#d4af5f', '#c9a24a', '#b8892f', '#e0b45a'], vein: 'rgba(15,26,54,0.4)', gold: '#d4af5f' }
const LIGHT = { leaves: ['#c9a24a', '#b8892f', '#a8752a', '#8a6520', '#d4af5f'], vein: 'rgba(250,247,240,0.5)', gold: '#a87b25' }

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

type Sprite = HTMLCanvasElement
const SPRITE = 96          // sprite size in px
const SPRITE_R = 44        // leaf radius inside the sprite

function makeSprite(color: string, vein: string | null): Sprite {
  const c = document.createElement('canvas')
  c.width = c.height = SPRITE
  const g = c.getContext('2d')!
  g.translate(SPRITE / 2, SPRITE / 2)
  g.scale(SPRITE_R, SPRITE_R)
  g.beginPath()
  OUTLINE.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
  g.closePath()
  g.fillStyle = color
  g.fill()
  if (vein) {
    g.beginPath()
    g.moveTo(0, 0.4); g.lineTo(0, -0.85)
    g.moveTo(0, -0.05); g.lineTo(0.55, -0.42)
    g.moveTo(0, -0.05); g.lineTo(-0.55, -0.42)
    g.lineWidth = 0.05
    g.strokeStyle = vein
    g.stroke()
  }
  return c
}

interface Faller { x: number; y: number; size: number; sprite: Sprite; rot: number; vr: number; vy: number; sway: number; ph: number; ground: number; landed: boolean }
interface Writer { x: number; y: number; f: number; arrive: number; ph: number; leaf: Sprite; letter: Sprite; size: number; fromX: number; fromY: number; launched: boolean }

/** Starts the welcome on `canvas`; returns a function that stops it. */
export function runLeafWelcome(canvas: HTMLCanvasElement, opts: LeafWelcomeOptions): () => void {
  const ctx = canvas.getContext('2d')
  if (!ctx) { opts.onDone(); return () => {} }
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const W = window.innerWidth, H = window.innerHeight
  canvas.width = Math.round(W * dpr)
  canvas.height = Math.round(H * dpr)

  const pal = opts.light ? LIGHT : DARK
  const leafSprites = pal.leaves.map(c => makeSprite(c, pal.vein))
  const pick = () => leafSprites[Math.floor(Math.random() * leafSprites.length)]
  const dir = opts.rtl ? -1 : 1   // reading direction along x

  const draw = (sprite: Sprite, x: number, y: number, size: number, rot: number, flip = 1, alpha = 1) => {
    if (size <= 0.3 || alpha <= 0.01) return
    const k = (size * SPRITE) / (SPRITE_R * 2)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.translate(x, y)
    ctx.rotate(rot)
    ctx.scale(flip, 1)
    ctx.globalAlpha = alpha
    ctx.drawImage(sprite, -k, -k, k * 2, k * 2)
  }

  // ── Body ────────────────────────────────────────────────────────────────
  const unit = Math.min(W, H)
  const leafSize = unit * 0.07
  const gap = leafSize * 0.8
  const speed = (W * 1.3 + SEGMENTS * gap) / CROSS
  const w1 = (Math.PI * 2) / 1600, w2 = (Math.PI * 2) / 600, phi = 0.5
  const amp1 = H * 0.13, amp2 = H * 0.04
  const curve = (s: number) => ({
    x: opts.rtl ? W * 1.08 - s : -W * 0.08 + s,
    y: H * 0.3 + amp1 * Math.sin((s / W) * Math.PI * 2 * 0.9) + amp2 * Math.sin((s / W) * Math.PI * 2 * 2.7),
  })
  const body = Array.from({ length: SEGMENTS }, () => ({ sprite: pick(), ph: Math.random() * 6.28, spin: 0.8 + Math.random() * 0.8, side: Math.random() < 0.5 ? -1 : 1 }))
  const prof = (i: number) => (i < 5 ? 0.45 + 0.55 * (i / 5) : i > SEGMENTS - 4 ? 0.75 + 0.25 * ((SEGMENTS - 1 - i) / 3) : 1)

  // ── Falling leaves: shed by the body, and drifting down everywhere ──────
  const fallers: Faller[] = []
  const groundY = () => H - leafSize * (0.25 + Math.random() * 0.6)
  const addFaller = (x: number, y: number, size: number) => {
    if (fallers.length > 140) return
    fallers.push({ x, y, size, sprite: pick(), rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.05, vy: 0.9 + Math.random() * 0.9, sway: 0.6 + Math.random() * 0.9, ph: Math.random() * 6.28, ground: groundY(), landed: false })
  }

  // ── Name (built when it starts forming) ─────────────────────────────────
  let writers: Writer[] = []
  let textLayer: HTMLCanvasElement | null = null
  let maskLayer: HTMLCanvasElement | null = null
  let minX = 0, maxX = 0, soft = 0, formAt = FORM_AT, formed = false

  const buildName = (name: string | null) => {
    const fg = getComputedStyle(document.documentElement).getPropertyValue('--eq-fg').trim() || (opts.light ? '#13203a' : '#f5f7fb')
    const family = getComputedStyle(document.body).fontFamily || 'sans-serif'
    const layer = document.createElement('canvas')
    layer.width = canvas.width; layer.height = canvas.height
    const lc = layer.getContext('2d')!
    lc.setTransform(dpr, 0, 0, dpr, 0, 0)
    lc.textAlign = 'center'; lc.textBaseline = 'middle'
    lc.direction = opts.rtl ? 'rtl' : 'ltr'
    const cx = W / 2, cy = H * 0.5
    let nameFs = Math.round(Math.min(H * 0.16, W * 0.16))
    if (name) {
      lc.font = `700 ${nameFs}px ${family}`
      const room = W * 0.82
      const w = lc.measureText(name).width
      if (w > room) nameFs = Math.floor(nameFs * (room / w))
    }
    const greetFs = Math.round(name ? nameFs * 0.42 : nameFs * 0.62)
    const nameY = cy + nameFs * 0.2
    const greetY = name ? nameY - nameFs * 0.85 : cy
    lc.font = `600 ${greetFs}px ${family}`; lc.fillStyle = pal.gold; lc.fillText(opts.greeting, cx, greetY)
    if (name) {
      lc.font = `700 ${nameFs}px ${family}`; lc.fillStyle = fg; lc.fillText(name, cx, nameY)
      const nw = lc.measureText(name).width
      lc.fillStyle = pal.gold
      lc.fillRect(cx - nw * 0.2, nameY + nameFs * 0.55, nw * 0.4, Math.max(2, nameFs * 0.04))
    }

    // Leaf targets: points inside the glyphs, on a grid fine enough to trace them.
    const img = lc.getImageData(0, 0, layer.width, layer.height).data
    const step = Math.max(4, (name ? nameFs : greetFs) / 8.5)
    const targets: { x: number; y: number; r: number; g: number; b: number }[] = []
    minX = Infinity; maxX = -Infinity
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
      const i = (Math.round(y * dpr) * layer.width + Math.round(x * dpr)) * 4
      if (img[i + 3] > 120) {
        targets.push({ x, y, r: img[i], g: img[i + 1], b: img[i + 2] })
        if (x < minX) minX = x
        if (x > maxX) maxX = x
      }
    }
    // Written in the reading direction.
    targets.sort((a, b) => (opts.rtl ? b.x - a.x : a.x - b.x) + (a.y - b.y) * 0.02)
    const letterSprites = new Map<string, Sprite>()
    const letterSprite = (r: number, g: number, b: number) => {
      const key = `${r},${g},${b}`
      let s = letterSprites.get(key)
      if (!s) { s = makeSprite(`rgb(${key})`, null); letterSprites.set(key, s) }
      return s
    }
    const n = Math.max(1, targets.length - 1)
    writers = targets.map((tg, k) => ({
      x: tg.x, y: tg.y, f: k / n, arrive: formAt + (k / n) * FORM, ph: Math.random() * 6.28,
      leaf: pick(), letter: letterSprite(tg.r, tg.g, tg.b), size: step * 1.1, fromX: 0, fromY: 0, launched: false,
    }))
    soft = step * 3
    textLayer = layer
    maskLayer = document.createElement('canvas')
    maskLayer.width = layer.width; maskLayer.height = layer.height
    formed = true
  }

  // ── Loop ────────────────────────────────────────────────────────────────
  let raf = 0, start = -1, last = -1, lastShed = 0, lastDrift = 0, finished = false

  const frame = (now: number) => {
    if (start < 0) { start = now; last = now }
    const t = now - start
    const dt = Math.min(3, (now - last) / 16.67)   // frame-time scale, capped after a stall
    last = now
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Start forming once the account is known, waiting a little for it if needed.
    if (!formed && t >= FORM_AT && (opts.isReady() || t >= FORM_AT + NAME_WAIT)) {
      formAt = t
      buildName(opts.isReady() ? opts.getName() ?? null : null)
    }

    // Body points: the wave runs from the tail (high index) to the head.
    const pts = Array.from({ length: SEGMENTS }, (_, i) => {
      const s = speed * t - i * gap - gap * 2 + gap * 0.9 * Math.sin(w1 * t + i * phi) + gap * 0.4 * Math.sin(w2 * t + i * phi * 2.2)
      const p = curve(s), q = curve(s + 1)
      return { x: p.x, y: p.y, ang: Math.atan2(q.y - p.y, q.x - p.x) }
    })
    const bodyAlpha = !formed ? 1 : Math.max(0, 1 - (t - formAt) / (FORM * 0.9))
    if (bodyAlpha > 0) {
      for (let i = SEGMENTS - 1; i >= 0; i--) {
        const p = pts[i], b = body[i]
        const flutter = Math.sin(t * 0.0045 * b.spin + b.ph) * 0.45
        draw(b.sprite, p.x, p.y, leafSize * prof(i), p.ang + Math.PI / 2 + 0.2 * b.side + flutter, Math.cos(t * 0.003 * b.spin + b.ph), bodyAlpha)
      }
    }

    // Shed from the body's back half, and drift leaves in from the top everywhere.
    const writingDone = formed && t > formAt + FORM + FLY
    if (!writingDone) {
      if (bodyAlpha > 0.3 && t - lastShed > 170) {
        lastShed = t
        const p = pts[Math.floor(SEGMENTS * (0.45 + Math.random() * 0.5))]
        addFaller(p.x, p.y, leafSize * (0.55 + Math.random() * 0.3))
      }
      if (t - lastDrift > 120) {
        lastDrift = t
        addFaller(Math.random() * W, -leafSize, leafSize * (0.35 + Math.random() * 0.45))
      }
    }
    for (const f of fallers) {
      if (!f.landed) {
        f.y += f.vy * dt
        f.rot += f.vr * dt
        if (f.y >= f.ground) { f.y = f.ground; f.landed = true; f.rot = (Math.random() - 0.5) * 1.2 }
      }
      const swing = f.landed ? 0 : Math.sin(t * 0.0045 + f.ph)
      draw(f.sprite, f.x + swing * leafSize * 0.7 * f.sway, f.y, f.size, f.rot + swing * 0.5, f.landed ? 1 : Math.cos(t * 0.005 + f.ph))
    }

    if (formed && textLayer && maskLayer) {
      // The crisp text, uncovered just behind the landing front.
      const k = Math.min(1, Math.max(0, (t - formAt - MELT * 0.5) / FORM))
      const span = maxX - minX + soft * 2
      const front = opts.rtl ? maxX + soft - k * span : minX - soft + k * span
      const mc = maskLayer.getContext('2d')!
      mc.setTransform(1, 0, 0, 1, 0, 0)
      mc.globalCompositeOperation = 'source-over'
      mc.clearRect(0, 0, maskLayer.width, maskLayer.height)
      mc.drawImage(textLayer, 0, 0)
      mc.globalCompositeOperation = 'destination-in'
      const g = mc.createLinearGradient(front * dpr, 0, (front + soft * dir * -1) * dpr, 0)
      g.addColorStop(0, 'rgba(0,0,0,0)')
      g.addColorStop(1, 'rgba(0,0,0,1)')
      mc.fillStyle = g
      mc.fillRect(0, 0, maskLayer.width, maskLayer.height)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalAlpha = 1
      ctx.drawImage(maskLayer, 0, 0)

      // Writer leaves: lift off the body, fly to their spot, land upright and melt in.
      for (const w of writers) {
        const launch = w.arrive - FLY
        if (t < launch) continue
        if (!w.launched) {
          const src = pts[4 + Math.floor(Math.random() * (SEGMENTS - 6))]
          w.fromX = src.x; w.fromY = src.y; w.launched = true
        }
        if (t < w.arrive) {
          const e = easeOut((t - launch) / FLY)
          const x = w.fromX + (w.x - w.fromX) * e
          const y = w.fromY + (w.y - w.fromY) * e - Math.sin(e * Math.PI) * H * 0.05
          draw(e > 0.7 ? w.letter : w.leaf, x, y, w.size * (1.25 - 0.25 * e), (1 - e) * (3 + w.ph))
        } else {
          const m = Math.min(1, (t - w.arrive) / MELT)
          draw(w.letter, w.x, w.y, w.size * (1 - easeInOut(m)), 0, 1, 1 - m)
        }
      }
    }

    const end = formed ? formAt + FORM + FLY + MELT + HOLD : Infinity
    if (!finished && t >= end) { finished = true; opts.onDone() }
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
  return () => cancelAnimationFrame(raf)
}
