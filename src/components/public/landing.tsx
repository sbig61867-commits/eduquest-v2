'use client'

import Link from 'next/link'
import { useLang, PublicNav, PublicFooter } from './shell'
import {
  Sparkles, ShieldCheck, Building2, Mail, XCircle, ArrowLeft, ArrowRight,
  ChevronDown, Users, BookOpen, ClipboardList, BarChart2,
} from 'lucide-react'

const dict = {
  ar: {
    heroBadge: 'منصة تعليمية سحابية للجامعات',
    heroTitle: 'أدر جامعتك التعليمية من مكان واحد',
    heroDesc: 'EduQuest منصة متكاملة تجمع الدروس والاختبارات والعلامات والمراقبة الذكية — لكل جامعة بيئتها المعزولة الخاصة، ولكل معلم وطالب لوحته البسيطة.',
    heroCta: 'اطلب اشتراكاً لجامعتك',
    heroLogin: 'تسجيل الدخول',
    problemTitle: 'المشكلة التي نحلها',
    problems: [
      'أدوات متفرقة: الدروس في مكان، الاختبارات في آخر، والعلامات في جداول يدوية',
      'الغش في الاختبارات عن بُعد بلا أي وسيلة مراقبة',
      'إعداد الدروس والاختبارات يستهلك ساعات من وقت المعلم',
      'لا خصوصية بين المؤسسات — بيانات الجميع في سلة واحدة',
    ],
    teaserTitle: 'الحل: منصة واحدة تفعل كل شيء',
    teaser: [
      { icon: 'Sparkles', title: 'توليد بالذكاء الاصطناعي', desc: 'دروس واختبارات كاملة في ثوانٍ، قابلة للتعديل قبل النشر.' },
      { icon: 'ShieldCheck', title: 'مراقبة ذكية للاختبارات', desc: 'كاميرا وذكاء اصطناعي يحميان نزاهة الاختبار، والتصحيح على الخادم.' },
      { icon: 'Building2', title: 'عزل كامل لكل جامعة', desc: 'بيانات كل جامعة معزولة تماماً على مستوى قاعدة البيانات.' },
    ],
    allFeatures: 'استكشف كل المميزات',
    mock: {
      title: 'حدود الاستخدام للمعلم',
      stats: [
        { icon: 'BookOpen', label: 'دروس بالذكاء الاصطناعي', value: '10/ساعة' },
        { icon: 'ClipboardList', label: 'اختبارات بالذكاء الاصطناعي', value: '20/ساعة' },
        { icon: 'Users', label: 'دعوات الطلاب', value: '50/ساعة' },
        { icon: 'BarChart2', label: 'حجم المجموعات', value: 'غير محدود' },
      ],
      chartLabel: 'مثال: نشاط أسبوعي لمجموعة',
    },
    ctaTitle: 'جاهز تنقل جامعتك للمستوى التالي؟',
    ctaDesc: 'راسلنا وسنجهز بيئة جامعتك ونرافقكم خطوة بخطوة.',
    ctaButton: 'راسلنا الآن',
  },
  en: {
    heroBadge: 'Cloud education platform for universities',
    heroTitle: 'Run your university from one place',
    heroDesc: 'EduQuest brings lessons, exams, grades and smart proctoring together — every university gets its own isolated environment, and every teacher and student a simple dashboard.',
    heroCta: 'Request a subscription',
    heroLogin: 'Sign In',
    problemTitle: 'The problem we solve',
    problems: [
      'Scattered tools: lessons here, exams there, grades in manual spreadsheets',
      'Cheating in remote exams with no way to monitor',
      'Preparing lessons and exams eats hours of every teacher’s time',
      'No privacy between institutions — everyone’s data in one basket',
    ],
    teaserTitle: 'The solution: one platform that does it all',
    teaser: [
      { icon: 'Sparkles', title: 'AI-powered generation', desc: 'Full lessons and exams in seconds, editable before publishing.' },
      { icon: 'ShieldCheck', title: 'Smart exam proctoring', desc: 'Camera + AI protect exam integrity, with grading on the server.' },
      { icon: 'Building2', title: 'Full isolation per university', desc: 'Every university’s data is fully isolated at the database level.' },
    ],
    allFeatures: 'Explore all features',
    mock: {
      title: 'Teacher usage allowances',
      stats: [
        { icon: 'BookOpen', label: 'AI lessons', value: '10/hour' },
        { icon: 'ClipboardList', label: 'AI exams', value: '20/hour' },
        { icon: 'Users', label: 'Student invitations', value: '50/hour' },
        { icon: 'BarChart2', label: 'Group size', value: 'Unlimited' },
      ],
      chartLabel: 'Example: a group’s weekly activity',
    },
    ctaTitle: 'Ready to take your university to the next level?',
    ctaDesc: 'Message us and we’ll set up your university’s environment and guide you step by step.',
    ctaButton: 'Message us now',
  },
}

