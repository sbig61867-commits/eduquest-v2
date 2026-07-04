'use client'

import { useState } from 'react'
import { Markdown } from '@/components/shared/markdown'

// Renders lesson Markdown as tabs, one per top-level `## ` section.
// AI-generated lessons use `## ` headings as section boundaries (vocabulary,
// grammar, quiz, …). Content with fewer than 2 sections falls back to the
// plain Markdown view, so old lessons render unchanged.

interface Section { title: string; body: string }

function splitSections(content: string): { preamble: string; sections: Section[] } {
  const lines = content.split('\n')
  const sections: Section[] = []
  let preamble: string[] = []
  let current: Section | null = null
  let inCode = false

  for (const line of lines) {
    if (/^```/.test(line.trim())) inCode = !inCode
    const m = !inCode && line.match(/^##\s+(.+)$/)
    if (m) {
      if (current) sections.push(current)
      current = { title: m[1].replace(/[#*_`]/g, '').trim(), body: '' }
    } else if (current) {
      current.body += line + '\n'
    } else {
      preamble.push(line)
    }
  }
  if (current) sections.push(current)
  return { preamble: preamble.join('\n').trim(), sections }
}

export function LessonTabs({ content }: { content: string }) {
  const { preamble, sections } = splitSections(content)
  const [active, setActive] = useState(0)

  if (sections.length < 2) return <Markdown content={content} />

  return (
    <div className="space-y-4">
      {preamble && <Markdown content={preamble} />}
      <div className="flex flex-wrap gap-2 border-b border-slate-700 pb-2" role="tablist">
        {sections.map((s, i) => (
          <button
            key={i}
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              i === active
                ? 'bg-violet-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
          >
            {s.title}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        <Markdown content={sections[active].body} />
      </div>
    </div>
  )
}
