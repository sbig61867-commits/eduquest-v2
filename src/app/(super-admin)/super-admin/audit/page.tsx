export const dynamic = 'force-dynamic'
import { ShieldCheck } from 'lucide-react'
import { PageTitle } from '@/components/shared/page-title'

export default function AuditPage() {
  return (
    <>
    <PageTitle title="Audit Logs" />
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="mb-7">
        <h1 className="text-xl font-semibold text-fg">Audit Logs</h1>
        <p className="text-fg-secondary mt-1">Track all system activity</p>
      </div>
      <div className="text-center py-20 bg-surface border border-border rounded-lg">
        <ShieldCheck className="w-12 h-12 text-fg-muted mx-auto mb-3" />
        <p className="text-fg-secondary">Audit logging coming soon.</p>
      </div>
    </div>
    </>
  )
}