const icons = { Sparkles, ShieldCheck, Building2, Users, BookOpen, ClipboardList, BarChart2 } as const

// Fake weekly-activity bars for the hero dashboard mockup (pure CSS, no images)
const CHART_BARS = [45, 70, 55, 90, 65, 100, 80]

export function Landing() {
  const [lang, setLang] = useLang()
  const t = dict[lang]
  const Arrow = lang === 'ar' ? ArrowLeft : ArrowRight

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-950">
      <PublicNav lang={lang} setLang={setLang} />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(37,99,235,0.18),transparent_60%)]" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-6 text-center">
          <span className="inline-block px-4 py-1.5 rounded-full bg-blue-600/10 border border-blue-500/20 text-blue-400 text-sm font-medium mb-5">
            {t.heroBadge}
          </span>
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold leading-tight max-w-3xl mx-auto bg-gradient-to-b from-white via-white to-slate-400 bg-clip-text text-transparent">
            {t.heroTitle}
          </h1>
          <p className="text-slate-400 text-base sm:text-lg mt-4 sm:mt-6 max-w-2xl mx-auto leading-relaxed">
            {t.heroDesc}
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-7">
            <Link href="/contact"
              className="w-full sm:w-auto px-7 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors flex items-center justify-center gap-2 shadow-lg shadow-blue-600/25">
              {t.heroCta} <Arrow className="w-4 h-4" />
            </Link>
            <Link href="/login"
              className="w-full sm:w-auto px-7 py-3.5 rounded-xl border border-slate-700 hover:border-slate-500 text-slate-200 font-semibold transition-colors text-center">
              {t.heroLogin}
            </Link>
          </div>

          {/* Dashboard mockup — pure CSS preview of the product */}
          <div className="relative max-w-3xl mx-auto mt-10 sm:mt-14 text-start" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            <div className="absolute -inset-4 bg-blue-600/10 blur-2xl rounded-3xl" />
            <div className="relative bg-slate-900/90 backdrop-blur border border-slate-700/60 rounded-2xl overflow-hidden shadow-2xl">
              {/* window bar */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800 bg-slate-900">
                <span className="w-2.5 h-2.5 rounded-full bg-red-400/70" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400/70" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/70" />
                <span className="text-slate-500 text-xs font-medium ms-2">{t.mock.title}</span>
              </div>
              <div className="p-4 sm:p-5">
                {/* stat cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
                  {t.mock.stats.map((s, i) => {
                    const Icon = icons[s.icon as keyof typeof icons]
                    return (
                      <div key={i} className="bg-slate-800/70 border border-slate-700/50 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-slate-400 text-[11px]">{s.label}</span>
                          <Icon className="w-3.5 h-3.5 text-blue-400" />
                        </div>
                        <p className="text-white text-lg font-bold">{s.value}</p>
                      </div>
                    )
                  })}
                </div>
                {/* activity bars */}
                <div className="mt-3 bg-slate-800/70 border border-slate-700/50 rounded-xl p-3">
                  <p className="text-slate-400 text-[11px] mb-2">{t.mock.chartLabel}</p>
                  <div className="flex items-end gap-1.5 sm:gap-2 h-16">
                    {CHART_BARS.map((h, i) => (
                      <div key={i} className="flex-1 rounded-t-md bg-gradient-to-t from-blue-600/40 to-blue-500" style={{ height: `${h}%` }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* scroll cue */}
          <div className="flex justify-center mt-6 pb-2">
            <ChevronDown className="w-5 h-5 text-slate-500 animate-bounce" />
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-10">{t.problemTitle}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
          {t.problems.map((p, i) => (
            <div key={i} className="flex items-start gap-3 bg-slate-900 border border-slate-800 rounded-xl p-5">
              <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <p className="text-slate-300 text-sm leading-relaxed">{p}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Solution teaser */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-10">{t.teaserTitle}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {t.teaser.map((f, i) => {
            const Icon = icons[f.icon as keyof typeof icons]
            return (
              <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-6 hover:border-slate-700 transition-colors">
                <div className="w-11 h-11 rounded-xl bg-blue-600/15 flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-blue-400" />
                </div>
                <h3 className="text-white font-semibold mb-2">{f.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
              </div>
            )
          })}
        </div>
        <div className="text-center mt-10">
          <Link href="/features"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-slate-700 hover:border-blue-500 text-slate-200 hover:text-white font-medium transition-colors">
            {t.allFeatures} <Arrow className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <div className="relative overflow-hidden bg-gradient-to-br from-blue-600/20 to-slate-900 border border-blue-500/20 rounded-2xl p-10 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">{t.ctaTitle}</h2>
          <p className="text-slate-300 mb-8 max-w-xl mx-auto">{t.ctaDesc}</p>
          <Link href="/contact"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors">
            <Mail className="w-4 h-4" /> {t.ctaButton}
          </Link>
        </div>
      </section>

      <PublicFooter lang={lang} />
    </div>
  )
}
