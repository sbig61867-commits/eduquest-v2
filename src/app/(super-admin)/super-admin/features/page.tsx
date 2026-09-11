'use client'
export const dynamic = 'force-dynamic'
import { useState } from 'react'
import { Flag } from 'lucide-react'

const DEFAULT_FLAGS = [
  { name: 'ai_lesson_generation', label: 'AI Lesson Generation', description: 'Allow teachers to generate lessons with Gemini AI' },
  { name: 'proctoring', label: 'Exam Proctoring', description: 'Enable camera/mic proctoring during exams' },
  { name: 'file_uploads', label: 'File Uploads', description: 'Allow video, audio, and PDF uploads' },
  { name: 'realtime_updates', label: 'Realtime Updates', description: 'Live updates via Supabase Realtime' },
]

export default function FeaturesPage() {
  const [flags, setFlags] = useState<Record<string, boolean>>({
    ai_lesson_generation: true,
    proctoring: true,
    file_uploads: true,
    realtime_updates: true,
  })

  function toggle(name: string) {
    setFlags(prev => ({ ...prev, [name]: !prev[name] }))
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-fg">Feature Flags</h2>
        <p className="text-fg-secondary mt-1">Enable or disable platform features globally</p>
      </div>
      <div className="space-y-3">
        {DEFAULT_FLAGS.map(flag => (
          <div key={flag.name} className="bg-surface border border-border rounded-lg p-5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-accent-subtle flex items-center justify-center">
                <Flag className="w-5 h-5 text-accent" />
              </div>
              <div>
                <p className="text-fg font-medium">{flag.label}</p>
                <p className="text-fg-secondary text-sm">{flag.description}</p>
              </div>
            </div>
            <button
              onClick={() => toggle(flag.name)}
              className={`relative w-12 h-6 rounded-full transition-colors focus:outline-none ${flags[flag.name] ? 'bg-accent' : 'bg-border-strong'}`}
            >
              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${flags[flag.name] ? 'translate-x-7' : 'translate-x-1'}`} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
