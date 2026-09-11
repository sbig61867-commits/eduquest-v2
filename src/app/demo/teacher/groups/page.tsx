import { DemoCard } from '@/components/demo/demo-shell'
import { demoStudents } from '@/lib/demo/data'

const groups = [
  { name: 'برمجة - A', count: 24 },
  { name: 'برمجة - B', count: 22 },
  { name: 'ذكاء اصطناعي - A', count: 28 },
]

export default function DemoTeacherGroups() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">المجموعات</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {groups.map((g) => (
          <DemoCard key={g.name} title={g.name}>
            <p className="text-slate-400 text-sm">{g.count} طالب</p>
          </DemoCard>
        ))}
      </div>
      <DemoCard title="عيّنة من الطلاب">
        <ul className="space-y-3">
          {demoStudents.map((s) => (
            <li key={s.id} className="flex items-center justify-between">
              <span className="text-white text-sm">{s.name}</span>
              <span className="text-slate-400 text-sm">{s.group}</span>
            </li>
          ))}
        </ul>
      </DemoCard>
    </div>
  )
}
