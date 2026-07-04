import React from 'react'

// Minimal dependency-free Markdown renderer (headings, lists, bold/italic,
// inline code, fenced code blocks, blockquotes, hr). Outputs React elements —
// no dangerouslySetInnerHTML, so lesson content can never inject HTML/JS.

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  // highlight → bold → italic → inline code
  // ==text== renders as a green highlight — used for the correct answer
  // inside worked examples (e.g. "There ==is== a car.").
  const pattern = /(==(.+?)==|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    if (m[2] !== undefined) nodes.push(<mark key={`${keyPrefix}-hl${i}`} className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-semibold">{m[2]}</mark>)
    else if (m[3] !== undefined) nodes.push(<strong key={`${keyPrefix}-b${i}`}>{m[3]}</strong>)
    else if (m[4] !== undefined) nodes.push(<em key={`${keyPrefix}-i${i}`}>{m[4]}</em>)
    else if (m[5] !== undefined) nodes.push(<code key={`${keyPrefix}-c${i}`} className="px-1 py-0.5 rounded bg-slate-800 text-blue-300 text-[0.85em]">{m[5]}</code>)
    last = m.index + m[0].length
    i++
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export function Markdown({ content, className }: { content: string; className?: string }) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: React.ReactNode[] = []
  let listItems: React.ReactNode[] = []
  let ordered = false
  let codeLines: string[] | null = null
  let key = 0

  const flushList = () => {
    if (listItems.length === 0) return
    const cls = 'my-2 space-y-1 ps-6 ' + (ordered ? 'list-decimal' : 'list-disc')
    blocks.push(ordered
      ? <ol key={key++} className={cls}>{listItems}</ol>
      : <ul key={key++} className={cls}>{listItems}</ul>)
    listItems = []
  }

  for (const line of lines) {
    if (codeLines !== null) {
      if (line.trim().startsWith('```')) {
        blocks.push(<pre key={key++} className="my-3 p-3 rounded-lg bg-slate-950 border border-slate-800 overflow-x-auto text-sm text-slate-300"><code>{codeLines.join('\n')}</code></pre>)
        codeLines = null
      } else codeLines.push(line)
      continue
    }
    if (line.trim().startsWith('```')) { flushList(); codeLines = []; continue }

    const h = line.match(/^(#{1,6})\s+(.*)/)
    if (h) {
      flushList()
      const level = h[1].length
      const sizes = ['text-2xl', 'text-xl', 'text-lg', 'text-base', 'text-base', 'text-sm']
      const Tag = (`h${Math.min(level, 6)}`) as keyof React.JSX.IntrinsicElements
      blocks.push(<Tag key={key++} className={`${sizes[level - 1]} font-bold text-white mt-5 mb-2`}>{renderInline(h[2], `h${key}`)}</Tag>)
      continue
    }
    const li = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)/)
    if (li) {
      const isOrdered = /^\d/.test(li[1])
      if (listItems.length > 0 && isOrdered !== ordered) flushList()
      ordered = isOrdered
      listItems.push(<li key={key++}>{renderInline(li[2], `li${key}`)}</li>)
      continue
    }
    flushList()
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { blocks.push(<hr key={key++} className="my-4 border-slate-800" />); continue }
    const bq = line.match(/^>\s?(.*)/)
    if (bq) { blocks.push(<blockquote key={key++} className="my-2 ps-3 border-s-2 border-blue-500/50 text-slate-400 italic">{renderInline(bq[1], `q${key}`)}</blockquote>); continue }
    if (line.trim() === '') continue
    blocks.push(<p key={key++} className="my-2 leading-relaxed">{renderInline(line, `p${key}`)}</p>)
  }
  flushList()
  if (codeLines !== null) blocks.push(<pre key={key++} className="my-3 p-3 rounded-lg bg-slate-950 border border-slate-800 overflow-x-auto text-sm text-slate-300"><code>{codeLines.join('\n')}</code></pre>)

  return <div className={className ?? 'text-slate-300 text-sm'}>{blocks}</div>
}
