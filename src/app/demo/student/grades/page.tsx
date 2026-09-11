import { DemoCard } from '@/components/demo/demo-shell'
import { demoGrades } from '@/lib/demo/data'

export default function DemoStudentGrades() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">علاماتي</h2>
      <DemoCard title="سجل العلامات">
        <ul className="space-y-3">
          {demoGrades.map((g) => (
            <li key={g.exam} className="flex items-center justify-between">
              <span className="text-white text-sm">{g.exam}</span>
              <span className="text-emerald-400 text-sm font-semibold">{g.score} / {g.outOf}</span>
            </li>
          ))}
        </ul>
      </DemoCard>
    </div>
  )
}
