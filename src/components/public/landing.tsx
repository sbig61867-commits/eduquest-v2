'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useLang, PublicNav, PublicFooter } from './shell'
import {
  ShieldCheck, Building2, Mail, XCircle, ArrowLeft, ArrowRight,
  ChevronDown, Users, BookOpen, ClipboardList, BarChart2, Radio, Volume2, CheckCircle2, Plus, Zap,
  GraduationCap, Megaphone, CalendarClock, Sparkles, TrendingUp, Award,
} from 'lucide-react'

const dict = {
  ar: {
    heroBadge: '✦ منصة واحدة، أربعة أدوار، صفر فوضى',
    heroTitle: 'كل قرار تعليمي في مكانه الصحيح',
    heroDesc: 'من إنشاء الدرس بالذكاء الاصطناعي، إلى مراقبة الاختبار لحظة بلحظة، إلى العلامة النهائية — EduQuest تصنع مساراً واحداً واضحاً لكل من يدير عملية تعليمية: جامعة، مركزاً، أو صفاً واحداً.',
    heroCta: 'اطلب اشتراكاً',
    heroLogin: 'تسجيل الدخول',
    roleStageTitle: 'واجهة مختلفة لكل شخص، بيانات واحدة موثوقة',
    roleStageDesc: 'بدّل بين الأدوار وشاهد كيف تبدو المنصة من كل زاوية.',
    roles: [
      {
        key: 'admin', icon: 'Building2', label: 'مدير الجامعة',
        title: 'نظرة كاملة على الجامعة', accent: '#4E9AD9',
        stats: [
          { icon: 'Users', label: 'معلم نشط', value: '128' },
          { icon: 'GraduationCap', label: 'طالب مسجّل', value: '3,410' },
          { icon: 'TrendingUp', label: 'معدل الإنجاز', value: '94%' },
        ],
      },
      {
        key: 'teacher', icon: 'BookOpen', label: 'المعلم',
        title: 'من فكرة إلى اختبار جاهز خلال ثوانٍ', accent: '#2DD4BF',
        stats: [
          { icon: 'Sparkles', label: 'درس مولَّد بالذكاء الاصطناعي', value: 'الآن' },
          { icon: 'ClipboardList', label: 'اختبار قيد المراقبة', value: 'مباشر' },
          { icon: 'Award', label: 'علامات مصحَّحة تلقائياً', value: '312' },
        ],
      },
      {
        key: 'student', icon: 'GraduationCap', label: 'الطالب',
        title: 'كل مادته، في مكان واحد بسيط', accent: '#F2B84B',
        stats: [
          { icon: 'BookOpen', label: 'دروس هذا الأسبوع', value: '6' },
          { icon: 'ClipboardList', label: 'اختبار قادم', value: 'غداً 10ص' },
          { icon: 'Award', label: 'آخر علامة', value: '96/100' },
        ],
      },
      {
        key: 'center', icon: 'CalendarClock', label: 'مركز التعليم المستمر',
        title: 'جداول وإعلانات بلا فوضى واتساب', accent: '#9F7AEA',
        stats: [
          { icon: 'CalendarClock', label: 'جدول أسبوعي منشور', value: '14' },
          { icon: 'Megaphone', label: 'إعلان جديد', value: '2 اليوم' },
          { icon: 'Users', label: 'طاقم إداري متعاون', value: '5' },
        ],
      },
    ],
    transformTitle: 'قبل وبعد EduQuest',
    transformSub: 'نفس اليوم الدراسي، نتيجة مختلفة تماماً.',
    transformBefore: 'بدون EduQuest',
    transformAfter: 'مع EduQuest',
    transformPairs: [
      { from: 'دروس في مكان، اختبارات بمكان تاني، وعلامات بجدول إكسل', to: 'كل شيء في مكان واحد، من الدرس حتى العلامة' },
      { from: 'اختبار عن بُعد بلا أي رقابة', to: 'مراقبة حية وذكاء اصطناعي يحميان النزاهة' },
      { from: 'ساعات لإعداد كل درس واختبار', to: 'دقائق، بمساعدة الذكاء الاصطناعي' },
      { from: 'بيانات كل المؤسسات بسلة واحدة', to: 'عزل تام لبيانات كل جامعة' },
    ],
    statsTitle: 'أرقام تتحدث عن المنصة',
    stats: [
      { value: '4', label: 'أدوار متكاملة', sub: 'مدير جامعة، مركز، معلم، طالب' },
      { value: 'ثوانٍ', label: 'لتوليد درس أو اختبار كامل', sub: 'بالذكاء الاصطناعي، قابل للتعديل' },
      { value: '100%', label: 'عزل البيانات بين الجامعات', sub: 'على مستوى قاعدة البيانات نفسها' },
      { value: 'مباشر', label: 'مراقبة الاختبارات', sub: 'صوت وصورة لكل الطلاب في آنٍ واحد' },
    ],
    trustTitle: 'لماذا EduQuest؟',
    trust: [
      { title: 'التصحيح على الخادم، لا في المتصفح', desc: 'الإجابات الصحيحة لا تغادر الخادم أبداً — لا يمكن للطالب رؤيتها أو التلاعب بها مهما حاول.' },
      { title: 'توقيت الاختبار محسوم من الخادم', desc: 'وقت البدء والانتهاء يسجَّل على خوادمنا — تحديث الصفحة أو التلاعب بساعة الجهاز لا يغيّر شيئاً.' },
      { title: 'حذف آمن مع أرشيف كامل', desc: 'لا شيء يُحذف نهائياً بالخطأ — كل حذف يذهب لأرشيف يمكن للمدير استعادته في أي وقت.' },
      { title: 'مرافقة كاملة عند البدء', desc: 'نجهّز بيئة جامعتك بأنفسنا ونرافق فريقك خطوة بخطوة حتى تستقر العملية التعليمية.' },
    ],
    teaserTitle: 'الحل: منصة واحدة تفعل كل شيء',
    teaser: [
      { icon: 'Zap', title: 'توليد بالذكاء الاصطناعي', desc: 'دروس واختبارات كاملة في ثوانٍ، قابلة للتعديل قبل النشر.' },
      { icon: 'ShieldCheck', title: 'مراقبة ذكية للاختبارات', desc: 'كاميرا وذكاء اصطناعي يحميان نزاهة الاختبار، والتصحيح على الخادم.' },
      { icon: 'Building2', title: 'عزل كامل لكل جامعة', desc: 'بيانات كل جامعة معزولة تماماً على مستوى قاعدة البيانات.' },
    ],
    allFeatures: 'استكشف كل المميزات',
    liveTitle: 'تشوف كل طالب وتسمعه، لحظة بلحظة',
    liveDesc: 'المعلم يفتح جداراً مباشراً لكل طلاب الاختبار — صورة وصوت الجميع في آنٍ واحد، بدون تطبيق خارجي.',
    livePoints: [
      'يتكلم؟ بتشوف علامة فوق طالبه فوراً',
      'اضغط على أي طالب لتكبيره وتتابعه لحاله',
      'ثابتة حتى على إنترنت ضعيف',
    ],
    liveCta: 'شوف تفاصيل المراقبة الحية',
    aiTitle: 'مساعدك لكل شيء تعليمي',
    aiDesc: 'اكتب موضوعاً بجملة واحدة، ويطلع لك درس كامل أو اختبار جاهز بأسئلته وإجاباته — تراجعه وتعدّله قبل ما ينشر.',
    aiPoints: [
      'درس أو اختبار كامل خلال ثوانٍ',
      'قابل للتعديل بالكامل قبل النشر',
      'يفهم موضوعك بلغتك العربية والإنجليزية',
    ],
    aiCta: 'شوف كيف يعمل المساعد',
    stepsTitle: 'كيف تبدأ في 4 خطوات',
    steps: [
      { title: 'اطلب اشتراكاً', desc: 'راسلنا عبر النموذج وأخبرنا عن جامعتك.' },
      { title: 'نجهّز بيئتك', desc: 'ننشئ بيئة معزولة خاصة بجامعتك ونسلّمك لوحة إدارتها.' },
      { title: 'ادعُ فريقك', desc: 'أضف المعلمين بروابط دعوة، وهم يدعون طلابهم لمجموعاتهم.' },
      { title: 'ابدأ التدريس', desc: 'ولّد الدروس والاختبارات، راقب، وصحّح — كله من مكان واحد.' },
    ],
    faqTitle: 'أسئلة شائعة',
    faqs: [
      { q: 'هل بيانات جامعتنا معزولة عن غيرها؟', a: 'نعم، تماماً. كل جامعة لها بيئتها المعزولة على مستوى قاعدة البيانات — لا يرى أحد بيانات أحد.' },
      { q: 'كيف تمنعون الغش في الاختبارات عن بُعد؟', a: 'مراقبة مزدوجة: ذكاء اصطناعي يرصد المخالفات ويسجّلها، ومراقبة حية يرى فيها المعلم ويسمع كل الطلاب مباشرة أثناء الاختبار.' },
      { q: 'هل نحتاج خبرة تقنية لتشغيل المنصة؟', a: 'لا. الواجهة بسيطة لكل الأدوار، ونحن نجهّز بيئتكم ونرافقكم في البداية خطوة بخطوة.' },
      { q: 'هل يمكن توليد الدروس والاختبارات تلقائياً؟', a: 'نعم، بالذكاء الاصطناعي من ملفاتكم أو من عنوان — وكلها قابلة للمراجعة والتعديل قبل النشر.' },
    ],
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
    heroBadge: '✦ One platform, four roles, zero chaos',
    heroTitle: 'Every teaching decision, exactly where it belongs',
    heroDesc: "From an AI-drafted lesson, to a live-monitored exam, to the final grade — EduQuest gives everyone running an educational operation, a university, a center, or a single classroom, one clear path.",
    heroCta: 'Request a subscription',
    heroLogin: 'Sign In',
    roleStageTitle: 'A different view for every person, one trusted dataset',
    roleStageDesc: 'Switch between roles and see the platform from every angle.',
    roles: [
      {
        key: 'admin', icon: 'Building2', label: 'University Admin',
        title: 'A complete view of the university', accent: '#4E9AD9',
        stats: [
          { icon: 'Users', label: 'Active teachers', value: '128' },
          { icon: 'GraduationCap', label: 'Enrolled students', value: '3,410' },
          { icon: 'TrendingUp', label: 'Completion rate', value: '94%' },
        ],
      },
      {
        key: 'teacher', icon: 'BookOpen', label: 'Teacher',
        title: 'From idea to ready exam in seconds', accent: '#2DD4BF',
        stats: [
          { icon: 'Sparkles', label: 'AI-generated lesson', value: 'Now' },
          { icon: 'ClipboardList', label: 'Exam being proctored', value: 'Live' },
          { icon: 'Award', label: 'Auto-graded submissions', value: '312' },
        ],
      },
      {
        key: 'student', icon: 'GraduationCap', label: 'Student',
        title: 'Every subject, in one simple place', accent: '#F2B84B',
        stats: [
          { icon: 'BookOpen', label: "This week's lessons", value: '6' },
          { icon: 'ClipboardList', label: 'Upcoming exam', value: 'Tomorrow 10am' },
          { icon: 'Award', label: 'Latest grade', value: '96/100' },
        ],
      },
      {
        key: 'center', icon: 'CalendarClock', label: 'Continuing-Ed Center',
        title: 'Schedules and announcements, no WhatsApp chaos', accent: '#9F7AEA',
        stats: [
          { icon: 'CalendarClock', label: 'Published weekly schedules', value: '14' },
          { icon: 'Megaphone', label: 'New announcement', value: '2 today' },
          { icon: 'Users', label: 'Collaborating staff', value: '5' },
        ],
      },
    ],
    transformTitle: 'Before and after EduQuest',
    transformSub: 'Same school day, a completely different outcome.',
    transformBefore: 'Without EduQuest',
    transformAfter: 'With EduQuest',
    transformPairs: [
      { from: 'Lessons here, exams there, grades in a spreadsheet', to: 'Everything in one place, lesson to grade' },
      { from: 'Remote exams with zero supervision', to: 'Live monitoring + AI protecting integrity' },
      { from: 'Hours to prepare every lesson and exam', to: 'Minutes, with AI doing the drafting' },
      { from: "Every institution's data in one basket", to: "Full isolation for each university's data" },
    ],
    statsTitle: 'Numbers that speak for the platform',
    stats: [
      { value: '4', label: 'Integrated roles', sub: 'University admin, center, teacher, student' },
      { value: 'Seconds', label: 'To generate a full lesson or exam', sub: 'AI-powered, editable before publishing' },
      { value: '100%', label: 'Data isolation between universities', sub: 'Enforced at the database level itself' },
      { value: 'Live', label: 'Exam monitoring', sub: 'Audio + video of all students at once' },
    ],
    trustTitle: 'Why EduQuest?',
    trust: [
      { title: 'Grading on the server, not the browser', desc: "Correct answers never leave the server — students can't see or tamper with them, no matter what." },
      { title: 'Exam timing decided by the server', desc: 'Start and end times are recorded on our servers — refreshing the page or changing the device clock changes nothing.' },
      { title: 'Safe deletion with a full archive', desc: 'Nothing is ever destroyed by mistake — every delete goes to an archive the admin can restore anytime.' },
      { title: 'Full onboarding support', desc: "We set up your university's environment ourselves and guide your team step by step until everything runs smoothly." },
    ],
    teaserTitle: 'The solution: one platform that does it all',
    teaser: [
      { icon: 'Zap', title: 'AI-powered generation', desc: 'Full lessons and exams in seconds, editable before publishing.' },
      { icon: 'ShieldCheck', title: 'Smart exam proctoring', desc: 'Camera + AI protect exam integrity, with grading on the server.' },
      { icon: 'Building2', title: 'Full isolation per university', desc: "Every university's data is fully isolated at the database level." },
    ],
    allFeatures: 'Explore all features',
    liveTitle: 'See and hear every student, live',
    liveDesc: "The teacher opens one live wall for the whole exam — everyone's video and audio at once, no third-party app.",
    livePoints: [
      'Speaking? A marker appears on their tile instantly',
      'Click any student to zoom in and follow them alone',
      'Stays stable even on weak internet',
    ],
    liveCta: 'See live monitoring in detail',
    aiTitle: 'Your assistant for everything teaching',
    aiDesc: 'Type a topic in one sentence and get back a full lesson or a ready exam with questions and answers — review and tweak it before publishing.',
    aiPoints: [
      'A full lesson or exam in seconds',
      'Fully editable before publishing',
      'Understands your topic in Arabic or English',
    ],
    aiCta: 'See how the assistant works',
    stepsTitle: 'Get started in 4 steps',
    steps: [
      { title: 'Request access', desc: 'Message us through the form and tell us about your university.' },
      { title: 'We set you up', desc: 'We create your isolated environment and hand you its admin dashboard.' },
      { title: 'Invite your team', desc: 'Add teachers via invite links; they invite their students into groups.' },
      { title: 'Start teaching', desc: 'Generate lessons and exams, proctor, and grade — all from one place.' },
    ],
    faqTitle: 'Frequently asked questions',
    faqs: [
      { q: "Is our university's data isolated from others?", a: "Yes, completely. Each university has its own isolated environment at the database level — no one can see anyone else's data." },
      { q: 'How do you prevent cheating in remote exams?', a: 'Dual proctoring: AI detects and logs violations, plus live monitoring where the teacher sees and hears all students in real time during the exam.' },
      { q: 'Do we need technical expertise to run it?', a: 'No. The interface is simple for every role, and we set up your environment and guide you step by step at the start.' },
      { q: 'Can lessons and exams be generated automatically?', a: 'Yes, with AI from your files or from a topic — all reviewable and editable before publishing.' },
    ],
    mock: {
      title: 'Teacher usage allowances',
      stats: [
        { icon: 'BookOpen', label: 'AI lessons', value: '10/hour' },
        { icon: 'ClipboardList', label: 'AI exams', value: '20/hour' },
        { icon: 'Users', label: 'Student invitations', value: '50/hour' },
        { icon: 'BarChart2', label: 'Group size', value: 'Unlimited' },
      ],
      chartLabel: "Example: a group's weekly activity",
    },
    ctaTitle: 'Ready to take your university to the next level?',
    ctaDesc: "Message us and we'll set up your university's environment and guide you step by step.",
    ctaButton: 'Message us now',
  },
}

