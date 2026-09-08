export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PageTitle } from '@/components/shared/page-title'
import { MessagesClient } from './messages-client'

export default async function MessagesPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  // RLS: only super_admin can read contact_messages
  const { data: messages } = await supabase
    .from('contact_messages')
    .select('id, name, email, message, is_read, created_at')
    .order('created_at', { ascending: false })

  return (<><PageTitle title="Messages" /><MessagesClient initialMessages={messages ?? []} /></>)
}
