'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import { useTranslations } from 'next-intl'
import { Bold, Heading3, Highlighter, Italic, List, ListOrdered, Quote } from 'lucide-react'
import { markdownToRich, richToMarkdown, type PMNode } from '@/lib/lesson-rich-text'
import { cn } from '@/lib/utils'

// The teacher writes as in a word processor; the lesson keeps storing the same
// Markdown subset (src/lib/lesson-rich-text.ts). Only the formats the student
// view renders are enabled, so nothing typed or pasted is lost on save: pasted
// colours, fonts or tables from Word are dropped by the schema, not stored.
// Loaded only in the editor (next/dynamic in lesson-builder.tsx).

const TOOL = 'eq-focus w-8 h-8 rounded-control flex items-center justify-center text-fg-2 hover:text-fg hover:bg-elevated aria-pressed:bg-accent-subtle aria-pressed:text-accent'

export default function RichTextField({ value, onChange, placeholder }: { value: string; onChange: (md: string) => void; placeholder?: string }) {
  const t = useTranslations('common.lessonBuilder.rich')
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [3] },
        codeBlock: false, horizontalRule: false, strike: false, underline: false, link: false,
      }),
      Highlight,
    ],
    content: markdownToRich(value) as unknown as Record<string, unknown>,
    editorProps: {
      attributes: {
        dir: 'auto',
        'aria-label': placeholder ?? t('label'),
        class: 'eq-rich min-h-24 px-3 py-2 text-body text-fg-2 leading-relaxed focus:outline-none',
      },
    },
    onUpdate: ({ editor: e }) => onChange(richToMarkdown(e.getJSON() as unknown as PMNode)),
  })

  if (!editor) return <div className="min-h-24 rounded-control border border-line-strong bg-canvas" />

  const tools: { key: string; icon: React.ReactNode; on: boolean; run: () => void }[] = [
    { key: 'heading', icon: <Heading3 className="w-4 h-4" />, on: editor.isActive('heading'), run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { key: 'bold', icon: <Bold className="w-4 h-4" />, on: editor.isActive('bold'), run: () => editor.chain().focus().toggleBold().run() },
    { key: 'italic', icon: <Italic className="w-4 h-4" />, on: editor.isActive('italic'), run: () => editor.chain().focus().toggleItalic().run() },
    { key: 'highlight', icon: <Highlighter className="w-4 h-4" />, on: editor.isActive('highlight'), run: () => editor.chain().focus().toggleHighlight().run() },
    { key: 'bullet', icon: <List className="w-4 h-4" />, on: editor.isActive('bulletList'), run: () => editor.chain().focus().toggleBulletList().run() },
    { key: 'numbered', icon: <ListOrdered className="w-4 h-4" />, on: editor.isActive('orderedList'), run: () => editor.chain().focus().toggleOrderedList().run() },
    { key: 'quote', icon: <Quote className="w-4 h-4" />, on: editor.isActive('blockquote'), run: () => editor.chain().focus().toggleBlockquote().run() },
  ]

  return (
    <div className="rounded-control border border-line-strong bg-canvas focus-within:border-accent">
      <div role="toolbar" aria-label={t('toolbar')} className="flex flex-wrap gap-1 border-b border-line p-1">
        {tools.map(tool => (
          <button key={tool.key} type="button" onMouseDown={e => e.preventDefault()} onClick={tool.run}
            aria-pressed={tool.on} aria-label={t(tool.key)} title={t(tool.key)} className={cn(TOOL)}>
            {tool.icon}
          </button>
        ))}
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
