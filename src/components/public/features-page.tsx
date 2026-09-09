'use client'

import Link from 'next/link'
import { useLang, PublicNav, PublicFooter } from './shell'
import { RevealOnScroll, StaggerGrid, StaggerItem } from '@/components/shared/motion'
import {
  Sparkles, ShieldCheck, BookOpen, BarChart2, Building2, GraduationCap,
  UserRound, Mail, CheckCircle2, ArrowLeft, ArrowRight,
} from 'lucide-react'

const dict = {
  ar: {
    title: 'كل ما تقدمه المنصة',
    desc: 'منصة واحدة تغطي الدورة التعليمية كاملة، من الدرس الأول حتى نشر العلامات.',
    features: [
      { icon: 'Sparkles', title: 'توليد بالذكاء الاصطناعي', desc: 'المعلم يكتب الموضوع، والمنصة تولّد درساً كاملاً أو اختباراً بأسئلته وإجاباته في ثوانٍ، قابل للتعديل قبل النشر.' },
      { icon: 'ShieldCheck', title: 'مراقبة ذكية للاختبارات', desc: 'كاميرا وذكاء اصطناعي يرصدان الوجوه المتعددة والنظر بعيداً وتبديل النوافذ، والتصحيح يتم على الخادم فلا تصل الإجابات الصحيحة للطالب أبداً.' },
      { icon: 'Building2', title: 'عزل كامل لكل جامعة', desc: 'كل جامعة مستأجر مستقل: بياناتها ومعلموها وطلابها معزولون تماماً عن غيرها على مستوى قاعدة البيانات نفسها.' },
      { icon: 'Mail', title: 'دعوات بدل التسجيل المفتوح', desc: 'لا أحد يدخل المنصة إلا بدعوة: الجامعة تدعو معلميها، والمعلم يدعو طلابه لمجموعته المحددة، برابط تنتهي صلاحيته تلقائياً.' },
      { icon: 'BarChart2', title: 'علامات وتقارير فورية', desc: 'تصحيح تلقائي فور التسليم، ونشر العلامات بضغطة، وتقارير شاملة لإدارة الجامعة.' },
      { icon: 'BookOpen', title: 'دروس ومجموعات منظمة', desc: 'المعلم ينظم طلابه في مجموعات (شُعَب)، وينشر الدروس لكل مجموعة، والطالب يرى محتوى مجموعته فقط.' },
    ],
    rolesTitle: 'لكل دور لوحته الخاصة',
    rolesDesc: 'المنصة مبنية على أدوار واضحة، فكل مستخدم يرى فقط ما يخصه، بواجهة مصممة لمهامه.',
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
        'تقديم الاختبارات من أي جهاز، حتى الجوال',
        'علاماته فور نشرها بدون انتظار',
        'واجهة بسيطة بلا تشتيت',
      ]},
    ],
    howTitle: 'كيف تبدأ جامعتك؟',
    steps: [
      { n: '1', title: 'تواصل معنا', desc: 'نجهّز لجامعتك بيئتها الخاصة ونرسل دعوة لمديرها' },
      { n: '2', title: 'ادعُ معلميك', desc: 'المدير يرسل دعوات للمعلمين، والمعلمون يدعون طلابهم' },
      { n: '3', title: 'ابدأ التدريس', desc: 'دروس واختبارات وعلامات، كل شيء يعمل من اليوم الأول' },
    ],
    cta: 'اطلب اشتراكاً لجامعتك',
  },
  en: {
    title: 'Everything the platform offers',
    desc: 'One platform covering the full teaching cycle, from the first lesson to publishing grades.',
    features: [
      { icon: 'Sparkles', title: 'AI-powered generation', desc: 'The teacher types a topic and the platform generates a full lesson or a complete exam with questions and answers in seconds, editable before publishing.' },
      { icon: 'ShieldCheck', title: 'Smart exam proctoring', desc: 'Camera and AI detect multiple faces, looking away and tab switching, and grading happens on the server, so correct answers never reach the student.' },
      { icon: 'Building2', title: 'Full isolation per university', desc: 'Each university is an independent tenant: its data, teachers and students are completely isolated at the database level.' },
      { icon: 'Mail', title: 'Invitations, not open signup', desc: 'Nobody enters without an invitation: the university invites its teachers, and each teacher invites students to a specific group, via auto-expiring links.' },
      { icon: 'BarChart2', title: 'Instant grades & reports', desc: 'Automatic grading on submission, one-click grade publishing, and full reports for university management.' },
      { icon: 'BookOpen', title: 'Organized lessons & groups', desc: 'Teachers organize students into groups, publish lessons per group, and each student sees only their own group’s content.' },
    ],
    rolesTitle: 'A dedicated dashboard for every role',
    rolesDesc: 'The platform is built on clear roles, so every user sees only what belongs to them, in an interface designed for their tasks.',
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
        'Take exams from any device, even a phone',
        'Grades the moment they are published',
        'A simple, distraction-free interface',
      ]},
    ],
    howTitle: 'How does your university start?',
    steps: [
      { n: '1', title: 'Contact us', desc: 'We prepare your university’s environment and invite its admin' },
      { n: '2', title: 'Invite your teachers', desc: 'The admin invites teachers, teachers invite their students' },
      { n: '3', title: 'Start teaching', desc: 'Lessons, exams and grades, everything works from day one' },
    ],
    cta: 'Request a subscription',
  },
}

