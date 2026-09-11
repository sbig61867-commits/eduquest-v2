import { DemoCard } from '@/components/demo/demo-shell'
import { demoExams } from '@/lib/demo/data'

export default function DemoStudentExams() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">اختباراتي</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {demoExams.map((e) => (
          <DemoCard key={e.id} title={e.title}>
            <p className="text-slate-400 text-sm">التاريخ: {e.date}</p>
            <p className="text-slate-400 text-sm mb-3">المدة: {e.duration} دقيقة</p>
            <button className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white">دخول الاختبار</button>
          </DemoCard>
        ))}
      </div>
    </div>
  )
}
