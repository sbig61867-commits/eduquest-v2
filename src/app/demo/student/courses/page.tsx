import { DemoCard } from '@/components/demo/demo-shell'
import { demoCourses } from '@/lib/demo/data'

export default function DemoStudentCourses() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">كورساتي</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {demoCourses.filter(c => c.published).map((c) => (
          <DemoCard key={c.id} title={c.title}>
            <p className="text-slate-400 text-sm mb-3">{c.level} · {c.units} وحدات</p>
            <div className="w-full bg-slate-800 rounded-full h-2">
              <div className="bg-blue-600 h-2 rounded-full" style={{ width: '62%' }} />
            </div>
            <p className="text-slate-500 text-xs mt-1">62% مكتمل</p>
          </DemoCard>
        ))}
      </div>
    </div>
  )
}
