'use client'

import { useEffect, useRef, useState } from 'react'
import { X, KeyRound, Mail, UserPlus } from 'lucide-react'

type Help = { icon: 'KeyRound' | 'Mail' | 'UserPlus'; title: string; desc: string; href?: string }

const dict = {
  ar: {
    label: 'المساعد',
    greeting: 'محتاج مساعدة بتسجيل الدخول؟',
    tiredGreeting: 'خلص خلص، بساعدك تسجّل دخول',
    newUserGreeting: 'أهلاً فيك معنا! تم تفعيل حسابك، جاهز تبدأ؟',
    returningGreeting: 'مرحباً بعودتك! لنبدأ تسجيل الدخول، يبدو إنه عندك مهام ودروس غير منجزة، أسرع!',
    strongPassword: 'أووه، كلمة سر قوية!',
    items: [
      { icon: 'KeyRound', title: 'نسيت كلمة السر؟', desc: 'اضغط "نسيت كلمة السر" تحت الحقل وبنرسلك رابط تصفير.', href: '/forgot-password' },
      { icon: 'UserPlus', title: 'ما عندك حساب؟', desc: 'التسجيل هون يتم فقط برابط دعوة من جامعتك أو مركزك، تواصل مع الإدارة عندك.' },
      { icon: 'Mail', title: 'لسا في مشكلة؟', desc: 'راسلنا وبنساعدك بأسرع وقت.', href: '/contact' },
    ] as Help[],
    close: 'إغلاق',
  },
  en: {
    label: 'Assistant',
    greeting: 'Need help signing in?',
    tiredGreeting: 'Okay okay, let me help you sign in',
    newUserGreeting: 'Welcome aboard! Your account is active, ready to start?',
    returningGreeting: "Welcome back! Let's sign you in, looks like you have unfinished tasks and lessons, hurry up!",
    strongPassword: "Oh, that's a strong password!",
    items: [
      { icon: 'KeyRound', title: 'Forgot your password?', desc: 'Use "Forgot password" below the field and we\'ll send a reset link.', href: '/forgot-password' },
      { icon: 'UserPlus', title: "Don't have an account?", desc: 'Sign-up here only happens via an invite link from your university or center, contact your admin.' },
      { icon: 'Mail', title: 'Still stuck?', desc: "Message us and we'll help right away.", href: '/contact' },
    ] as Help[],
    close: 'Close',
  },
}

const icons = { KeyRound, Mail, UserPlus } as const

const SIZE = 56
const MARGIN = 16
const COMFORT_DIST = 220 // px the mascot tries to keep from the cursor while trailing it
const DODGE_DIST = 110   // px, inside this it panics and jumps away
const TIRED_AFTER = 5    // dodges before it gives up and offers help
const POPOVER_W = 288
const POPOVER_H = 230

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}

