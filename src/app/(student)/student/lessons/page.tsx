export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { BookOpen } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'

export default async function StudentLessonsPage() {
  const supabase = await createClient()
  const { data: lessons } = await supabase
    .from('lessons')
    .select('*, groups(name)')
    .eq('is_published', true)
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">My Lessons</h2>
        <p className="text-slate-400 mt-1">{lessons?.length ?? 0} lessons available</p>
      </div>

      {!lessons?.length ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <BookOpen className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No lessons available yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {lessons.map(lesson => (
            <details key={lesson.id} className="group bg-slate-900 border border-slate-800 rounded-xl overflow-hidden hover:border-slate-700 transition-colors">
              <summary className="flex items-center justify-between p-5 cursor-pointer list-none">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-600/20 flex items-center justify-center shrink-0">
                    <BookOpen className="w-4 h-4 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold">{lesson.title}</h3>
                    <p className="text-slate-400 text-sm">{(lesson as any).groups?.name ?? '—'} · {formatDate(lesson.created_at)}</p>
                  </div>
                </div>
                <span className="text-slate-500 text-sm group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="px-5 pb-5 border-t border-slate-800 pt-4">
                <div className="prose prose-invert prose-sm max-w-none">
                  <pre className="whitespace-pre-wrap text-slate-300 text-sm leading-relaxed font-sans">{lesson.content}</pre>
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}
