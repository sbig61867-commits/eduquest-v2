'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useLang, PublicNav, PublicFooter } from './shell'
import { LiveProctoringGrid } from './mockups'
import { RevealOnScroll, StaggerGrid, StaggerItem } from '@/components/shared/motion'
import {
  Radio, Volume2, ZoomIn, WifiOff, ShieldCheck, Mail, ArrowLeft, ArrowRight,
} from 'lucide-react'

const dict = {
  ar: {
    badge: 'مباشر',
    title: 'تشوف كل طالب وتسمعه، لحظة بلحظة',
    desc: 'أثناء الاختبار يفتح المعلم جداراً مباشراً واحداً — صورة وصوت كل الطلاب في آنٍ واحد، بدون أي تطبيق خارجي أو رابط اجتماع منفصل.',
    demoLabel: 'جدار المراقبة أثناء اختبار حي',
    demoSpeaking: 'يتكلم',
    demoStudent: 'طالب',
    features: [
      { icon: 'Volume2', title: 'يعرف مين يتكلم فوراً', desc: 'أي صوت يصدر عن طالب تظهر علامة "يتكلم" فوق إطاره مباشرة — يميّز محاولة الغش من ضجيج الغرفة المحيطة، فما حدا يُظلم.' },
      { icon: 'ZoomIn', title: 'كبّر أي طالب لحاله', desc: 'اضغط على أي مربع لتكبيره بجودة أعلى ومتابعته وحده دون تشتيت بباقي الشبكة.' },
      { icon: 'WifiOff', title: 'ثابتة حتى على إنترنت ضعيف', desc: 'الاتصال مصمم ليتكيف مع سرعة الشبكة، فلا ينقطع البث عند أي طالب بسبب إنترنت بطيء.' },
      { icon: 'ShieldCheck', title: 'مسجّلة مع الأحداث المشبوهة', desc: 'كل حدث مراقبة (وجه غائب، نافذة أخرى، وجه إضافي) يُسجَّل تلقائياً ويظهر بجانب إجابة الطالب بعد الاختبار.' },
    ],
    howTitle: 'كيف تعمل أثناء الاختبار؟',
    steps: [
      { title: 'الطالب يبدأ الاختبار', desc: 'الكاميرا والمايكروفون يُفعَّلان تلقائياً بموافقته، ويبدأ بثه في جدار المعلم.' },
      { title: 'المعلم يفتح الجدار', desc: 'كل الطلاب الحاضرين يظهرون في شبكة واحدة بالصوت والصورة معاً.' },
      { title: 'الذكاء الاصطناعي يراقب بصمت', desc: 'بالتوازي، تحليل ذكي يرصد أي مخالفة ويسجلها كحدث منفصل عن المراقبة الحية.' },
      { title: 'مراجعة ما بعد الاختبار', desc: 'المعلم يراجع أحداث كل طالب المسجّلة قبل نشر العلامات.' },
    ],
    ctaTitle: 'جاهز تجرّب المراقبة الحية على اختبار فعلي؟',
    ctaButton: 'راسلنا الآن',
  },
  en: {
    badge: 'LIVE',
    title: 'See and hear every student, live',
    desc: 'During an exam, the teacher opens one live wall — video and audio of every student at once, with no third-party app or separate meeting link.',
    demoLabel: 'The monitoring wall during a live exam',
    demoSpeaking: 'speaking',
    demoStudent: 'Student',
    features: [
      { icon: 'Volume2', title: 'Knows who is speaking, instantly', desc: 'The moment a student makes a sound, a "speaking" marker appears on their tile — telling a cheating attempt from ambient room noise, so no one is treated unfairly.' },
      { icon: 'ZoomIn', title: 'Zoom into any student alone', desc: 'Click any tile to enlarge it at higher quality and follow that student without the rest of the grid distracting you.' },
      { icon: 'WifiOff', title: 'Stable even on weak internet', desc: "The connection adapts to network speed, so one student's slow connection never breaks the stream for others." },
      { icon: 'ShieldCheck', title: 'Recorded alongside flagged events', desc: 'Every proctoring event (missing face, another window, an extra face) is logged automatically and shown next to that answer after the exam.' },
    ],
    howTitle: 'How it works during an exam',
    steps: [
      { title: 'The student starts the exam', desc: 'Camera and microphone activate with their consent, and their stream joins the teacher’s wall.' },
      { title: 'The teacher opens the wall', desc: 'Every present student appears in one grid, with audio and video together.' },
      { title: 'AI watches silently in parallel', desc: 'A separate AI analysis flags violations as its own event stream, independent of the live feed.' },
      { title: 'Post-exam review', desc: 'The teacher reviews each student’s logged events before publishing grades.' },
    ],
    ctaTitle: 'Ready to try live monitoring on a real exam?',
    ctaButton: 'Message us now',
  },
}

