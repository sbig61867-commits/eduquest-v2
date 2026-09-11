import { DemoCard } from '@/components/demo/demo-shell'
import { demoAnnouncements } from '@/lib/demo/data'

export default function DemoCenterAnnouncements() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">الإعلانات</h2>
      <DemoCard title="الإعلانات المنشورة">
        <ul className="space-y-4">
          {demoAnnouncements.map((a) => (
            <li key={a.id}>
              <p className="text-white text-sm font-medium">{a.title}</p>
              <p className="text-slate-400 text-sm">{a.body}</p>
              <p className="text-slate-500 text-xs mt-1">{a.date}</p>
            </li>
          ))}
        </ul>
      </DemoCard>
    </div>
  )
}
