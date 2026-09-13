import type { Metadata } from 'next'
import Link from 'next/link'
import { GraduationCap, Users, ShieldCheck, Building2 } from 'lucide-react'

export const metadata: Metadata = {
  title: 'العرض التجريبي — EduQuest',
  description: 'تصفّح منصة EduQuest بأربعة أدوار ببيانات وهمية وبدون تسجيل دخول. EduQuest interactive demo.',
}

const roles = [
  { href: '/demo/admin', label: 'مدير الجامعة', desc: 'إدارة المعلمين، الطلاب، الكورسات والطلبات', icon: ShieldCheck, color: 'text-blue-400', bg: 'bg-blue-500/10' },
  { href: '/demo/teacher', label: 'المعلم', desc: 'إدارة المجموعات، الدروس والاختبارات', icon: GraduationCap, color: 'text-violet-400', bg: 'bg-violet-500/10' },
  { href: '/demo/student', label: 'الطالب', desc: 'الكورسات، الاختبارات والعلامات', icon: Users, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  { href: '/demo/center', label: 'مدير مركز التعليم المستمر', desc: 'الجداول والإعلانات', icon: Building2, color: 'text-amber-400', bg: 'bg-amber-500/10' },
]

export default function DemoLanding() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6" dir="rtl">
      <div className="max-w-3xl w-full text-center">
        <h1 className="text-3xl font-bold text-white mb-3">جرّب EduQuest بنفسك</h1>
        <p className="text-slate-400 mb-10">اختر دورًا لتتصفح المنصة ببيانات وهمية — بدون تسجيل دخول</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {roles.map((r) => {
            const Icon = r.icon
            return (
              <Link
                key={r.href}
                href={r.href}
                className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-right hover:border-blue-600 transition-colors"
              >
                <div className={`w-11 h-11 rounded-lg ${r.bg} flex items-center justify-center mb-4`}>
                  <Icon className={`w-6 h-6 ${r.color}`} />
                </div>
                <h2 className="text-white font-semibold mb-1">{r.label}</h2>
                <p className="text-slate-400 text-sm">{r.desc}</p>
              </Link>
            )
          })}
        </div>

        <p className="text-slate-500 text-sm mt-10">
          مقتنع؟ <Link href="/contact" className="text-blue-400 hover:underline">تواصل معنا</Link> لتفعيل المنصة لجامعتك أو مركزك.
        </p>
      </div>
    </div>
  )
}
