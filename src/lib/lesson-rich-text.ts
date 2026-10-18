// The teacher's rich-text field ⇄ the lesson's Markdown subset (2026-10-18).
//
// Lessons stay stored exactly as before: JSON blocks whose text is the Markdown
// subset src/components/shared/markdown.tsx renders (no HTML, ever). The editor
// works on a small ProseMirror document; these two pure functions convert
// between the two, and support only what the renderer shows:
//   paragraph · heading (#..###) · bullet list · numbered list · quote
//   bold **x** · italic *x* · highlight ==x== · code `x`
// Anything else (tables, code fences) keeps the plain editor: see richTextFits().

export interface PMMark { type: 'bold' | 'italic' | 'highlight' | 'code' }
export interface PMText { type: 'text'; text: string; marks?: PMMark[] }
export interface PMNode {
  type: 'doc' | 'paragraph' | 'heading' | 'bulletList' | 'orderedList' | 'listItem' | 'blockquote'
  attrs?: { level?: number }
  content?: (PMNode | PMText)[]
}

/** Text the rich field can edit without losing anything. */
export function richTextFits(md: string): boolean {
  return !/^\s*```/m.test(md) && !/^\s*\|.*\|\s*$/m.test(md)
}

const INLINE = /(==(.+?)==|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g

function inline(text: string): PMText[] {
  const out: PMText[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push({ type: 'text', text: text.slice(last, m.index) })
    const [mark, value]: [PMMark['type'], string] =
      m[2] !== undefined ? ['highlight', m[2]] : m[3] !== undefined ? ['bold', m[3]] : m[4] !== undefined ? ['italic', m[4]] : ['code', m[5]]
    out.push({ type: 'text', text: value, marks: [{ type: mark }] })
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
  return out.filter(n => n.text.length > 0)
}

const para = (text: string): PMNode => {
  const content = inline(text)
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
}

/** Markdown subset → editor document. */
export function markdownToRich(md: string): PMNode {
  const content: PMNode[] = []
  let list: PMNode | null = null
  for (const raw of md.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    const li = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/)
    if (li) {
      const type = /^\d/.test(li[1]) ? 'orderedList' : 'bulletList'
      if (!list || list.type !== type) { list = { type, content: [] }; content.push(list) }
      list.content!.push({ type: 'listItem', content: [para(li[2])] })
      continue
    }
    list = null
    if (!line.trim()) continue
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) { content.push({ type: 'heading', attrs: { level: Math.min(h[1].length, 3) }, content: inline(h[2]) }); continue }
    const q = line.match(/^>\s?(.*)$/)
    if (q) { content.push({ type: 'blockquote', content: [para(q[1])] }); continue }
    content.push(para(line))
  }
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}

function inlineToMd(nodes: (PMNode | PMText)[] | undefined): string {
  return (nodes ?? []).map(n => {
    if (n.type !== 'text') return inlineToMd((n as PMNode).content)
    const t = n as PMText
    const marks = new Set((t.marks ?? []).map(m => m.type))
    if (!t.text.trim()) return t.text
    // Keep surrounding spaces outside the markers, or the renderer misses them.
    const lead = t.text.match(/^\s*/)![0]
    const trail = t.text.match(/\s*$/)![0]
    let core = t.text.trim()
    if (marks.has('code')) return `${lead}\`${core}\`${trail}`
    if (marks.has('italic')) core = `*${core}*`
    if (marks.has('bold')) core = `**${core}**`
    if (marks.has('highlight')) core = `==${core}==`
    return `${lead}${core}${trail}`
  }).join('')
}

/** Editor document → Markdown subset (what is stored). */
export function richToMarkdown(doc: PMNode): string {
  const lines: string[] = []
  const blank = () => { if (lines.length && lines[lines.length - 1] !== '') lines.push('') }
  for (const node of (doc.content ?? []) as PMNode[]) {
    switch (node.type) {
      case 'heading':
        blank(); lines.push(`${'#'.repeat(Math.min(node.attrs?.level ?? 3, 3))} ${inlineToMd(node.content)}`.trimEnd()); blank(); break
      case 'bulletList':
      case 'orderedList':
        blank()
        ;(node.content as PMNode[] ?? []).forEach((item, i) => {
          const text = (item.content as PMNode[] ?? []).map(p => inlineToMd(p.content)).join(' ').trim()
          lines.push(`${node.type === 'orderedList' ? `${i + 1}.` : '-'} ${text}`)
        })
        blank(); break
      case 'blockquote':
        blank()
        for (const p of node.content as PMNode[] ?? []) lines.push(`> ${inlineToMd(p.content)}`.trimEnd())
        blank(); break
      default: {
        const text = inlineToMd(node.content)
        if (text.trim()) { blank(); lines.push(text); blank() }
      }
    }
  }
  while (lines[0] === '') lines.shift()
  while (lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n')
}
