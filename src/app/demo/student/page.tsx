'use client'

import { BookOpen, ClipboardList, GraduationCap } from 'lucide-react'
import { DemoStatCard, DemoCard } from '@/components/demo/demo-shell'
import { demoAnnouncements } from '@/lib/demo/data'

export default function DemoStudentDashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">لوحة تحكم الطالب</h2>
        <p className="text-slate-400 mt-1">مرحبًا يزن العبدالله</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <DemoStatCard label="الكورسات المسجلة" value={3} icon={BookOpen} color="text-blue-400" bg="bg-blue-500/10" />
        <DemoStatCard label="اختبارات قادمة" value={2} icon={ClipboardList} color="text-amber-400" bg="bg-amber-500/10" />
        <DemoStatCard label="المعدل العام" value="88%" icon={GraduationCap} color="text-emerald-400" bg="bg-emerald-500/10" />
      </div>

      <DemoCard title="آخر الإعلانات">
        <ul className="space-y-3">
          {demoAnnouncements.map((a) => (
            <li key={a.id}>
              <p className="text-white text-sm font-medium">{a.title}</p>
              <p className="text-slate-400 text-sm">{a.body}</p>
              <p className="text-slate-500 text-xs mt-1">{a.date}</p>
            </li>
          ))}
        </ul>
      </DemoCard>
    </div>
  )
}
