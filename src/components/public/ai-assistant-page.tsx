'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useLang, PublicNav, PublicFooter } from './shell'
import {
  Sparkles, FileText, ClipboardList, Languages, PenLine, Mail, ArrowLeft, ArrowRight, CheckCircle2,
  Type, MessageSquare, Eye, Send, LineChart,
} from 'lucide-react'

const dict = {
  ar: {
    badge: 'AI',
    title: 'مساعدك لكل شيء تعليمي',
    desc: 'اكتب موضوعاً بجملة واحدة، أو ارفع ملفاً — ويطلع لك درس كامل أو اختبار جاهز بأسئلته وإجاباته، تراجعه وتعدّله قبل ما ينشر لطلابك.',
    demoTopicLabel: '> اكتب موضوع الدرس',
    demoTopic: 'الدورة الدموية الصغرى والكبرى',
    demoReady: 'جاهز للمراجعة',
    features: [
      { icon: 'FileText', title: 'درس كامل من عنوان واحد', desc: 'اكتب موضوع الدرس فقط، ويولّد المساعد شرحاً منظماً بعناوين فرعية وأمثلة — جاهز للنشر أو التعديل.' },
      { icon: 'ClipboardList', title: 'اختبار بأسئلته وإجاباته', desc: 'يولّد أسئلة متنوعة (اختيار من متعدد، صح وخطأ، مقالية) مع الإجابة الصحيحة لكل سؤال — تختار أنت أي الأسئلة تبقيها.' },
      { icon: 'PenLine', title: 'تعديل كامل قبل النشر', desc: 'لا شيء يُنشر تلقائياً. كل ما يولّده المساعد يظهر لك أولاً لتعدّل، تحذف، أو تضيف قبل أن يراه أي طالب.' },
      { icon: 'Languages', title: 'يفهمك بالعربية والإنجليزية', desc: 'اكتب موضوعك باللغة التي تدرّس بها، والمساعد يولّد المحتوى بنفس اللغة وبصياغة مناسبة لمستوى طلابك.' },
    ],
    howTitle: 'سبع خطوات، ودرسك جاهز',
    steps: [
      { icon: 'Type', title: 'اختر العنوان' },
      { icon: 'Sparkles', title: 'دع الذكاء الاصطناعي يساعد في إنشاء الدرس' },
      { icon: 'MessageSquare', title: 'اكتب تعليمات' },
      { icon: 'Eye', title: 'راجع المحتوى' },
      { icon: 'ClipboardList', title: 'أنشئ المهام' },
      { icon: 'Send', title: 'انشر للطلاب' },
      { icon: 'LineChart', title: 'راقب النتائج' },
    ],
    ctaTitle: 'جرّب توليد أول درس بالذكاء الاصطناعي',
    ctaButton: 'راسلنا الآن',
  },
  en: {
    badge: 'AI',
    title: 'Your assistant for everything teaching',
    desc: 'Type a topic in one sentence, or upload a file — and get back a full lesson or a ready exam with questions and answers, to review and tweak before it reaches your students.',
    demoTopicLabel: '> type a lesson topic',
    demoTopic: 'Pulmonary and systemic circulation',
    demoReady: 'Ready to review',
    features: [
      { icon: 'FileText', title: 'A full lesson from one topic', desc: 'Type just the topic, and the assistant generates a structured explanation with subheadings and examples — ready to publish or edit.' },
      { icon: 'ClipboardList', title: 'A full exam, questions and answers', desc: 'Generates varied questions (multiple choice, true/false, essay) with the correct answer for each — you choose which ones to keep.' },
      { icon: 'PenLine', title: 'Fully editable before publishing', desc: 'Nothing publishes automatically. Everything the assistant generates lands in front of you first — edit, remove, or add before any student sees it.' },
      { icon: 'Languages', title: 'Understands Arabic and English', desc: 'Write your topic in whichever language you teach in, and the assistant generates content in the same language, matched to your students’ level.' },
    ],
    howTitle: 'Seven steps to a ready lesson',
    steps: [
      { icon: 'Type', title: 'Choose a title' },
      { icon: 'Sparkles', title: 'Let AI draft the lesson' },
      { icon: 'MessageSquare', title: 'Add your instructions' },
      { icon: 'Eye', title: 'Review the content' },
      { icon: 'ClipboardList', title: 'Create the tasks' },
      { icon: 'Send', title: 'Publish to students' },
      { icon: 'LineChart', title: 'Watch the results' },
    ],
    ctaTitle: 'Try generating your first AI lesson',
    ctaButton: 'Message us now',
  },
}