export function HelperMascot({ lang = 'ar' as 'ar' | 'en' }: { lang?: 'ar' | 'en' }) {
  const t = dict[lang]
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [eye, setEye] = useState({ x: 0, y: 0 })
  const [open, setOpen] = useState(false)
  const [tired, setTired] = useState(false)
  const [spooked, setSpooked] = useState(false)
  const [peek, setPeek] = useState<'none' | 'cover' | 'peek' | 'closed'>('none')
  const [peekEye, setPeekEye] = useState({ x: 0, y: 0 })
  const [greet, setGreet] = useState<'idle' | 'running' | 'greeting'>('idle')
  const [greetText, setGreetText] = useState('')
  const [cloudMsg, setCloudMsg] = useState<string | null>(null)
  const [reduced, setReduced] = useState(false)

  const mouse = useRef({ x: 0, y: 0 })
  const dodgeCount = useRef(0)
  const lastDodge = useRef(0)
  const rafId = useRef<number | undefined>(undefined)
  const peekTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const shownStrongMsg = useRef(false)

  // Mount after hydration only — this widget is purely decorative, so it's
  // simplest and safest to skip SSR entirely rather than reconcile a
  // window-size-dependent position against a server-rendered guess.
  useEffect(() => {
    // Intentional one-time post-hydration sync: this widget renders nothing
    // on the server (window/viewport size is unknown there), so mounting,
    // motion preference, and the starting position are all resolved here —
    // not a cascading-render bug.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
    const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setReduced(isReduced)
    setPos({ x: window.innerWidth - SIZE - 40, y: window.innerHeight - SIZE - 40 })

    if (isReduced) return
    const isNewUser = new URLSearchParams(window.location.search).get('registered') === 'true'
    setGreetText(isNewUser ? t.newUserGreeting : t.returningGreeting)
    const toRun = setTimeout(() => {
      setGreet('running')
      setPos({ x: window.innerWidth / 2 - SIZE / 2, y: 210 })
    }, 250)
    const toGreeting = setTimeout(() => setGreet('greeting'), 900)
    const toIdle = setTimeout(() => setGreet('idle'), 5000)
    return () => { clearTimeout(toRun); clearTimeout(toGreeting); clearTimeout(toIdle) }
    // Runs once on mount only — t is stable per `lang` prop, which doesn't change at runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Curious-follow-but-shy movement loop
  useEffect(() => {
    if (!mounted || reduced) return

    const onMove = (e: MouseEvent) => { mouse.current = { x: e.clientX, y: e.clientY } }
    window.addEventListener('mousemove', onMove)

    const tick = () => {
      setPos(prev => {
        if (open || peek !== 'none' || greet !== 'idle') return prev
        const cx = prev.x + SIZE / 2
        const cy = prev.y + SIZE / 2
        const dx = cx - mouse.current.x
        const dy = cy - mouse.current.y
        const dist = Math.hypot(dx, dy) || 1
        setEye({ x: (-dx / dist) * 2.2, y: (-dy / dist) * 2.2 })

        const maxX = window.innerWidth - SIZE - MARGIN
        const maxY = window.innerHeight - SIZE - MARGIN

        if (dist < DODGE_DIST) {
          const now = Date.now()
          if (now - lastDodge.current > 450) {
            lastDodge.current = now
            const angle = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.9
            const nx = clamp(mouse.current.x + Math.cos(angle) * COMFORT_DIST - SIZE / 2, MARGIN, maxX)
            const ny = clamp(mouse.current.y + Math.sin(angle) * COMFORT_DIST - SIZE / 2, MARGIN, maxY)
            setSpooked(true)
            setTimeout(() => setSpooked(false), 300)
            dodgeCount.current += 1
            if (dodgeCount.current >= TIRED_AFTER) {
              setTired(true)
              setOpen(true)
            }
            return { x: nx, y: ny }
          }
          return prev
        }

        // Curious trailing: drift gently to stay ~COMFORT_DIST from the cursor
        if (dist > COMFORT_DIST + 40) {
          const angle = Math.atan2(dy, dx)
          const targetX = clamp(mouse.current.x + Math.cos(angle) * COMFORT_DIST - SIZE / 2, MARGIN, maxX)
          const targetY = clamp(mouse.current.y + Math.sin(angle) * COMFORT_DIST - SIZE / 2, MARGIN, maxY)
          return { x: prev.x + (targetX - prev.x) * 0.04, y: prev.y + (targetY - prev.y) * 0.04 }
        }
        return prev
      })
      rafId.current = requestAnimationFrame(tick)
    }
    rafId.current = requestAnimationFrame(tick)

    return () => {
      window.removeEventListener('mousemove', onMove)
      if (rafId.current) cancelAnimationFrame(rafId.current)
    }
  }, [mounted, reduced, open, peek, greet])

  // Password-field gag: peek over when the user is typing their password
  useEffect(() => {
    if (!mounted || reduced) return

    const clearPeekTimers = () => { peekTimers.current.forEach(clearTimeout); peekTimers.current = [] }

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement
      if (!(target instanceof HTMLInputElement) || target.type !== 'password') return
      const r = target.getBoundingClientRect()
      const maxX = window.innerWidth - SIZE - MARGIN
      const maxY = window.innerHeight - SIZE - MARGIN

      // Pick whichever side of the field has room: right, then left, then below, then above
      const gap = 14
      let mx: number, my: number
      if (window.innerWidth - r.right >= SIZE + gap) { mx = r.right + gap; my = r.top + r.height / 2 - SIZE / 2 }
      else if (r.left >= SIZE + gap) { mx = r.left - SIZE - gap; my = r.top + r.height / 2 - SIZE / 2 }
      else if (window.innerHeight - r.bottom >= SIZE + gap) { mx = r.left + r.width / 2 - SIZE / 2; my = r.bottom + gap }
      else { mx = r.left + r.width / 2 - SIZE / 2; my = r.top - SIZE - gap }
      mx = clamp(mx, MARGIN, maxX)
      my = clamp(my, MARGIN, maxY)
      setPos({ x: mx, y: my })

      // Gaze toward the field's center, whichever side the mascot ended up on
      const fieldCx = r.left + r.width / 2
      const fieldCy = r.top + r.height / 2
      const mascotCx = mx + SIZE / 2
      const mascotCy = my + SIZE / 2
      const dx = fieldCx - mascotCx
      const dy = fieldCy - mascotCy
      const dist = Math.hypot(dx, dy) || 1
      setPeekEye({ x: (dx / dist) * 2.4, y: (dy / dist) * 2.4 })

      clearPeekTimers()
      setPeek('cover')
      peekTimers.current.push(setTimeout(() => setPeek('peek'), 700))
    }
    const onFocusOut = (e: FocusEvent) => {
      const target = e.target as HTMLElement
      if (!(target instanceof HTMLInputElement) || target.type !== 'password') return
      clearPeekTimers()
      setPeek('none')
      setCloudMsg(null)
      shownStrongMsg.current = false
    }
    const onInput = (e: Event) => {
      const target = e.target as HTMLElement
      if (!(target instanceof HTMLInputElement) || target.type !== 'password') return
      if (target.value.length === 0) {
        setCloudMsg(null)
        shownStrongMsg.current = false
        return
      }
      // Politely shuts its eyes the moment typing starts — no more peeking
      clearPeekTimers()
      setPeek('closed')
      if (!shownStrongMsg.current) {
        shownStrongMsg.current = true
        setCloudMsg(t.strongPassword)
        peekTimers.current.push(setTimeout(() => setCloudMsg(null), 2600))
      }
    }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    document.addEventListener('input', onInput)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      document.removeEventListener('input', onInput)
      clearPeekTimers()
    }
  }, [mounted, reduced, t.strongPassword])

  const closePopover = () => {
    setOpen(false)
    setTired(false)
    dodgeCount.current = 0
  }

  if (!mounted) return null

  // Keep the help popover fully on-screen no matter where the mascot is
  const popoverLeft = clamp(pos.x + SIZE / 2 - POPOVER_W / 2, MARGIN, window.innerWidth - POPOVER_W - MARGIN)
  const popoverAbove = pos.y > POPOVER_H + MARGIN + 20
  const popoverTop = popoverAbove ? pos.y - POPOVER_H - 14 : pos.y + SIZE + 14

  const greetLeft = clamp(pos.x + SIZE / 2 - POPOVER_W / 2, MARGIN, window.innerWidth - POPOVER_W - MARGIN)
  const greetAbove = pos.y > 100
  const greetTop = greetAbove ? pos.y - 70 : pos.y + SIZE + 14

  return (
    <>
      {greet === 'greeting' && (
        <div
          className="fixed z-50 bg-elevated border border-border rounded-[16px] shadow-[0_16px_48px_rgba(0,0,0,0.25)] px-4 py-3 text-sm text-fg font-medium"
          style={{ left: greetLeft, top: greetTop, width: POPOVER_W }}
          dir={lang === 'ar' ? 'rtl' : 'ltr'}
        >
          {greetText}
        </div>
      )}

      {cloudMsg && (
        <div
          className="fixed z-50 px-4 py-2.5 text-sm font-semibold text-fg"
          style={{
            left: clamp(pos.x + SIZE / 2 - 110, MARGIN, window.innerWidth - 220 - MARGIN),
            top: pos.y > 90 ? pos.y - 58 : pos.y + SIZE + 10,
            width: 220,
            textAlign: 'center',
            background: 'var(--color-elevated)',
            borderRadius: '999px',
            boxShadow: '-16px 6px 0 -8px var(--color-elevated), 16px 6px 0 -8px var(--color-elevated), 0 8px 20px rgba(0,0,0,0.18)',
          }}
        >
          {cloudMsg}
        </div>
      )}

      {open && (
        <div
          role="dialog"
          aria-label={t.label}
          className="fixed z-50 bg-elevated border border-border rounded-[20px] shadow-[0_16px_48px_rgba(0,0,0,0.25)] p-4 text-start"
          style={{ left: popoverLeft, top: popoverTop, width: POPOVER_W }}
          dir={lang === 'ar' ? 'rtl' : 'ltr'}
        >
          <div className="flex items-start justify-between mb-3">
            <p className="text-fg font-semibold text-sm">{tired ? t.tiredGreeting : t.greeting}</p>
            <button onClick={closePopover} aria-label={t.close} className="text-fg-muted hover:text-fg shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-3">
            {t.items.map((item, i) => {
              const Icon = icons[item.icon]
              const content = (
                <div className="flex items-start gap-2.5">
                  <Icon className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                  <div>
                    <p className="text-fg text-xs font-semibold">{item.title}</p>
                    <p className="text-fg-secondary text-xs leading-relaxed mt-0.5">{item.desc}</p>
                  </div>
                </div>
              )
              return item.href ? (
                <a key={i} href={item.href} className="block hover:opacity-80 transition-opacity">{content}</a>
              ) : (
                <div key={i}>{content}</div>
              )
            })}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => (open ? closePopover() : setOpen(true))}
        aria-label={t.label}
        aria-expanded={open}
        className="eq-float fixed z-40 w-14 h-14 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-full"
        style={{
          left: pos.x,
          top: pos.y,
          animationDuration: '3.2s',
          transform: spooked ? 'scale(1.15, 0.85)' : peek === 'peek' ? 'rotate(-8deg)' : undefined,
          transition: reduced
            ? undefined
            : greet === 'running'
              ? 'left 0.65s cubic-bezier(0.34, 1.56, 0.64, 1), top 0.65s cubic-bezier(0.34, 1.56, 0.64, 1)'
              : 'transform 0.2s ease-out, left 0.5s ease-out, top 0.5s ease-out',
        }}
      >
        <span className="absolute inset-0 rounded-full bg-accent/25 blur-lg" />
        <svg viewBox="0 0 64 64" className="relative w-full h-full drop-shadow-[0_6px_16px_rgba(78,154,217,0.45)]">
          <circle cx="32" cy="32" r="28" fill="#4E9AD9" />
          <circle cx="32" cy="32" r="28" fill="url(#eq-mascot-grad)" opacity="0.5" />
          <defs>
            <linearGradient id="eq-mascot-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#7FD4C1" />
              <stop offset="100%" stopColor="#4E9AD9" />
            </linearGradient>
          </defs>

          {tired ? (
            <g>
              <path d="M18 28 Q23 32 28 28" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" />
              <path d="M36 28 Q41 32 46 28" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" />
              <path d="M24 44 Q32 40 40 44" stroke="#0b3658" strokeWidth="2.5" fill="none" strokeLinecap="round" />
              <path d="M46 12 q4 4 0 9" stroke="#8FD3EE" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.9" />
            </g>
          ) : peek === 'closed' ? (
            <g>
              {/* politely shuts its eyes while the user is typing their password */}
              <path d="M17 30 q6 5 12 0" stroke="#0b3658" strokeWidth="2.5" fill="none" strokeLinecap="round" />
              <path d="M35 30 q6 5 12 0" stroke="#0b3658" strokeWidth="2.5" fill="none" strokeLinecap="round" />
              <path d="M24 42 Q32 47 40 42" stroke="#0b3658" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            </g>
          ) : peek === 'cover' ? (
            <g>
              {/* bashfully covering its own eyes */}
              <ellipse cx="32" cy="30" rx="13" ry="7" fill="#e6f1fa" />
              <path d="M20 30 h24" stroke="#0b3658" strokeWidth="1.5" strokeDasharray="2 2" opacity="0.4" />
              <path d="M26 43 Q32 46 38 43" stroke="#0b3658" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            </g>
          ) : peek === 'peek' ? (
            <g>
              {/* mischievously peeking toward the password field, wherever it is */}
              <g transform={`translate(${peekEye.x}, ${peekEye.y})`}>
                <circle cx="23" cy="30" r="6" fill="white" />
                <circle cx="41" cy="30" r="6" fill="white" />
                <circle cx="24" cy="31" r="2.6" fill="#0b3658" />
                <circle cx="42" cy="31" r="2.6" fill="#0b3658" />
              </g>
              <path d="M27 42 Q33 46 40 41" stroke="#0b3658" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            </g>
          ) : (
            <>
              <g transform={`translate(${eye.x}, ${eye.y})`}>
                <circle cx="23" cy="30" r="6" fill="white" />
                <circle cx="41" cy="30" r="6" fill="white" />
                <circle cx="24" cy="31" r="2.6" fill="#0b3658" />
                <circle cx="42" cy="31" r="2.6" fill="#0b3658" />
              </g>
              <path d="M24 42 Q32 48 40 42" stroke="#0b3658" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            </>
          )}
          <circle cx="50" cy="14" r="3" fill="#F2B84B" className="eq-float" />
        </svg>
        {!open && (
          <span className="absolute -top-1 -end-1 w-3.5 h-3.5 rounded-full bg-error border-2 border-canvas" />
        )}
      </button>
    </>
  )
}
