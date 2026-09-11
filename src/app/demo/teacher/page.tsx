'use client'

import { Users, ClipboardList, BookOpen } from 'lucide-react'
import { DemoStatCard, DemoCard } from '@/components/demo/demo-shell'
import { demoExams } from '@/lib/demo/data'

export default function DemoTeacherDashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">لوحة تحكم المعلم</h2>
        <p className="text-slate-400 mt-1">مرحبًا د. سامر الحوراني</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <DemoStatCard label="مجموعاتي" value={3} icon={Users} color="text-blue-400" bg="bg-blue-500/10" />
        <DemoStatCard label="دروسي المنشورة" value={12} icon={BookOpen} color="text-violet-400" bg="bg-violet-500/10" />
        <DemoStatCard label="اختباراتي" value={demoExams.length} icon={ClipboardList} color="text-amber-400" bg="bg-amber-500/10" />
      </div>

      <DemoCard title="الاختبارات القادمة">
        <ul className="space-y-3">
          {demoExams.map((e) => (
            <li key={e.id} className="flex items-center justify-between">
              <div>
                <p className="text-white text-sm font-medium">{e.title}</p>
                <p className="text-slate-500 text-xs">{e.date} · {e.duration} دقيقة</p>
              </div>
              <span className="text-xs text-slate-400">{e.submissions} تسليم</span>
            </li>
          ))}
        </ul>
      </DemoCard>
    </div>
  )
}
