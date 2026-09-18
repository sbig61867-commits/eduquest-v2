'use client'
export const dynamic = 'force-dynamic'
import { useState } from 'react'
import { Flag } from 'lucide-react'

const DEFAULT_FLAGS = [
  { name: 'ai_lesson_generation', label: 'توليد الدروس بالذكاء الاصطناعي', description: 'السماح للمعلمين بتوليد الدروس عبر Gemini' },
  { name: 'proctoring', label: 'مراقبة الاختبارات', description: 'تفعيل مراقبة الكاميرا والميكروفون أثناء الاختبارات' },
  { name: 'file_uploads', label: 'رفع الملفات', description: 'السماح برفع الفيديو والصوت وملفات PDF' },
  { name: 'realtime_updates', label: 'التحديثات الفورية', description: 'تحديثات مباشرة عبر Supabase Realtime' },
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
        <h2 className="text-2xl font-bold text-white">مفاتيح المزايا</h2>
        <p className="text-slate-400 mt-1">فعّل أو عطّل مزايا المنصة عالمياً</p>
      </div>
      <div className="space-y-3">
        {DEFAULT_FLAGS.map(flag => (
          <div key={flag.name} className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <Flag className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <p className="text-white font-medium">{flag.label}</p>
                <p className="text-slate-400 text-sm">{flag.description}</p>
              </div>
            </div>
            <button
              onClick={() => toggle(flag.name)}
              className={`relative w-12 h-6 rounded-full transition-colors focus:outline-none ${flags[flag.name] ? 'bg-blue-600' : 'bg-slate-700'}`}
            >
              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${flags[flag.name] ? 'translate-x-7' : 'translate-x-1'}`} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
