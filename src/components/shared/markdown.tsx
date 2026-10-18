import React from 'react'
import { normalizeTransliterations } from '@/lib/ai/arabic-transliteration'

// Minimal dependency-free Markdown renderer (headings, lists, bold/italic,
// inline code, fenced code blocks, blockquotes, hr). Outputs React elements —
// no dangerouslySetInnerHTML, so lesson content can never inject HTML/JS.
//
// Every block is dir="auto" (2026-10-17): a language lesson mixes French or
// English lines with their Arabic translation, and each line must align by
// its own language (its first strong letter), not by the page's direction.

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
  // Lessons generated before 2026-10-17 may still spell a pronunciation with
  // Persian letters ("Rouge (...)"); fixed when shown too, not only at generation.
  const lines = normalizeTransliterations(content).replace(/\r\n/g, '\n').split('\n')
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

  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]
    if (codeLines !== null) {
      if (line.trim().startsWith('```')) {
        blocks.push(<pre key={key++} className="my-3 p-3 rounded-lg bg-slate-950 border border-slate-800 overflow-x-auto text-sm text-slate-300"><code>{codeLines.join('\n')}</code></pre>)
        codeLines = null
      } else codeLines.push(line)
      continue
    }
    if (line.trim().startsWith('```')) { flushList(); codeLines = []; continue }

    // | a | b | tables (lesson sources are full of them); the |---| row is the header rule.
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushList()
      const rows: string[][] = []
      while (n < lines.length && /^\s*\|.*\|\s*$/.test(lines[n])) {
        const cells = lines[n].trim().slice(1, -1).split('|').map(c => c.trim())
        if (!cells.every(c => /^:?-{2,}:?$/.test(c))) rows.push(cells)
        n++
      }
      n--
      const [head, ...body] = rows
      blocks.push(
        <div key={key++} className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-start">
            <thead><tr>{head.map((c, i) => <th key={i} dir="auto" className="border border-line-strong bg-elevated px-3 py-2 text-start font-semibold text-fg">{renderInline(c, `th${key}-${i}`)}</th>)}</tr></thead>
            <tbody>{body.map((r, j) => <tr key={j}>{r.map((c, i) => <td key={i} dir="auto" className="border border-line px-3 py-2 align-top">{renderInline(c, `td${key}-${j}-${i}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      )
      continue
    }
    const h = line.match(/^(#{1,6})\s+(.*)/)
    if (h) {
      flushList()
      const level = h[1].length
      const sizes = ['text-2xl', 'text-xl', 'text-lg', 'text-base', 'text-base', 'text-sm']
      const Tag = (`h${Math.min(level, 6)}`) as keyof React.JSX.IntrinsicElements
      blocks.push(<Tag key={key++} dir="auto" className={`${sizes[level - 1]} font-bold text-white mt-5 mb-2`}>{renderInline(h[2], `h${key}`)}</Tag>)
      continue
    }
    const li = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)/)
    if (li) {
      const isOrdered = /^\d/.test(li[1])
      if (listItems.length > 0 && isOrdered !== ordered) flushList()
      ordered = isOrdered
      listItems.push(<li key={key++} dir="auto">{renderInline(li[2], `li${key}`)}</li>)
      continue
    }
    flushList()
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { blocks.push(<hr key={key++} className="my-4 border-slate-800" />); continue }
    const bq = line.match(/^>\s?(.*)/)
    if (bq) { blocks.push(<blockquote key={key++} dir="auto" className="my-2 ps-3 border-s-2 border-blue-500/50 text-slate-400 italic">{renderInline(bq[1], `q${key}`)}</blockquote>); continue }
    if (line.trim() === '') continue
    blocks.push(<p key={key++} dir="auto" className="my-2 leading-relaxed">{renderInline(line, `p${key}`)}</p>)
  }
  flushList()
  if (codeLines !== null) blocks.push(<pre key={key++} className="my-3 p-3 rounded-lg bg-slate-950 border border-slate-800 overflow-x-auto text-sm text-slate-300"><code>{codeLines.join('\n')}</code></pre>)

  return <div className={className ?? 'text-slate-300 text-sm'}>{blocks}</div>
}
