'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/utils'
import { Inbox, MailOpen, Trash2, Copy, Check } from 'lucide-react'

interface ContactMessage {
  id: string
  name: string
  email: string
  message: string
  is_read: boolean
  created_at: string
}

export function MessagesClient({ initialMessages }: { initialMessages: ContactMessage[] }) {
  const router = useRouter()
  const supabase = createClient()
  const [messages, setMessages] = useState(initialMessages)
  const [copiedId, setCopiedId] = useState('')

  const unread = messages.filter(m => !m.is_read).length

  async function markRead(id: string) {
    const { error } = await supabase.from('contact_messages').update({ is_read: true }).eq('id', id)
    if (!error) {
      setMessages(prev => prev.map(m => m.id === id ? { ...m, is_read: true } : m))
      router.refresh()
    }
  }

  async function remove(id: string) {
    const { error } = await supabase.from('contact_messages').delete().eq('id', id)
    if (!error) {
      setMessages(prev => prev.filter(m => m.id !== id))
      router.refresh()
    }
  }

  async function copyEmail(id: string, email: string) {
    await navigator.clipboard.writeText(email)
    setCopiedId(id)
    setTimeout(() => setCopiedId(''), 2000)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-fg">Contact Messages</h2>
        <p className="text-fg-secondary mt-1">
          {messages.length} total · {unread} unread — sent from the public landing page
        </p>
      </div>

      {messages.length === 0 ? (
        <div className="text-center py-20 bg-surface border border-border rounded-lg">
          <Inbox className="w-12 h-12 text-fg-muted mx-auto mb-3" />
          <p className="text-fg-secondary">No messages yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map(m => (
            <div key={m.id}
              className={`bg-surface border rounded-lg p-5 ${m.is_read ? 'border-border opacity-75' : 'border-accent/30'}`}>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-fg font-semibold">{m.name}</p>
                    {!m.is_read && <span className="px-2 py-0.5 rounded-full bg-accent-subtle text-accent text-xs font-medium">New</span>}
                  </div>
                  <button onClick={() => copyEmail(m.id, m.email)}
                    className="flex items-center gap-1.5 text-fg-secondary hover:text-fg text-sm font-mono mt-0.5 transition-colors">
                    {m.email}
                    {copiedId === m.id ? <Check className="w-3.5 h-3.5 text-accent" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <span className="text-fg-muted text-xs shrink-0">{formatDate(m.created_at)}</span>
              </div>
              <p className="text-fg-secondary text-sm leading-relaxed whitespace-pre-wrap">{m.message}</p>
              <div className="flex items-center gap-2 mt-4">
                {!m.is_read && (
                  <button onClick={() => markRead(m.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface hover:bg-canvas text-fg-secondary text-xs font-medium transition-colors">
                    <MailOpen className="w-3.5 h-3.5" /> Mark as read
                  </button>
                )}
                <button onClick={() => remove(m.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium transition-colors">
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
