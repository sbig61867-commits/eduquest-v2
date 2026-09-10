export const dynamic = 'force-dynamic'
import { ShieldCheck } from 'lucide-react'

export default function AuditPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Audit Logs</h2>
        <p className="text-slate-400 mt-1">Track all system activity</p>
      </div>
      <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
        <ShieldCheck className="w-12 h-12 text-slate-600 mx-auto mb-3" />
        <p className="text-slate-400">Audit logging coming soon.</p>
      </div>
    </div>
  )
}
