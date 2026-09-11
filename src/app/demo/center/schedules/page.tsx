import { DemoCard } from '@/components/demo/demo-shell'
import { demoSchedule } from '@/lib/demo/data'

export default function DemoCenterSchedules() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">الجداول الأسبوعية</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {demoSchedule.map((d) => (
          <DemoCard key={d.day} title={d.day}>
            <ul className="space-y-2">
              {d.slots.map((s) => (
                <li key={s} className="text-slate-300 text-sm">{s}</li>
              ))}
            </ul>
          </DemoCard>
        ))}
      </div>
    </div>
  )
}
