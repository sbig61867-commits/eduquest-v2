import { ShieldAlert } from 'lucide-react'

export function NoPermission({ label }: { label: string }) {
  return (
    <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl" dir="rtl">
      <ShieldAlert className="w-12 h-12 text-slate-600 mx-auto mb-3" />
      <p className="text-slate-400">لا تملك صلاحية {label}.</p>
      <p className="text-slate-500 text-sm mt-1">يمكن لمدير المؤسسة تفعيل هذه الصلاحية لحسابك.</p>
    </div>
  )
}