const icons = {
  FileText, ClipboardList, PenLine, Languages, Sparkles,
  Type, MessageSquare, Eye, Send, LineChart,
} as const

export function AiAssistantPage() {
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
          <div className="eq-blob-2 absolute -top-24 -start-24 w-[380px] h-[380px] rounded-full blur-3xl opacity-25" style={{ background: 'radial-gradient(circle, #2DD4BF, transparent 70%)' }} />
        </div>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-8 text-center">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent-subtle border border-accent-border text-accent text-xs font-semibold mb-5">
            <Sparkles className="w-3.5 h-3.5" /> {t.badge}
          </span>
          <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-fg leading-tight" style={{ letterSpacing: '-0.02em' }}>{t.title}</h1>
          <p className="text-fg-secondary text-base sm:text-lg mt-5 max-w-2xl mx-auto leading-relaxed">{t.desc}</p>
        </div>
      </section>

      {/* Generation demo */}
      <section className="max-w-2xl mx-auto px-4 sm:px-6 pb-14">
        <div className="relative bg-elevated border border-border rounded-[24px] overflow-hidden shadow-[0_24px_64px_rgba(11,54,88,0.14)] p-6 sm:p-8 font-mono text-sm">
          <p className="text-fg-muted mb-2">{t.demoTopicLabel}</p>
          <p className="text-fg font-semibold mb-5 text-base">
            {t.demoTopic}
            <span className="inline-block w-2 h-5 bg-accent ms-1 align-middle animate-pulse" />
          </p>
          <div className="space-y-2.5">
            {[100, 92, 78, 60].map((w, i) => (
              <div key={i} className="h-3 rounded-full bg-accent/15 eq-float" style={{ width: `${w}%`, animationDelay: `${i * 0.35}s` }} />
            ))}
          </div>
          <div className="flex items-center gap-1.5 mt-6 text-success text-xs font-semibold">
            <CheckCircle2 className="w-4 h-4" /> {t.demoReady}
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="bg-surface border-y border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14 sm:py-16">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {t.features.map((f, i) => {
              const Icon = icons[f.icon as keyof typeof icons]
              return (
                <div key={i} className="flex items-start gap-4 bg-elevated border border-border rounded-[20px] p-6 shadow-[0_4px_16px_rgba(11,54,88,0.06)]">
                  <div className="w-10 h-10 rounded-xl bg-accent-subtle flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-accent" />
                  </div>
                  <div>
                    <h3 className="text-fg font-semibold mb-1.5">{f.title}</h3>
                    <p className="text-fg-secondary text-sm leading-relaxed">{f.desc}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* How it works — a short, animated step flow */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-14 sm:py-16">
        <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-fg text-center mb-12" style={{ letterSpacing: '-0.01em' }}>{t.howTitle}</h2>
        <div className="relative">
          <div className="absolute top-6 bottom-6 start-6 w-px bg-border" />
          <div className="space-y-5">
            {t.steps.map((s, i) => {
              const Icon = icons[s.icon as keyof typeof icons]
              return (
                <div key={i} className="eq-fade-up relative flex items-center gap-4" style={{ animationDelay: `${i * 0.12}s` }}>
                  <span className="relative z-10 flex items-center justify-center w-12 h-12 rounded-2xl bg-accent text-accent-fg shrink-0 shadow-[0_8px_20px_rgba(78,154,217,0.30)]">
                    <Icon className="w-5 h-5" />
                  </span>
                  <h3 className="text-fg font-bold text-lg sm:text-xl">{s.title}</h3>
                </div>
              )
            })}
          </div>
        </div>
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
