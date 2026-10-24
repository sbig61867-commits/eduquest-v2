export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { redirect } from 'next/navigation'
import { MessagesClient } from './messages-client'

export default async function MessagesPage() {
  const user = await currentUser()
  if (!user) redirect('/login')

  // Only the owner can read contact_messages (RLS).
  const [messages] = await run({ as: 'user', userId: user.id }, sql => [
    sql`select id, name, email, message, is_read, created_at from public.contact_messages
         order by created_at desc limit 500`,
  ])

  return <MessagesClient initialMessages={messages as unknown as Parameters<typeof MessagesClient>[0]['initialMessages']} />
}
