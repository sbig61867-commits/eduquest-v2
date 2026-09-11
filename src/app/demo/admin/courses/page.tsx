import { DemoCard } from '@/components/demo/demo-shell'
import { demoCourses } from '@/lib/demo/data'

export default function DemoAdminCourses() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">الكورسات</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {demoCourses.map((c) => (
          <DemoCard key={c.id} title={c.title}>
            <p className="text-slate-400 text-sm mb-2">{c.level} · {c.units} وحدات</p>
            <span className={`text-xs px-2 py-1 rounded-full ${c.published ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
              {c.published ? 'منشور' : 'مسودة'}
            </span>
          </DemoCard>
        ))}
      </div>
    </div>
  )
}