const icons = {
  Zap, ShieldCheck, Building2, Users, BookOpen, ClipboardList, BarChart2,
  GraduationCap, Megaphone, CalendarClock, Sparkles, TrendingUp, Award,
} as const

type Role = {
  key: string; icon: keyof typeof icons; label: string; title: string; accent: string
  stats: { icon: keyof typeof icons; label: string; value: string }[]
}

function RoleStage({ roles }: { roles: Role[] }) {
  const [active, setActive] = useState(0)
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  const [paused, setPaused] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (paused) return
    const id = setInterval(() => setActive(a => (a + 1) % roles.length), 4200)
    return () => clearInterval(id)
  }, [paused, roles.length])

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = stageRef.current?.getBoundingClientRect()
    if (!r) return
    const px = (e.clientX - r.left) / r.width - 0.5
    const py = (e.clientY - r.top) / r.height - 0.5
    setTilt({ x: py * -8, y: px * 12 })
  }
  const onLeave = () => setTilt({ x: 0, y: 0 })

  const role = roles[active]
  const RoleIcon = icons[role.icon]

  return (
    <div>
      {/* role tabs */}
      <div className="flex flex-wrap items-center justify-center gap-2 mb-8">
        {roles.map((r, i) => {
          const Icon = icons[r.icon]
          const isActive = i === active
          return (
            <button
              key={r.key}
              onClick={() => setActive(i)}
              onMouseEnter={() => setPaused(true)}
              onMouseLeave={() => setPaused(false)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border transition-all ${
                isActive
                  ? 'text-white shadow-[0_8px_24px_rgba(0,0,0,0.15)] scale-105'
                  : 'bg-elevated border-border text-fg-secondary hover:border-accent-border'
              }`}
              style={isActive ? { backgroundColor: r.accent, borderColor: r.accent } : undefined}
            >
              <Icon className="w-4 h-4" /> {r.label}
            </button>
          )
        })}
      </div>

      {/* 3D stage */}
      <div
        ref={stageRef}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        className="eq-stage relative max-w-3xl mx-auto"
      >
        <div
          className="absolute -inset-8 blur-3xl rounded-[40px] transition-colors duration-500"
          style={{ backgroundColor: `${role.accent}22` }}
        />
        <div
          className="eq-tilt-card relative bg-elevated border border-border rounded-[24px] overflow-hidden shadow-[0_24px_64px_rgba(11,54,88,0.16)]"
          style={{ transform: `rotateX(${6 + tilt.x}deg) rotateY(${tilt.y}deg)` }}
        >
          <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border" style={{ backgroundColor: `${role.accent}14` }}>
            <span className="w-2.5 h-2.5 rounded-full bg-red-400/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/70" />
            <span className="flex items-center gap-1.5 text-fg text-xs font-semibold ms-3">
              <RoleIcon className="w-3.5 h-3.5" style={{ color: role.accent }} /> {role.title}
            </span>
          </div>
          <div className="p-5 sm:p-7 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {role.stats.map((s, i) => {
              const Icon = icons[s.icon]
              return (
                <div
                  key={i}
                  className="eq-float bg-surface border border-border rounded-2xl p-4"
                  style={{ animationDelay: `${i * 0.5}s` }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-fg-muted text-[11px]">{s.label}</span>
                    <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${role.accent}20` }}>
                      <Icon className="w-3.5 h-3.5" style={{ color: role.accent }} />
                    </div>
                  </div>
                  <p className="text-fg text-lg font-bold">{s.value}</p>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* progress dots */}
      <div className="flex items-center justify-center gap-1.5 mt-6">
        {roles.map((r, i) => (
          <span
            key={r.key}
            className="h-1.5 rounded-full transition-all duration-300"
            style={{
              width: i === active ? '24px' : '6px',
              backgroundColor: i === active ? r.accent : 'var(--color-border-strong)',
            }}
          />
        ))}
      </div>
    </div>
  )
}

export function Landing() {
  const [lang, setLang] = useLang()
  const t = dict[lang]
  const Arrow = lang === 'ar' ? ArrowLeft : ArrowRight

  // Force light mode on the landing page regardless of OS preference
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'light')
    return () => document.documentElement.removeAttribute('data-theme')
  }, [])

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="min-h-screen bg-canvas">
      <PublicNav lang={lang} setLang={setLang} />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* ambient gradient blobs */}
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <div className="eq-blob-1 absolute -top-24 -start-24 w-[420px] h-[420px] rounded-full blur-3xl opacity-40" style={{ background: 'radial-gradient(circle, #4E9AD9, transparent 70%)' }} />
          <div className="eq-blob-2 absolute top-32 -end-32 w-[380px] h-[380px] rounded-full blur-3xl opacity-30" style={{ background: 'radial-gradient(circle, #2DD4BF, transparent 70%)' }} />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(78,154,217,0.10),transparent)]" />
        </div>
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 pb-6 text-center">
          <span className="inline-block px-4 py-1.5 rounded-full bg-accent-subtle border border-accent-border text-accent text-sm font-semibold mb-6">
            {t.heroBadge}
          </span>
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black leading-tight tracking-tight max-w-3xl mx-auto text-fg" style={{letterSpacing: '-0.02em'}}>
            {t.heroTitle}
          </h1>
          <p className="text-fg-secondary text-base sm:text-lg mt-5 max-w-2xl mx-auto leading-relaxed">
            {t.heroDesc}
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-8">
            <Link href="/contact"
              className="w-full sm:w-auto px-7 py-3.5 rounded-[24px] bg-accent hover:bg-accent-hover text-accent-fg font-semibold transition-colors flex items-center justify-center gap-2 shadow-[0_8px_32px_rgba(78,154,217,0.30)]">
              {t.heroCta} <Arrow className="w-4 h-4" />
            </Link>
            <Link href="/login"
              className="w-full sm:w-auto px-7 py-3.5 rounded-[24px] border border-border hover:border-accent-border text-fg font-semibold transition-colors text-center">
              {t.heroLogin}
            </Link>
          </div>

          {/* 3D role stage — the platform seen from every seat */}
          <div className="mt-14 sm:mt-20" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            <RoleStage roles={t.roles as Role[]} />
          </div>

          <div className="flex justify-center mt-10 pb-2">
            <ChevronDown className="w-5 h-5 text-fg-muted animate-bounce" />
          </div>
        </div>
      </section>

      {/* ── Before / after transformation ───────────────────────────────────── */}
      <section className="bg-surface border-y border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-fg text-center mb-2" style={{letterSpacing: '-0.01em'}}>{t.transformTitle}</h2>
          <p className="text-fg-secondary text-center max-w-xl mx-auto mb-10">{t.transformSub}</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-0 rounded-[24px] overflow-hidden border border-border shadow-[0_12px_48px_rgba(11,54,88,0.08)]">
            <div className="bg-elevated p-6 sm:p-8">
              <span className="inline-flex items-center gap-1.5 text-error text-xs font-bold uppercase tracking-wide mb-5">
                <XCircle className="w-4 h-4" /> {t.transformBefore}
              </span>
              <div className="space-y-4">
                {t.transformPairs.map((pair, i) => (
                  <p key={i} className="text-fg-muted text-sm leading-relaxed">{pair.from}</p>
                ))}
              </div>
            </div>
            <div className="bg-[#0b3658] p-6 sm:p-8">
              <span className="inline-flex items-center gap-1.5 text-[#7fd4c1] text-xs font-bold uppercase tracking-wide mb-5">
                <CheckCircle2 className="w-4 h-4" /> {t.transformAfter}
              </span>
              <div className="space-y-4">
                {t.transformPairs.map((pair, i) => (
                  <p key={i} className="text-white text-sm font-medium leading-relaxed">{pair.to}</p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats ────────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-fg text-center mb-10" style={{letterSpacing: '-0.01em'}}>{t.statsTitle}</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-border rtl:divide-x-reverse border border-border rounded-[20px] overflow-hidden shadow-[0_12px_48px_rgba(11,54,88,0.08)]">
          {t.stats.map((s, i) => (
            <div key={i} className="p-6 sm:p-8 text-center bg-elevated">
              <p className="text-3xl sm:text-4xl font-extrabold text-accent">{s.value}</p>
              <p className="text-fg text-sm font-semibold mt-2">{s.label}</p>
              <p className="text-fg-muted text-xs mt-1 leading-relaxed">{s.sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Solution teaser ──────────────────────────────────────────────── */}
      <section className="bg-surface border-y border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-fg text-center mb-10" style={{letterSpacing: '-0.01em'}}>{t.teaserTitle}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {t.teaser.map((f, i) => {
              const Icon = icons[f.icon as keyof typeof icons]
              return (
                <div key={i} className="bg-elevated border border-border rounded-[20px] p-6 hover:border-accent-border transition-colors shadow-[0_4px_16px_rgba(11,54,88,0.06)] hover:shadow-[0_8px_32px_rgba(11,54,88,0.10)]">
                  <div className="w-11 h-11 rounded-xl bg-accent-subtle flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5 text-accent" />
                  </div>
                  <h3 className="text-fg font-semibold mb-2">{f.title}</h3>
                  <p className="text-fg-secondary text-sm leading-relaxed">{f.desc}</p>
                </div>
              )
            })}
          </div>
          <div className="text-center mt-10">
            <Link href="/features"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-[24px] border border-border hover:border-accent-border text-fg-secondary hover:text-accent font-semibold transition-colors">
              {t.allFeatures} <Arrow className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Live proctoring — full dedicated section ────────────────────────── */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <div className="relative border border-border rounded-[24px] p-6 sm:p-10 bg-elevated shadow-[0_12px_48px_rgba(11,54,88,0.08)] overflow-hidden">
          <div className="absolute -top-20 -end-20 w-72 h-72 rounded-full blur-3xl opacity-20 pointer-events-none" style={{ background: 'radial-gradient(circle, #F43F5E, transparent 70%)' }} />
          <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
            <div>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-error-subtle border border-error/20 text-error text-xs font-semibold mb-4">
                <Radio className="w-3.5 h-3.5 animate-pulse" /> {lang === 'ar' ? 'مباشر' : 'LIVE'}
              </span>
              <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-fg mb-3" style={{letterSpacing: '-0.01em'}}>{t.liveTitle}</h2>
              <p className="text-fg-secondary leading-relaxed mb-5">{t.liveDesc}</p>
              <ul className="space-y-2.5 mb-6">
                {t.livePoints.map((p, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-fg-secondary text-sm">
                    <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" /> {p}
                  </li>
                ))}
              </ul>
              <Link href="/features/live-monitoring"
                className="inline-flex items-center gap-2 text-error font-semibold text-sm hover:gap-3 transition-all">
                {t.liveCta} <Arrow className="w-4 h-4" />
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={`relative aspect-video rounded-lg bg-surface border-2 overflow-hidden ${i === 1 ? 'border-success' : 'border-border'}`}>
                  <Users className="absolute inset-0 m-auto w-6 h-6 text-fg-muted" />
                  {i === 1 && (
                    <span className="absolute top-1.5 end-1.5 flex items-center gap-1 bg-success text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                      <Volume2 className="w-2.5 h-2.5" /> {lang === 'ar' ? 'يتكلم' : 'speaking'}
                    </span>
                  )}
                  <span className="absolute bottom-1 start-1.5 text-fg-muted text-[10px]">{lang === 'ar' ? `طالب ${i + 1}` : `Student ${i + 1}`}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── AI assistant — full dedicated section ───────────────────────────── */}
      <section className="bg-surface border-y border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="relative border border-border rounded-[24px] p-6 sm:p-10 bg-elevated shadow-[0_12px_48px_rgba(11,54,88,0.08)] overflow-hidden">
            <div className="absolute -bottom-20 -start-20 w-72 h-72 rounded-full blur-3xl opacity-20 pointer-events-none" style={{ background: 'radial-gradient(circle, #2DD4BF, transparent 70%)' }} />
            <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
              <div className="order-2 lg:order-1">
                <div className="relative bg-canvas border border-border rounded-2xl p-4 sm:p-5 font-mono text-xs sm:text-sm">
                  <p className="text-fg-muted mb-2">{lang === 'ar' ? '> اكتب موضوع الدرس' : '> type a lesson topic'}</p>
                  <p className="text-fg font-semibold mb-3">
                    {lang === 'ar' ? 'الدورة الدموية الصغرى والكبرى' : 'Pulmonary and systemic circulation'}
                    <span className="inline-block w-1.5 h-4 bg-accent ms-1 align-middle animate-pulse" />
                  </p>
                  <div className="space-y-2">
                    {[100, 85, 70].map((w, i) => (
                      <div key={i} className="h-2.5 rounded-full bg-accent/15 eq-float" style={{ width: `${w}%`, animationDelay: `${i * 0.4}s` }} />
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5 mt-4 text-success text-[11px] font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {lang === 'ar' ? 'جاهز للمراجعة' : 'Ready to review'}
                  </div>
                </div>
              </div>
              <div className="order-1 lg:order-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent-subtle border border-accent-border text-accent text-xs font-semibold mb-4">
                  <Sparkles className="w-3.5 h-3.5" /> AI
                </span>
                <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-fg mb-3" style={{letterSpacing: '-0.01em'}}>{t.aiTitle}</h2>
                <p className="text-fg-secondary leading-relaxed mb-5">{t.aiDesc}</p>
                <ul className="space-y-2.5 mb-6">
                  {t.aiPoints.map((p, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-fg-secondary text-sm">
                      <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" /> {p}
                    </li>
                  ))}
                </ul>
                <Link href="/features/ai-assistant" target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-accent font-semibold text-sm hover:gap-3 transition-all">
                  {t.aiCta} <Arrow className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Steps ────────────────────────────────────────────────────────── */}
      <section className="bg-surface border-y border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-fg text-center mb-10" style={{letterSpacing: '-0.01em'}}>{t.stepsTitle}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {t.steps.map((s, i) => (
              <div key={i} className="relative bg-elevated border border-border rounded-[20px] p-6 shadow-[0_4px_16px_rgba(11,54,88,0.06)]">
                <span className="flex items-center justify-center w-9 h-9 rounded-full bg-accent text-accent-fg font-black mb-4">{i + 1}</span>
                <h3 className="text-fg font-semibold mb-1.5">{s.title}</h3>
                <p className="text-fg-secondary text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Trust / why us ───────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-fg text-center mb-10" style={{letterSpacing: '-0.01em'}}>{t.trustTitle}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {t.trust.map((item, i) => (
            <div key={i} className="flex items-start gap-4 bg-elevated border border-border rounded-[20px] p-6 hover:border-accent-border transition-colors shadow-[0_4px_16px_rgba(11,54,88,0.06)] hover:shadow-[0_8px_32px_rgba(11,54,88,0.10)]">
              <div className="w-10 h-10 rounded-xl bg-accent-subtle flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h3 className="text-fg font-semibold mb-1.5">{item.title}</h3>
                <p className="text-fg-secondary text-sm leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section className="bg-surface border-y border-border">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-fg text-center mb-10" style={{letterSpacing: '-0.01em'}}>{t.faqTitle}</h2>
          <div className="space-y-3">
            {t.faqs.map((f, i) => (
              <details key={i} className="group bg-elevated border border-border rounded-[20px] overflow-hidden shadow-[0_2px_8px_rgba(11,54,88,0.05)]">
                <summary className="flex items-center justify-between gap-3 p-5 cursor-pointer list-none text-fg font-medium">
                  {f.q}
                  <Plus className="w-4 h-4 text-fg-muted shrink-0 transition-transform group-open:rotate-45" />
                </summary>
                <p className="px-5 pb-5 -mt-1 text-fg-secondary text-sm leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA — full-bleed Midnight Harbor dark navy banner (cord.com style) ── */}
      <section className="bg-[#0b3658] mt-4">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 text-center">
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white mb-3" style={{letterSpacing: '-0.02em'}}>{t.ctaTitle}</h2>
          <p className="text-[#a8c8e2] mb-8 max-w-xl mx-auto leading-relaxed">{t.ctaDesc}</p>
          <Link href="/contact"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-[24px] bg-[#4e9ad9] hover:bg-[#3a85c4] text-white font-semibold transition-colors shadow-[0_8px_32px_rgba(78,154,217,0.35)]">
            <Mail className="w-4 h-4" /> {t.ctaButton}
          </Link>
        </div>
      </section>

      <PublicFooter lang={lang} />
    </div>
  )
}
