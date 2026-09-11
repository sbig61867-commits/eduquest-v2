import { DemoCard } from '@/components/demo/demo-shell'
import { demoExams } from '@/lib/demo/data'

export default function DemoTeacherExams() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">الاختبارات</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {demoExams.map((e) => (
          <DemoCard key={e.id} title={e.title}>
            <p className="text-slate-400 text-sm">التاريخ: {e.date}</p>
            <p className="text-slate-400 text-sm">المدة: {e.duration} دقيقة</p>
            <p className="text-slate-400 text-sm">التسليمات: {e.submissions}</p>
          </DemoCard>
        ))}
      </div>
    </div>
  )
}
