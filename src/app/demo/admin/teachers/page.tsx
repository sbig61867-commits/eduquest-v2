import { DemoCard } from '@/components/demo/demo-shell'
import { demoTeachers } from '@/lib/demo/data'

export default function DemoAdminTeachers() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">المعلمون</h2>
      <DemoCard title={`${demoTeachers.length} معلمين`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-end">
            <thead>
              <tr className="text-slate-400 border-b border-slate-800">
                <th className="py-2 font-medium">الاسم</th>
                <th className="py-2 font-medium">المادة</th>
                <th className="py-2 font-medium">المجموعات</th>
                <th className="py-2 font-medium">الطلاب</th>
              </tr>
            </thead>
            <tbody>
              {demoTeachers.map((t) => (
                <tr key={t.id} className="border-b border-slate-800/60">
                  <td className="py-3 text-white">{t.name}</td>
                  <td className="py-3 text-slate-400">{t.subject}</td>
                  <td className="py-3 text-slate-400">{t.groups}</td>
                  <td className="py-3 text-slate-400">{t.students}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DemoCard>
    </div>
  )
}
