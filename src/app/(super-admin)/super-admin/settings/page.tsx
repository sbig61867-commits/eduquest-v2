export const dynamic = 'force-dynamic'
import { Settings } from 'lucide-react'

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Platform Settings</h2>
        <p className="text-slate-400 mt-1">Global configuration</p>
      </div>
      <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
        <Settings className="w-12 h-12 text-slate-600 mx-auto mb-3" />
        <p className="text-slate-400">Settings panel coming soon.</p>
      </div>
    </div>
  )
}
