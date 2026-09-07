export const dynamic = 'force-dynamic'
import { ShieldCheck } from 'lucide-react'

export default function AuditPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-fg">Audit Logs</h2>
        <p className="text-fg-secondary mt-1">Track all system activity</p>
      </div>
      <div className="text-center py-20 bg-surface border border-border rounded-lg">
        <ShieldCheck className="w-12 h-12 text-fg-muted mx-auto mb-3" />
        <p className="text-fg-secondary">Audit logging coming soon.</p>
      </div>
    </div>
  )
}
