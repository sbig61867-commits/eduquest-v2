'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useLang, PublicNav, PublicFooter } from './shell'
import {
  Sparkles, ShieldCheck, Users, BookOpen, ClipboardList, BarChart2,
  Building2, GraduationCap, UserRound, Mail, XCircle, CheckCircle2, ArrowLeft, ArrowRight,
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
    solutionTitle: 'الحل: منصة واحدة تفعل كل شيء',
    features: [
      { icon: 'Sparkles', title: 'توليد بالذكاء الاصطناعي', desc: 'المعلم يكتب الموضوع، والمنصة تولّد درساً كاملاً أو اختباراً بأسئلته وإجاباته في ثوانٍ — قابل للتعديل قبل النشر.' },
      { icon: 'ShieldCheck', title: 'مراقبة ذكية للاختبارات', desc: 'كاميرا وذكاء اصطناعي يرصدان الوجوه المتعددة والنظر بعيداً وتبديل النوافذ — والتصحيح يتم على الخادم فلا تصل الإجابات الصحيحة للطالب أبداً.' },
      { icon: 'Building2', title: 'عزل كامل لكل جامعة', desc: 'كل جامعة مستأجر مستقل: بياناتها ومعلموها وطلابها معزولون تماماً عن غيرها على مستوى قاعدة البيانات نفسها.' },
      { icon: 'Mail', title: 'دعوات بدل التسجيل المفتوح', desc: 'لا أحد يدخل المنصة إلا بدعوة: الجامعة تدعو معلميها، والمعلم يدعو طلابه لمجموعته المحددة — برابط تنتهي صلاحيته تلقائياً.' },
      { icon: 'BarChart2', title: 'علامات وتقارير فورية', desc: 'تصحيح تلقائي فور التسليم، ونشر العلامات بضغطة، وتقارير شاملة لإدارة الجامعة.' },
      { icon: 'BookOpen', title: 'دروس ومجموعات منظمة', desc: 'المعلم ينظم طلابه في مجموعات (شُعَب)، وينشر الدروس لكل مجموعة، والطالب يرى محتوى مجموعته فقط.' },
    ],
    rolesTitle: 'لكل دور لوحته الخاصة',
    rolesDesc: 'المنصة مبنية على أدوار واضحة — كل مستخدم يرى فقط ما يخصه، بواجهة مصممة لمهامه.',
    roles: [
      { icon: 'Building2', title: 'إدارة الجامعة', points: [
        'دعوة المعلمين وإدارة حساباتهم',
        'متابعة الطلاب وتفعيل/تعطيل الحسابات',
        'إحصائيات المؤسسة: معلمون، طلاب، دروس، اختبارات',
        'تقارير شاملة وسجل النشاط الأخير',
      ]},
      { icon: 'GraduationCap', title: 'المعلم', points: [
        'إنشاء المجموعات (الشُعَب) ودعوة الطلاب إليها',
        'توليد الدروس والاختبارات بالذكاء الاصطناعي وتعديلها',
        'مراجعة أحداث المراقبة لكل طالب بعد الاختبار',
        'التصحيح ونشر العلامات بضغطة واحدة',
      ]},
      { icon: 'UserRound', title: 'الطالب', points: [
        'دروس مجموعته مرتبة ومنسقة',
        'تقديم الاختبارات من أي جهاز — حتى الجوال',
        'علاماته فور نشرها بدون انتظار',
        'واجهة بسيطة بلا تشتيت',
      ]},
    ],
    howTitle: 'كيف تبدأ جامعتك؟',
    steps: [
      { n: '1', title: 'تواصل معنا', desc: 'نجهّز لجامعتك بيئتها الخاصة ونرسل دعوة لمديرها' },
      { n: '2', title: 'ادعُ معلميك', desc: 'المدير يرسل دعوات للمعلمين، والمعلمون يدعون طلابهم' },
      { n: '3', title: 'ابدأ التدريس', desc: 'دروس واختبارات وعلامات — كل شيء يعمل من اليوم الأول' },
    ],
    ctaTitle: 'جاهز تنقل جامعتك للمستوى التالي؟',
    ctaDesc: 'راسلنا وسنجهز بيئة جامعتك ونرافقكم خطوة بخطوة.',
    ctaButton: 'راسلنا الآن',
    contactTitle: 'تواصل معنا',
    contactDesc: 'اترك رسالتك وسنرد عليك على بريدك في أقرب وقت.',
    contactName: 'الاسم',
    contactEmail: 'بريدك الإلكتروني',
    contactMessage: 'رسالتك',
    contactMessagePh: 'أخبرنا عن جامعتك وما تحتاجه...',
    contactSend: 'إرسال الرسالة',
    contactSending: 'جارٍ الإرسال...',
    contactSuccess: 'وصلتنا رسالتك! سنرد عليك على بريدك قريباً.',
    contactError: 'تعذر الإرسال — تأكد من الحقول وحاول مجدداً.',
    contactRateLimit: 'وصلت الحد الأقصى للرسائل — حاول لاحقاً.',
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
    solutionTitle: 'The solution: one platform that does it all',
    features: [
      { icon: 'Sparkles', title: 'AI-powered generation', desc: 'The teacher types a topic and the platform generates a full lesson or a complete exam with questions and answers in seconds — editable before publishing.' },
      { icon: 'ShieldCheck', title: 'Smart exam proctoring', desc: 'Camera + AI detect multiple faces, looking away and tab switching — and grading happens on the server, so correct answers never reach the student.' },
      { icon: 'Building2', title: 'Full isolation per university', desc: 'Each university is an independent tenant: its data, teachers and students are completely isolated at the database level.' },
      { icon: 'Mail', title: 'Invitations, not open signup', desc: 'Nobody enters without an invitation: the university invites its teachers, and each teacher invites students to a specific group — via auto-expiring links.' },
      { icon: 'BarChart2', title: 'Instant grades & reports', desc: 'Automatic grading on submission, one-click grade publishing, and full reports for university management.' },
      { icon: 'BookOpen', title: 'Organized lessons & groups', desc: 'Teachers organize students into groups, publish lessons per group, and each student sees only their own group’s content.' },
    ],
    rolesTitle: 'A dedicated dashboard for every role',
    rolesDesc: 'The platform is built on clear roles — every user sees only what belongs to them, in an interface designed for their tasks.',
    roles: [
      { icon: 'Building2', title: 'University Admin', points: [
        'Invite teachers and manage their accounts',
        'Track students and enable/disable accounts',
        'Institution statistics: teachers, students, lessons, exams',
        'Full reports and a recent-activity feed',
      ]},
      { icon: 'GraduationCap', title: 'Teacher', points: [
        'Create groups and invite students to them',
        'Generate lessons and exams with AI, then edit them',
        'Review each student’s proctoring events after the exam',
        'Grade and publish results with one click',
      ]},
      { icon: 'UserRound', title: 'Student', points: [
        'Their group’s lessons, organized and formatted',
        'Take exams from any device — even a phone',
        'Grades the moment they are published',
        'A simple, distraction-free interface',
      ]},
    ],
    howTitle: 'How does your university start?',
    steps: [
      { n: '1', title: 'Contact us', desc: 'We prepare your university’s environment and invite its admin' },
      { n: '2', title: 'Invite your teachers', desc: 'The admin invites teachers, teachers invite their students' },
      { n: '3', title: 'Start teaching', desc: 'Lessons, exams and grades — everything works from day one' },
    ],
    ctaTitle: 'Ready to take your university to the next level?',
    ctaDesc: 'Message us and we’ll set up your university’s environment and guide you step by step.',
    ctaButton: 'Message us now',
    contactTitle: 'Contact Us',
    contactDesc: 'Leave your message and we’ll reply to your email as soon as possible.',
    contactName: 'Name',
    contactEmail: 'Your email',
    contactMessage: 'Your message',
    contactMessagePh: 'Tell us about your university and what you need...',
    contactSend: 'Send Message',
    contactSending: 'Sending...',
    contactSuccess: 'Message received! We’ll reply to your email soon.',
    contactError: 'Could not send — check the fields and try again.',
    contactRateLimit: 'Message limit reached — please try again later.',
  },
}

