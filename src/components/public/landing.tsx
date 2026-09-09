'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useLang, PublicNav, PublicFooter } from './shell'
import { AiTypingMockup, LiveProctoringGrid } from './mockups'
import {
  ShieldCheck, Building2, Mail, XCircle, ArrowLeft, ArrowRight,
  ChevronDown, Users, BookOpen, ClipboardList, BarChart2, CheckCircle2, Plus, Zap,
  GraduationCap, Megaphone, CalendarClock, Sparkles, TrendingUp, Award,
  Lock, Clock, Archive, Headphones,
} from 'lucide-react'

const dict = {
  ar: {
    heroBadge: '✦ للجامعات والمراكز التعليمية',
    heroTitle: 'بيئة أكاديمية متكاملة من الدرس إلى العلامة',
    heroDesc: 'من إنشاء الدرس بالذكاء الاصطناعي، إلى مراقبة الاختبار لحظة بلحظة، إلى العلامة النهائية. تصنع EduQuest مساراً واحداً واضحاً لكل من يدير عملية تعليمية: جامعة، مركزاً، أو صفاً واحداً.',
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
      { icon: 'Lock', title: 'التصحيح على الخادم، لا في المتصفح', desc: 'الإجابات الصحيحة لا تغادر الخادم أبداً، فلا يمكن للطالب رؤيتها أو التلاعب بها مهما حاول.' },
      { icon: 'Clock', title: 'توقيت الاختبار محسوم من الخادم', desc: 'وقت البدء والانتهاء يسجَّل على خوادمنا، فتحديث الصفحة أو التلاعب بساعة الجهاز لا يغيّر شيئاً.' },
      { icon: 'Archive', title: 'حذف آمن مع أرشيف كامل', desc: 'لا شيء يُحذف نهائياً بالخطأ، فكل حذف يذهب لأرشيف يمكن للمدير استعادته في أي وقت.' },
      { icon: 'Headphones', title: 'مرافقة كاملة عند البدء', desc: 'نجهّز بيئة جامعتك بأنفسنا ونرافق فريقك خطوة بخطوة حتى تستقر العملية التعليمية.' },
    ],
    teaserTitle: 'نظام تعلّم كامل وإدارة أكاديمية في منصة واحدة',
    teaser: [
      { icon: 'BookOpen', title: 'كورسات ودروس منظّمة', desc: 'أنشئ مواد دراسية بمستويات ووحدات، وشارك المحتوى مع مجموعاتك فوراً.' },
      { icon: 'ClipboardList', title: 'واجبات واختبارات متكاملة', desc: 'اختبارات موقوتة، تصحيح تلقائي، ودرجات مباشرة في كتاب العلامات.' },
      { icon: 'BarChart2', title: 'تتبع تقدم الطالب', desc: 'درجات ونسب إنجاز لكل طالب، بصريات واضحة للمعلم والمدير.' },
      { icon: 'Zap', title: 'مساعد أكاديمي بالذكاء الاصطناعي', desc: 'مساعد ذكاء اصطناعي يرافق المعلم خطوة بخطوة في إعداد الدروس والاختبارات، قابل للمراجعة والتعديل الكامل قبل النشر.' },
      { icon: 'ShieldCheck', title: 'مراقبة حية للاختبارات', desc: 'كاميرا وذكاء اصطناعي يصونان نزاهة الاختبار، مع تصحيح آمن على الخادم لا يُخترق.' },
      { icon: 'Building2', title: 'عزل تام بين المؤسسات', desc: 'بيانات كل مؤسسة تعليمية معزولة بالكامل على مستوى قاعدة البيانات، مع ضمان انعدام أي تداخل بين بيانات المستخدمين.' },
    ],
    allFeatures: 'استكشف كل المميزات',
    liveTitle: 'رؤية حية لقاعات الاختبار عبر تقنية الفيديو',
    liveDesc: 'اتصال مرئي مباشر بين المراقب وجميع المتقدمين، مع إمكانية إعطاء التعليمات فورياً دون الحاجة إلى أي تطبيق خارجي.',
    livePoints: [
      'تنبيهات حية مع معالجة آلية لأي مخالفة يرتكبها المتقدم',
      'تتبع مراقبة مخصص لمتقدم معين للحصول على رؤية أشمل',
      'مرونة في الاتصال تتكيف مع جودة شبكة المتقدم',
    ],
    liveCta: 'استعراض تفاصيل المراقبة الحية',
    aiTitle: 'المساعد الأكاديمي في إعداد المحتوى التعليمي',
    aiDesc: 'يرافق المعلمَ في كل مرحلة من مراحل إعداد المحتوى التعليمي، من صياغة الدروس إلى بناء الاختبارات، مع إمكانية المراجعة والتعديل الكامل قبل النشر.',
    aiPoints: [
      'إعداد درس أو اختبار متكامل في وقت قياسي',
      'مراجعة وتعديل كامل للمحتوى المولَّد قبل نشره',
      'دعم كامل للغة العربية والإنجليزية',
    ],
    aiCta: 'استعراض إمكانيات المساعد الأكاديمي',
    stepsTitle: 'كيف تبدأ في 4 خطوات',
    steps: [
      { title: 'اطلب اشتراكاً', desc: 'راسلنا عبر النموذج وأخبرنا عن جامعتك.' },
      { title: 'نجهّز بيئتك', desc: 'ننشئ بيئة معزولة خاصة بجامعتك ونسلّمك لوحة إدارتها.' },
      { title: 'ادعُ فريقك', desc: 'أضف المعلمين بروابط دعوة، وهم يدعون طلابهم لمجموعاتهم.' },
      { title: 'ابدأ التدريس', desc: 'ولّد الدروس والاختبارات، راقب، وصحّح، كله من مكان واحد.' },
    ],
    faqTitle: 'أسئلة شائعة',
    faqs: [
      { q: 'هل بيانات جامعتنا معزولة عن غيرها؟', a: 'نعم، تماماً. كل جامعة لها بيئتها المعزولة على مستوى قاعدة البيانات، فلا يرى أحد بيانات أحد.' },
      { q: 'كيف تمنعون الغش في الاختبارات عن بُعد؟', a: 'مراقبة مزدوجة: ذكاء اصطناعي يرصد المخالفات ويسجّلها، ومراقبة حية يرى فيها المعلم ويسمع كل الطلاب مباشرة أثناء الاختبار.' },
      { q: 'هل نحتاج خبرة تقنية لتشغيل المنصة؟', a: 'لا. الواجهة بسيطة لكل الأدوار، ونحن نجهّز بيئتكم ونرافقكم في البداية خطوة بخطوة.' },
      { q: 'هل يمكن توليد الدروس والاختبارات تلقائياً؟', a: 'نعم، بالذكاء الاصطناعي من ملفاتكم أو من عنوان، وكلها قابلة للمراجعة والتعديل قبل النشر.' },
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
    heroBadge: '✦ For universities & educational centers',
    heroTitle: 'A complete academic environment, from lesson to final grade',
    heroDesc: "From an AI-drafted lesson, to a live-monitored exam, to the final grade. EduQuest gives everyone running an educational operation, a university, a center, or a single classroom, one clear path.",
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
      { from: 'Remote exams with zero supervision', to: 'Live monitoring and AI protecting integrity' },
      { from: 'Hours to prepare every lesson and exam', to: 'Minutes, with AI doing the drafting' },
      { from: "Every institution's data in one basket", to: "Full isolation for each university's data" },
    ],
    statsTitle: 'Numbers that speak for the platform',
    stats: [
      { value: '4', label: 'Integrated roles', sub: 'University admin, center, teacher, student' },
      { value: 'Seconds', label: 'To generate a full lesson or exam', sub: 'AI-powered, editable before publishing' },
      { value: '100%', label: 'Data isolation between universities', sub: 'Enforced at the database level itself' },
      { value: 'Live', label: 'Exam monitoring', sub: 'Audio and video of all students at once' },
    ],
    trustTitle: 'Why EduQuest?',
    trust: [
      { icon: 'Lock', title: 'Grading on the server, not the browser', desc: "Correct answers never leave the server, so students cannot see or tamper with them, no matter what." },
      { icon: 'Clock', title: 'Exam timing decided by the server', desc: 'Start and end times are recorded on our servers, so refreshing the page or changing the device clock changes nothing.' },
      { icon: 'Archive', title: 'Safe deletion with a full archive', desc: 'Nothing is ever destroyed by mistake. Every delete goes to an archive the admin can restore anytime.' },
      { icon: 'Headphones', title: 'Full onboarding support', desc: "We set up your university's environment ourselves and guide your team step by step until everything runs smoothly." },
    ],
    teaserTitle: 'A full learning system and academic management in one platform',
    teaser: [
      { icon: 'BookOpen', title: 'Courses & structured lessons', desc: 'Build curricula with levels and units, share content with your groups instantly.' },
      { icon: 'ClipboardList', title: 'Assignments & exams', desc: 'Timed exams, auto-grading, and instant results in the grade book.' },
      { icon: 'BarChart2', title: 'Student progress tracking', desc: 'Grades and completion rates per student, clear visuals for teachers and admins.' },
      { icon: 'Zap', title: 'AI academic assistant', desc: 'An AI assistant that guides instructors step by step through lesson and exam preparation, with full review and editing before publishing.' },
      { icon: 'ShieldCheck', title: 'Live exam proctoring', desc: 'Camera and AI safeguard exam integrity, with server-side grading that cannot be tampered with.' },
      { icon: 'Building2', title: 'Complete inter-institution isolation', desc: "Each institution's data is fully isolated at the database level, with zero possibility of cross-institution data leakage." },
    ],
    allFeatures: 'Explore all features',
    liveTitle: 'Live visual access to examination rooms via video technology',
    liveDesc: 'Direct visual connection between the proctor and all candidates, with the ability to issue instructions in real time. No third-party application required.',
    livePoints: [
      'Real-time alerts with automated handling of any candidate violation',
      'Dedicated monitoring of a specific candidate for a more comprehensive view',
      'Adaptive connection quality that adjusts to each candidate\'s network conditions',
    ],
    liveCta: 'Explore live monitoring in detail',
    aiTitle: 'Academic assistant for educational content preparation',
    aiDesc: 'Accompanies instructors through every stage of content preparation, from lesson drafting to exam construction, with full review and editing capabilities before publishing.',
    aiPoints: [
      'Complete lesson or exam preparation in record time',
      'Full review and editing of generated content before publishing',
      'Comprehensive support for Arabic and English',
    ],
    aiCta: 'Explore the academic assistant\'s capabilities',
    stepsTitle: 'Get started in 4 steps',
    steps: [
      { title: 'Request access', desc: 'Message us through the form and tell us about your university.' },
      { title: 'We set you up', desc: 'We create your isolated environment and hand you its admin dashboard.' },
      { title: 'Invite your team', desc: 'Add teachers via invite links; they invite their students into groups.' },
      { title: 'Start teaching', desc: 'Generate lessons and exams, proctor, and grade, all from one place.' },
    ],
    faqTitle: 'Frequently asked questions',
    faqs: [
      { q: "Is our university's data isolated from others?", a: "Yes, completely. Each university has its own isolated environment at the database level, so no one can see anyone else's data." },
      { q: 'How do you prevent cheating in remote exams?', a: 'Dual proctoring: AI detects and logs violations, plus live monitoring where the teacher sees and hears all students in real time during the exam.' },
      { q: 'Do we need technical expertise to run it?', a: 'No. The interface is simple for every role, and we set up your environment and guide you step by step at the start.' },
      { q: 'Can lessons and exams be generated automatically?', a: 'Yes, with AI from your files or from a topic, all reviewable and editable before publishing.' },
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
  Lock, Clock, Archive, Headphones,
} as const

// Ground colours the landing page actually runs on: white, the pale blue
// surface, and the navy used by the two dark sections.
const INK_ON_LIGHT = '#0b3658'
const INK_ON_DARK  = '#ffffff'

// The banner that opens every section. Two drifting radial washes and a slow
// sheen behind a translucent tint, with a hairline of light along the top and a
// soft shadow separating it from the content below.
//
// The band carries the section's headline and nothing else. The small uppercase
// label it used to show above that headline is gone; the section colour still
// identifies the section, but through the ground and the washes rather than
// through a word. Headlines are navy on light grounds and white on dark ones,
// which is the rule the whole page follows.
function SectionBanner({
  color, title, kicker, onDark = false,
}: {
  /** Identity hue: tints the ground and the drifting washes. */
  color: string
  title: string
  kicker?: string
  /** Set on the navy sections so the headline flips to white. */
  onDark?: boolean
}) {
  const ink = onDark ? INK_ON_DARK : INK_ON_LIGHT
  return (
    <div
      className="eq-band w-full border-b"
      style={{
        background: `linear-gradient(180deg, ${color}16 0%, ${color}07 100%)`,
        borderColor: `${color}2E`,
        boxShadow: `inset 0 -1px 0 ${color}14, 0 14px 36px -26px ${color}99`,
      }}
    >
      {/* Motion field, decorative and hidden from assistive technology */}
      <span className="eq-band-orb eq-band-orb-a" style={{ background: `${color}33` }} aria-hidden="true" />
      <span className="eq-band-orb eq-band-orb-b" style={{ background: `${color}24` }} aria-hidden="true" />
      <span className="eq-band-sheen" aria-hidden="true" />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-9 sm:py-12">
        <h2
          className="text-2xl sm:text-4xl font-black tracking-tight"
          style={{ color: ink, letterSpacing: '-0.02em' }}
        >
          {title}
        </h2>
        {kicker && (
          <p
            className="mt-3 max-w-2xl text-sm sm:text-base leading-relaxed"
            style={{ color: ink, opacity: onDark ? 0.8 : 0.72 }}
          >
            {kicker}
          </p>
        )}
      </div>
    </div>
  )
}

// Each section's identity hue. It tints its banner's ground and the drifting
// washes behind the headline, so a section still reads as "the rose one" or
// "the teal one" without needing a word to say so.
const SECTION_COLORS = {
  transform:  { color: '#64748b' },
  stats:      { color: '#4E9AD9' },
  platform:   { color: '#0b3658' },
  demo:       { color: '#0b3658' },
  admin:      { color: '#4E9AD9' },
  teacher:    { color: '#2DD4BF' },
  live:       { color: '#F43F5E' },
  ai:         { color: '#7C3AED' },
  steps:      { color: '#0b3658' },
  trust:      { color: '#059669' },
  faq:        { color: '#F2B84B' },
} as const

const TEASER_ACCENTS = [
  { bg: '#e6f1fa', color: '#4e9ad9' },   // blue
  { bg: '#ede9fe', color: '#7c3aed' },   // purple
  { bg: '#d1fae5', color: '#059669' },   // green
  { bg: '#d1fae5', color: '#0d9488' },   // teal
  { bg: '#fee2e2', color: '#dc2626' },   // red
  { bg: '#e0f2fe', color: '#0369a1' },   // deep blue
]

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

// Seamless fade-in for elements entering the viewport
function useFadeIn(deps: unknown[] = []) {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>('[data-fadein]')
    if (!els.length) return
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          const el = e.target as HTMLElement
          const delay = Number(el.dataset.fadein ?? 0)
          el.style.transitionDelay = `${delay}ms`
          el.classList.add('fadein-visible')
          obs.unobserve(el)
        }
      })
    }, { threshold: 0.12 })
    els.forEach(el => obs.observe(el))
    return () => obs.disconnect()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

