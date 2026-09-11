'use client'

import { CalendarDays, Bell, Inbox } from 'lucide-react'
import { DemoStatCard, DemoCard } from '@/components/demo/demo-shell'
import { demoRequests } from '@/lib/demo/data'

export default function DemoCenterDashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">لوحة تحكم مركز التعليم المستمر</h2>
        <p className="text-slate-400 mt-1">نظرة عامة</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <DemoStatCard label="جداول نشطة" value={4} icon={CalendarDays} color="text-blue-400" bg="bg-blue-500/10" />
        <DemoStatCard label="إعلانات" value={2} icon={Bell} color="text-amber-400" bg="bg-amber-500/10" />
        <DemoStatCard label="طلبات مفتوحة" value={demoRequests.length} icon={Inbox} color="text-violet-400" bg="bg-violet-500/10" />
      </div>

      <DemoCard title="الطلبات">
        <ul className="space-y-3">
          {demoRequests.map((r) => (
            <li key={r.id} className="flex items-center justify-between">
              <div>
                <p className="text-white text-sm font-medium">{r.subject}</p>
                <p className="text-slate-500 text-xs">{r.from}</p>
              </div>
              <span className="text-xs text-slate-400">{r.status}</span>
            </li>
          ))}
        </ul>
      </DemoCard>
    </div>
  )
}
