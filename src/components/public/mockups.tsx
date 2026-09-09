'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Users, Volume2 } from 'lucide-react'

// Seamless looping AI typewriter mockup
export function AiTypingMockup({ lang }: { lang: string }) {
  type Phase = 'idle' | 'typing' | 'generating' | 'done'
  const [phase, setPhase] = useState<Phase>('idle')
  const [typed, setTyped] = useState('')
  const topic = lang === 'ar' ? 'الدورة الدموية الصغرى والكبرى' : 'Pulmonary & systemic circulation'
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    if (phase === 'idle') { t = setTimeout(() => { setTyped(''); setPhase('typing') }, 1200) }
    else if (phase === 'typing') {
      if (typed.length < topic.length) { t = setTimeout(() => setTyped(topic.slice(0, typed.length + 1)), 55) }
      else { t = setTimeout(() => setPhase('generating'), 600) }
    }
    else if (phase === 'generating') { t = setTimeout(() => setPhase('done'), 1800) }
    else { t = setTimeout(() => { setPhase('idle'); setTyped('') }, 2400) }
    return () => clearTimeout(t)
  }, [phase, typed, topic])
  return (
    <div className="relative bg-canvas border border-border rounded-2xl p-4 sm:p-5 font-mono text-xs sm:text-sm overflow-hidden">
      <p className="text-fg-muted mb-2">{lang === 'ar' ? '> اكتب موضوع الدرس' : '> type a lesson topic'}</p>
      <p className="text-fg font-semibold mb-3 min-h-[1.5em]">
        {typed}<span className={`inline-block w-1.5 h-4 bg-accent ms-0.5 align-middle ${phase === 'typing' ? 'animate-pulse' : 'opacity-0'}`} />
      </p>
      {(phase === 'generating' || phase === 'done') && (
        <div className="space-y-2">
          {[100, 85, 70].map((w, i) => (
            <div key={i} className="h-2.5 rounded-full bg-accent/20 overflow-hidden" style={{ width: `${w}%` }}>
              {phase === 'generating' && <div className="h-full bg-accent/40 animate-pulse" style={{ animationDelay: `${i * 0.2}s` }} />}
              {phase === 'done' && <div className="h-full bg-accent/50" style={{ width: '100%', transition: 'width 0.6s ease', transitionDelay: `${i * 0.15}s` }} />}
            </div>
          ))}
        </div>
      )}
      {phase === 'done' && (
        <div className="flex items-center gap-1.5 mt-4 text-success text-[11px] font-semibold animate-pulse">
          <CheckCircle2 className="w-3.5 h-3.5" /> {lang === 'ar' ? 'جاهز للمراجعة' : 'Ready to review'}
        </div>
      )}
    </div>
  )
}

// Live proctoring mockup with cycling speaker
export function LiveProctoringGrid({ lang }: { lang: string }) {
  const [speaker, setSpeaker] = useState(1)
  useEffect(() => {
    const id = setInterval(() => setSpeaker(s => (s + 1) % 4), 2200)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className={`relative aspect-video rounded-lg bg-surface border-2 overflow-hidden transition-colors duration-500 ${i === speaker ? 'border-success' : 'border-border'}`}>
          <Users className="absolute inset-0 m-auto w-6 h-6 text-fg-muted" />
          {i === speaker && (
            <span className="absolute top-1.5 end-1.5 flex items-center gap-1 bg-success text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full animate-pulse">
              <Volume2 className="w-2.5 h-2.5" /> {lang === 'ar' ? 'يتكلم' : 'speaking'}
            </span>
          )}
          <span className="absolute bottom-1 start-1.5 text-fg-muted text-[10px]">{lang === 'ar' ? `طالب ${i + 1}` : `Student ${i + 1}`}</span>
        </div>
      ))}
    </div>
  )
}