// Count-up for a single number stat
function useCountUp(target: string, inView: boolean) {
  const numeric = parseInt(target.replace(/\D/g, ''), 10)
  const isNumeric = !isNaN(numeric)
  const [display, setDisplay] = useState('0')
  useEffect(() => {
    if (!inView || !isNumeric) return
    const num = numeric
    let start = 0
    const step = Math.ceil(num / 40)
    const id = setInterval(() => {
      start = Math.min(start + step, num)
      setDisplay(target.replace(/\d+/, String(start)))
      if (start >= num) clearInterval(id)
    }, 30)
    return () => clearInterval(id)
  }, [inView, target, numeric, isNumeric])
  return isNumeric ? display : target
}

function StatCard({ value, label, sub }: { value: string; label: string; sub: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setInView(true); obs.disconnect() } }, { threshold: 0.5 })
    if (ref.current) obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])
  const display = useCountUp(value, inView)
  return (
    <div ref={ref} className="rounded-[20px] p-6 sm:p-8 text-center" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}>
      <p className="text-4xl sm:text-5xl font-black text-white" style={{letterSpacing: '-0.02em'}}>{display}</p>
      <p className="text-[#7ec8f0] text-sm font-semibold mt-3">{label}</p>
      <p className="text-[#5a9ec4] text-xs mt-1 leading-relaxed">{sub}</p>
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

  useFadeIn([lang])

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="min-h-screen bg-canvas">
      <PublicNav lang={lang} setLang={setLang} />
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <div className="eq-blob-1 absolute -top-24 -start-24 w-[420px] h-[420px] rounded-full blur-3xl opacity-40" style={{ background: 'radial-gradient(circle, #4E9AD9, transparent 70%)' }} />
          <div className="eq-blob-2 absolute top-32 -end-32 w-[380px] h-[380px] rounded-full blur-3xl opacity-30" style={{ background: 'radial-gradient(circle, #2DD4BF, transparent 70%)' }} />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(78,154,217,0.10),transparent)]" />
        </div>
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-28 pb-6 text-center">
          <span className="inline-block px-4 py-1.5 rounded-full bg-accent-subtle border border-accent-border text-accent text-sm font-semibold mb-6 tracking-wide">
            {t.heroBadge}
          </span>
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black leading-tight max-w-2xl mx-auto text-fg" style={{letterSpacing: '-0.03em'}}>
            EduQuest
          </h1>
          <p className="text-fg-secondary text-lg sm:text-xl mt-4 max-w-xl mx-auto font-medium leading-snug">
            {t.heroTitle}
          </p>
          <div className="mt-8">
            <Link href="/contact"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-[24px] bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-base transition-colors shadow-[0_8px_32px_rgba(78,154,217,0.30)]">
              {t.heroCta} <Arrow className="w-4 h-4" />
            </Link>
          </div>
          <div className="mt-14 sm:mt-20" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            <RoleStage roles={t.roles as Role[]} />
          </div>

          <div className="flex justify-center mt-10 pb-2">
            <ChevronDown className="w-5 h-5 text-fg-muted animate-bounce" />
          </div>
        </div>
      </section>
      <section className="bg-surface border-y border-border">
        <SectionBanner
          color={SECTION_COLORS.transform.color}
          title={t.transformTitle}
          kicker={t.transformSub}
        />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-16">

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
      <section style={{ background: 'linear-gradient(135deg, #0b3658 0%, #0e4a7a 100%)' }}>
        <SectionBanner
          color="#7ec8f0"
          title={t.statsTitle}
          onDark
        />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {t.stats.map((s, i) => (
              <StatCard key={i} value={s.value} label={s.label} sub={s.sub} />
            ))}
          </div>
        </div>
      </section>
      <section className="bg-canvas">
        <SectionBanner
          color={SECTION_COLORS.platform.color}
          title={t.teaserTitle}
        />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {t.teaser.map((f, i) => {
              const Icon = icons[f.icon as keyof typeof icons]
              const acc = TEASER_ACCENTS[i] ?? TEASER_ACCENTS[0]
              return (
                <div key={i} data-fadein={i * 80} className="group bg-white border border-border rounded-[20px] p-6 hover:shadow-[0_12px_40px_rgba(11,54,88,0.12)] transition-all duration-300 hover:-translate-y-0.5 shadow-[0_2px_8px_rgba(11,54,88,0.05)]">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: acc.bg }}>
                      <Icon className="w-5 h-5" style={{ color: acc.color }} />
                    </div>
                    <span className="text-xs font-black text-fg-muted tabular-nums">0{i + 1}</span>
                  </div>
                  <h3 className="text-fg font-bold mb-1.5">{f.title}</h3>
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

      <section className="bg-canvas overflow-hidden">
        <SectionBanner
          color={SECTION_COLORS.demo.color}
          title={lang === 'ar'
            ? 'تجربة حية لما ستتعامل معه داخل المنصة'
            : 'A live experience of what you will work with inside the platform'}
          kicker={lang === 'ar'
            ? 'لقطات توضيحية حقيقية من واجهات المنصة، دون تجميل أو حذف.'
            : 'Genuine screen recordings from the platform interfaces, unfiltered and unscripted.'}
        />
      </section>

      <section className="bg-canvas pb-0">
        <SectionBanner
          color={SECTION_COLORS.admin.color}
          title={lang === 'ar'
            ? 'إدارة المؤسسة التعليمية بالكامل من مكان واحد'
            : 'Manage the entire institution from a single place'}
        />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            <div data-fadein="0" className="rounded-[20px] overflow-hidden border border-border shadow-[0_16px_56px_rgba(11,54,88,0.12)] bg-elevated">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border" style={{ background: '#e6f1fa' }}>
                <span className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400/60" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/60" />
                <span className="text-xs font-medium ms-2" style={{ color: '#4e9ad9' }}>
                  {lang === 'ar' ? 'لوحة إدارة المؤسسة التعليمية' : 'Institution Administration Dashboard'}
                </span>
              </div>
              <video src="/demo-admin.mp4" autoPlay muted loop playsInline className="w-full block" style={{ aspectRatio: '16/9', objectFit: 'cover' }} />
            </div>
            <div data-fadein="120">
              <p className="text-fg-secondary leading-relaxed mb-6 text-base">
                {lang === 'ar'
                  ? 'لوحة إدارية شاملة تتيح للمسؤول متابعة أعضاء هيئة التدريس، إدارة صلاحياتهم، واستعراض المؤشرات الأكاديمية للمؤسسة بالكامل، دون الحاجة للتنقل بين أنظمة متعددة.'
                  : 'A comprehensive administrative panel that allows the responsible party to track faculty members, manage their permissions, and review the institution\'s academic indicators in full, without switching between multiple systems.'}
              </p>
              <ul className="space-y-3">
                {(lang === 'ar'
                  ? ['إضافة أعضاء هيئة التدريس وتعيين صلاحياتهم بدقة', 'نظرة كاملة على الأنشطة الأكاديمية للمؤسسة', 'عزل تام لبيانات المؤسسة عن أي مؤسسة أخرى']
                  : ['Add faculty members and assign their permissions precisely', 'Full view of the institution\'s academic activities', 'Complete data isolation from all other institutions']
                ).map((p, i) => (
                  <li key={i} className="flex items-start gap-3 text-fg-secondary text-sm">
                    <CheckCircle2 className="w-4 h-4 text-[#4e9ad9] shrink-0 mt-0.5" /> {p}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-surface">
        <SectionBanner
          color={SECTION_COLORS.teacher.color}
          title={lang === 'ar'
            ? 'من إعداد المحتوى إلى نشر النتائج في مسار واحد'
            : 'From content preparation to results publishing in one workflow'}
        />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            <div data-fadein="0" className="order-1 lg:order-2 rounded-[20px] overflow-hidden border border-border shadow-[0_16px_56px_rgba(11,54,88,0.12)] bg-elevated">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border" style={{ background: '#e6faf8' }}>
                <span className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400/60" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/60" />
                <span className="text-xs font-medium ms-2" style={{ color: '#0d9488' }}>
                  {lang === 'ar' ? 'لوحة عضو هيئة التدريس' : 'Instructor Dashboard'}
                </span>
              </div>
              <video src="/demo-teacher.mp4" autoPlay muted loop playsInline className="w-full block" style={{ aspectRatio: '16/9', objectFit: 'cover' }} />
            </div>
            <div data-fadein="120" className="order-2 lg:order-1">
              <p className="text-fg-secondary leading-relaxed mb-6 text-base">
                {lang === 'ar'
                  ? 'يتابع عضو هيئة التدريس مساره الأكاديمي بالكامل من لوحة واحدة: إعداد المحتوى وتصحيح الاختبارات ونشر النتائج، مع دعم الذكاء الاصطناعي في كل مرحلة.'
                  : 'Instructors manage their entire academic workflow from a single panel: content preparation, exam grading, and results publishing, with AI support at every stage.'}
              </p>
              <ul className="space-y-3">
                {(lang === 'ar'
                  ? ['تصحيح تلقائي لإجابات الطلاب مع نشر فوري للنتائج', 'مساعد ذكاء اصطناعي لإعداد الدروس والاختبارات', 'متابعة تقدم الطلاب ومؤشرات الأداء الأكاديمي']
                  : ['Automatic grading of student answers with instant results publishing', 'AI assistant for preparing lessons and exams', 'Student progress tracking and academic performance indicators']
                ).map((p, i) => (
                  <li key={i} className="flex items-start gap-3 text-fg-secondary text-sm">
                    <CheckCircle2 className="w-4 h-4 text-[#059669] shrink-0 mt-0.5" /> {p}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-canvas">
        <SectionBanner color={SECTION_COLORS.live.color} title={t.liveTitle} />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
          <div className="relative border border-border rounded-[28px] p-8 sm:p-12 bg-elevated shadow-[0_16px_64px_rgba(11,54,88,0.10)] overflow-hidden">
            <div className="absolute -top-24 -end-24 w-80 h-80 rounded-full blur-3xl opacity-15 pointer-events-none" style={{ background: 'radial-gradient(circle, #F43F5E, transparent 70%)' }} />
            <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
              <div>
                <p className="text-fg-secondary leading-relaxed mb-6 text-base">{t.liveDesc}</p>
                <ul className="space-y-3 mb-8">
                  {t.livePoints.map((p, i) => (
                    <li key={i} className="flex items-start gap-3 text-fg-secondary text-sm">
                      <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" /> {p}
                    </li>
                  ))}
                </ul>
                <Link href="/features/live-monitoring"
                  className="inline-flex items-center gap-3 px-6 py-3 rounded-[16px] bg-error text-white font-semibold text-sm hover:bg-error/90 transition-colors shadow-[0_4px_16px_rgba(239,68,68,0.30)]">
                  {t.liveCta} <Arrow className="w-4 h-4" />
                </Link>
              </div>
              <LiveProctoringGrid lang={lang} />
            </div>
          </div>
        </div>
      </section>

      <section className="bg-surface">
        <SectionBanner color={SECTION_COLORS.ai.color} title={t.aiTitle} />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
          <div className="relative border border-border rounded-[28px] p-8 sm:p-12 bg-elevated shadow-[0_16px_64px_rgba(11,54,88,0.10)] overflow-hidden">
            <div className="absolute -bottom-24 -start-24 w-80 h-80 rounded-full blur-3xl opacity-15 pointer-events-none" style={{ background: 'radial-gradient(circle, #2DD4BF, transparent 70%)' }} />
            <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
              <div className="order-2 lg:order-1">
                <AiTypingMockup lang={lang} />
              </div>
              <div className="order-1 lg:order-2">
                <p className="text-fg-secondary leading-relaxed mb-6 text-base">{t.aiDesc}</p>
                <ul className="space-y-3 mb-8">
                  {t.aiPoints.map((p, i) => (
                    <li key={i} className="flex items-start gap-3 text-fg-secondary text-sm">
                      <CheckCircle2 className="w-4 h-4 text-accent shrink-0 mt-0.5" /> {p}
                    </li>
                  ))}
                </ul>
                <Link href="/features/ai-assistant" target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-3 px-6 py-3 rounded-[16px] bg-accent text-white font-semibold text-sm hover:bg-accent-hover transition-colors shadow-[0_4px_16px_rgba(78,154,217,0.30)]">
                  {t.aiCta} <Arrow className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="bg-surface border-y border-border">
        <SectionBanner color={SECTION_COLORS.steps.color} title={t.stepsTitle} />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 relative">
            <div className="hidden lg:block absolute top-9 start-[12.5%] end-[12.5%] h-px bg-border z-0" />
            {t.steps.map((s, i) => (
              <div key={i} className="relative bg-white border border-border rounded-[20px] p-6 shadow-[0_4px_16px_rgba(11,54,88,0.06)] z-10">
                <span className="flex items-center justify-center w-10 h-10 rounded-full bg-[#0b3658] text-white font-black text-sm mb-4 shadow-[0_4px_12px_rgba(11,54,88,0.25)]">{i + 1}</span>
                <h3 className="text-fg font-bold mb-1.5">{s.title}</h3>
                <p className="text-fg-secondary text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="bg-canvas">
        <SectionBanner color={SECTION_COLORS.trust.color} title={t.trustTitle} />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {t.trust.map((item, i) => {
              const TrustIcon = icons[item.icon as keyof typeof icons] ?? ShieldCheck
              const trustAccents = [
                { bg: '#fee2e2', color: '#dc2626' },
                { bg: '#dbeafe', color: '#1d4ed8' },
                { bg: '#d1fae5', color: '#059669' },
                { bg: '#e0e7ff', color: '#4338ca' },
              ]
              const acc = trustAccents[i]
              return (
                <div key={i} className="flex items-start gap-4 bg-white border border-border rounded-[20px] p-6 hover:shadow-[0_12px_40px_rgba(11,54,88,0.10)] transition-all duration-300 shadow-[0_2px_8px_rgba(11,54,88,0.05)]">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: acc.bg }}>
                    <TrustIcon className="w-5 h-5" style={{ color: acc.color }} />
                  </div>
                  <div>
                    <h3 className="text-fg font-bold mb-1.5">{item.title}</h3>
                    <p className="text-fg-secondary text-sm leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="bg-canvas">
        <SectionBanner color={SECTION_COLORS.faq.color} title={t.faqTitle} />
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
          <div className="space-y-3">
            {t.faqs.map((f, i) => (
              <details key={i} className="group bg-white border border-border rounded-[20px] overflow-hidden shadow-[0_2px_8px_rgba(11,54,88,0.05)]">
                <summary className="flex items-center justify-between gap-4 px-6 py-5 cursor-pointer list-none text-fg font-semibold text-base">
                  {f.q}
                  <Plus className="w-5 h-5 text-fg-muted shrink-0 transition-transform group-open:rotate-45" />
                </summary>
                <p className="px-6 pb-6 -mt-1 text-fg-secondary text-base leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
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
