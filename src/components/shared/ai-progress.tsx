'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, CheckCircle2 } from 'lucide-react'

// Staged progress for AI file processing. The API is a single request with
// no streaming, so progress is simulated: it advances asymptotically toward
// 92% while the request is in flight (never appearing stuck), then snaps to
// 100% with a confirmation when `active` flips back to false.

const STAGES = [
  { at: 0,  label: 'قراءة الملف...' },
  { at: 22, label: 'استخراج النص من الملف...' },
  { at: 48, label: 'الذكاء الاصطناعي يعالج المحتوى...' },
  { at: 75, label: 'جاري تجهيز النتيجة...' },
]

export function AiProgress({ active }: { active: boolean }) {
  const [progress, setProgress] = useState(0)
  const [visible, setVisible] = useState(false)
  const wasActive = useRef(false)

  useEffect(() => {
    if (active) {
      wasActive.current = true
      // eslint-disable-next-line react-hooks/set-state-in-effect -- progress animation initialises synchronously when upload starts; batched by React 19
      setVisible(true)
      setProgress(3)
      const t = setInterval(() => {
        setProgress(p => Math.min(92, p + (92 - p) * 0.03 + 0.15))
      }, 250)
      return () => clearInterval(t)
    }
    if (wasActive.current) {
      wasActive.current = false
      setProgress(100)
      const t = setTimeout(() => { setVisible(false); setProgress(0) }, 2000)
      return () => clearTimeout(t)
    }
  }, [active])

  if (!visible) return null

  const done = progress >= 100
  const stage = done
    ? 'اكتملت المعالجة بنجاح'
    : [...STAGES].reverse().find(s => progress >= s.at)?.label ?? STAGES[0].label

  return (
    <div className="bg-slate-800/60 border border-slate-700 rounded-lg px-4 py-3 space-y-2" dir="rtl">
      <div className="flex items-center gap-2 text-sm">
        {done
          ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          : <Loader2 className="w-4 h-4 text-violet-400 animate-spin shrink-0" />}
        <span className={done ? 'text-emerald-400 font-medium' : 'text-slate-300'}>{stage}</span>
        <span className="text-slate-500 mr-auto tabular-nums">{Math.round(progress)}%</span>
      </div>
      <div className="h-2 bg-slate-700/60 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${done ? 'bg-emerald-500' : 'bg-violet-500'}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}