const icons = { Sparkles, ShieldCheck, Users, BookOpen, ClipboardList, BarChart2, Building2, GraduationCap, UserRound, Mail } as const

export function Landing() {
  const [lang, setLang] = useLang()
  const t = dict[lang]
  const Arrow = lang === 'ar' ? ArrowLeft : ArrowRight

  const [form, setForm] = useState({ name: '', email: '', message: '' })
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [sendError, setSendError] = useState('')

  async function submitContact(e: React.FormEvent) {
    e.preventDefault()
    setSendError(''); setSending(true)
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.status === 429) setSendError(t.contactRateLimit)
      else if (!res.ok) setSendError(t.contactError)
      else {
        setSent(true)
        setForm({ name: '', email: '', message: '' })
      }
    } catch {
      setSendError(t.contactError)
    }
    setSending(false)
  }

  const scrollToContact = () => document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' })

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-950">
      <PublicNav lang={lang} setLang={setLang} />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(37,99,235,0.15),transparent_60%)]" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-20 pb-24 text-center">
          <span className="inline-block px-4 py-1.5 rounded-full bg-blue-600/10 border border-blue-500/20 text-blue-400 text-sm font-medium mb-6">
            {t.heroBadge}
          </span>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-3xl mx-auto">
            {t.heroTitle}
          </h1>
          <p className="text-slate-400 text-lg mt-6 max-w-2xl mx-auto leading-relaxed">
            {t.heroDesc}
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-10">
            <button onClick={scrollToContact}
              className="w-full sm:w-auto px-7 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors flex items-center justify-center gap-2">
              {t.heroCta} <Arrow className="w-4 h-4" />
            </button>
            <Link href="/login"
              className="w-full sm:w-auto px-7 py-3.5 rounded-xl border border-slate-700 hover:border-slate-500 text-slate-200 font-semibold transition-colors text-center">
              {t.heroLogin}
            </Link>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
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

      {/* Solution / Features */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-10">{t.solutionTitle}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {t.features.map((f, i) => {
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
      </section>

      {/* Roles */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-3">{t.rolesTitle}</h2>
        <p className="text-slate-400 text-center max-w-2xl mx-auto mb-10">{t.rolesDesc}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {t.roles.map((r, i) => {
            const Icon = icons[r.icon as keyof typeof icons]
            return (
              <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-7">
                <div className="w-14 h-14 rounded-2xl bg-blue-600/15 flex items-center justify-center mb-4">
                  <Icon className="w-7 h-7 text-blue-400" />
                </div>
                <h3 className="text-white font-semibold text-lg mb-4">{r.title}</h3>
                <ul className="space-y-2.5">
                  {r.points.map((p, j) => (
                    <li key={j} className="flex items-start gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span className="text-slate-400 text-sm leading-relaxed">{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-10">{t.howTitle}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-4xl mx-auto">
          {t.steps.map((s) => (
            <div key={s.n} className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <span className="inline-flex w-9 h-9 rounded-full bg-blue-600 text-white font-bold items-center justify-center mb-4">{s.n}</span>
              <h3 className="text-white font-semibold mb-2">{s.title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
        <div className="relative overflow-hidden bg-gradient-to-br from-blue-600/20 to-slate-900 border border-blue-500/20 rounded-2xl p-10 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">{t.ctaTitle}</h2>
          <p className="text-slate-300 mb-8 max-w-xl mx-auto">{t.ctaDesc}</p>
          <button onClick={scrollToContact}
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors">
            <Mail className="w-4 h-4" /> {t.ctaButton}
          </button>
        </div>
      </section>

      {/* Contact form */}
      <section id="contact" className="max-w-6xl mx-auto px-4 sm:px-6 py-16 scroll-mt-20">
        <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-3">{t.contactTitle}</h2>
        <p className="text-slate-400 text-center max-w-xl mx-auto mb-10">{t.contactDesc}</p>
        <form onSubmit={submitContact} className="max-w-xl mx-auto bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
          {sent && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-3 text-emerald-400 text-sm font-medium">
              {t.contactSuccess}
            </div>
          )}
          {sendError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-red-400 text-sm font-medium">
              {sendError}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">{t.contactName}</label>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                required maxLength={100}
                className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">{t.contactEmail}</label>
              <input type="email" dir="ltr" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                required maxLength={200}
                className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-300">{t.contactMessage}</label>
            <textarea value={form.message} onChange={e => setForm(p => ({ ...p, message: e.target.value }))}
              required maxLength={2000} rows={5} placeholder={t.contactMessagePh}
              className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors resize-y" />
          </div>
          <button type="submit" disabled={sending}
            className="w-full px-7 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-semibold transition-colors flex items-center justify-center gap-2">
            <Mail className="w-4 h-4" /> {sending ? t.contactSending : t.contactSend}
          </button>
        </form>
      </section>

      <PublicFooter lang={lang} />
    </div>
  )
}
