'use client'

import { GraduationCap, Users, BookOpen, ClipboardList } from 'lucide-react'
import { DemoStatCard, DemoCard } from '@/components/demo/demo-shell'
import { demoStats, demoCourses } from '@/lib/demo/data'

export default function DemoAdminDashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">لوحة تحكم المؤسسة</h2>
        <p className="text-slate-400 mt-1">نظرة عامة على مؤسستك</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <DemoStatCard label="المعلمون" value={demoStats.teachers} icon={GraduationCap} color="text-blue-400" bg="bg-blue-500/10" />
        <DemoStatCard label="الطلاب" value={demoStats.students} icon={Users} color="text-emerald-400" bg="bg-emerald-500/10" />
        <DemoStatCard label="الكورسات" value={demoStats.courses} icon={BookOpen} color="text-violet-400" bg="bg-violet-500/10" />
        <DemoStatCard label="الاختبارات" value={demoStats.exams} icon={ClipboardList} color="text-amber-400" bg="bg-amber-500/10" />
      </div>

      <DemoCard title="أحدث الكورسات">
        <ul className="space-y-3">
          {demoCourses.map((c) => (
            <li key={c.id} className="flex items-center justify-between">
              <div>
                <p className="text-white text-sm font-medium">{c.title}</p>
                <p className="text-slate-500 text-xs">{c.level} · {c.units} وحدات</p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${c.published ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
                {c.published ? 'منشور' : 'مسودة'}
              </span>
            </li>
          ))}
        </ul>
      </DemoCard>
    </div>
  )
}