const icons = { Sparkles, ShieldCheck, BookOpen, BarChart2, Building2, GraduationCap, UserRound, Mail } as const

export function FeaturesPage() {
  const [lang, setLang] = useLang()
  const t = dict[lang]
  const Arrow = lang === 'ar' ? ArrowLeft : ArrowRight

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-950">
      <PublicNav lang={lang} setLang={setLang} />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
        <h1 className="text-3xl sm:text-4xl font-bold text-white text-center">{t.title}</h1>
        <p className="text-slate-400 text-center max-w-2xl mx-auto mt-3 mb-12">{t.desc}</p>

        {/* Features */}
        <StaggerGrid className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {t.features.map((f, i) => {
            const Icon = icons[f.icon as keyof typeof icons]
            return (
              <StaggerItem key={i} className="eq-card-hover bg-slate-900 border border-slate-800 rounded-xl p-6 hover:border-slate-700">
                <div className="w-11 h-11 rounded-xl bg-blue-600/15 flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-blue-400" />
                </div>
                <h3 className="text-white font-semibold mb-2">{f.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
              </StaggerItem>
            )
          })}
        </StaggerGrid>

        {/* Roles */}
        <RevealOnScroll>
          <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mt-20 mb-3">{t.rolesTitle}</h2>
          <p className="text-slate-400 text-center max-w-2xl mx-auto mb-10">{t.rolesDesc}</p>
        </RevealOnScroll>
        <StaggerGrid className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {t.roles.map((r, i) => {
            const Icon = icons[r.icon as keyof typeof icons]
            return (
              <StaggerItem key={i} className="eq-card-hover bg-slate-900 border border-slate-800 rounded-xl p-7">
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
              </StaggerItem>
            )
          })}
        </StaggerGrid>

        {/* How it works */}
        <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mt-20 mb-10">{t.howTitle}</h2>
        <StaggerGrid className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-4xl mx-auto">
          {t.steps.map((s) => (
            <StaggerItem key={s.n} className="eq-card-hover bg-slate-900 border border-slate-800 rounded-xl p-6">
              <span className="inline-flex w-9 h-9 rounded-full bg-blue-600 text-white font-bold items-center justify-center mb-4">{s.n}</span>
              <h3 className="text-white font-semibold mb-2">{s.title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{s.desc}</p>
            </StaggerItem>
          ))}
        </StaggerGrid>

        <div className="text-center mt-14">
          <Link href="/contact"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors">
            {t.cta} <Arrow className="w-4 h-4" />
          </Link>
        </div>
      </main>

      <PublicFooter lang={lang} />
    </div>
  )
}