const icons = { Volume2, ZoomIn, WifiOff, ShieldCheck } as const

export function LiveMonitoringPage() {
  const [lang, setLang] = useLang()
  const t = dict[lang]
  const Arrow = lang === 'ar' ? ArrowLeft : ArrowRight

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'light')
    return () => document.documentElement.removeAttribute('data-theme')
  }, [])

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="min-h-screen bg-canvas">
      <PublicNav lang={lang} setLang={setLang} />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <div className="eq-blob-1 absolute -top-24 -end-24 w-[380px] h-[380px] rounded-full blur-3xl opacity-25" style={{ background: 'radial-gradient(circle, #F43F5E, transparent 70%)' }} />
        </div>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-8 text-center">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-error-subtle border border-error/20 text-error text-xs font-semibold mb-5">
            <Radio className="w-3.5 h-3.5 animate-pulse" /> {t.badge}
          </span>
          <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-fg leading-tight" style={{ letterSpacing: '-0.02em' }}>{t.title}</h1>
          <p className="text-fg-secondary text-base sm:text-lg mt-5 max-w-2xl mx-auto leading-relaxed">{t.desc}</p>
        </div>
      </section>

      {/* Live demo wall */}
      <RevealOnScroll className="max-w-4xl mx-auto px-4 sm:px-6 pb-14">
        <div className="bg-elevated border border-border rounded-[24px] overflow-hidden shadow-[0_24px_64px_rgba(11,54,88,0.14)]">
          <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border bg-surface">
            <span className="w-2.5 h-2.5 rounded-full bg-red-400/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/70" />
            <span className="text-fg-muted text-xs font-medium ms-2">{t.demoLabel}</span>
          </div>
          <div className="p-4 sm:p-5">
            <LiveProctoringGrid lang={lang} />
          </div>
        </div>
      </RevealOnScroll>

      {/* Feature grid */}
      <section className="bg-surface border-y border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14 sm:py-16">
          <StaggerGrid className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {t.features.map((f, i) => {
              const Icon = icons[f.icon as keyof typeof icons]
              return (
                <StaggerItem key={i} className="eq-card-hover flex items-start gap-4 bg-elevated border border-border rounded-[20px] p-6 shadow-[0_4px_16px_rgba(11,54,88,0.06)]">
                  <div className="w-10 h-10 rounded-xl bg-error-subtle flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-error" />
                  </div>
                  <div>
                    <h3 className="text-fg font-semibold mb-1.5">{f.title}</h3>
                    <p className="text-fg-secondary text-sm leading-relaxed">{f.desc}</p>
                  </div>
                </StaggerItem>
              )
            })}
          </StaggerGrid>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-14 sm:py-16">
        <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-fg text-center mb-10" style={{ letterSpacing: '-0.01em' }}>{t.howTitle}</h2>
        <StaggerGrid className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {t.steps.map((s, i) => (
            <StaggerItem key={i} className="eq-card-hover relative bg-elevated border border-border rounded-[20px] p-6 shadow-[0_4px_16px_rgba(11,54,88,0.06)]">
              <span className="flex items-center justify-center w-9 h-9 rounded-full bg-error text-white font-black mb-4">{i + 1}</span>
              <h3 className="text-fg font-semibold mb-1.5">{s.title}</h3>
              <p className="text-fg-secondary text-sm leading-relaxed">{s.desc}</p>
            </StaggerItem>
          ))}
        </StaggerGrid>
      </section>

      {/* CTA */}
      <section className="bg-[#0b3658] mt-4">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16 text-center">
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white mb-6" style={{ letterSpacing: '-0.02em' }}>{t.ctaTitle}</h2>
          <Link href="/contact"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-[24px] bg-[#4e9ad9] hover:bg-[#3a85c4] text-white font-semibold transition-colors shadow-[0_8px_32px_rgba(78,154,217,0.35)]">
            <Mail className="w-4 h-4" /> {t.ctaButton} <Arrow className="w-4 h-4" />
          </Link>
        </div>
      </section>

      <PublicFooter lang={lang} />
    </div>
  )
}
