import { DemoCard } from '@/components/demo/demo-shell'
import { demoStudents } from '@/lib/demo/data'

export default function DemoAdminStudents() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">الطلاب</h2>
      <DemoCard title="عيّنة من الطلاب">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-end">
            <thead>
              <tr className="text-slate-400 border-b border-slate-800">
                <th className="py-2 font-medium">الاسم</th>
                <th className="py-2 font-medium">المجموعة</th>
                <th className="py-2 font-medium">المعدل</th>
              </tr>
            </thead>
            <tbody>
              {demoStudents.map((s) => (
                <tr key={s.id} className="border-b border-slate-800/60">
                  <td className="py-3 text-white">{s.name}</td>
                  <td className="py-3 text-slate-400">{s.group}</td>
                  <td className="py-3 text-emerald-400">{s.avgGrade}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DemoCard>
    </div>
  )
}
