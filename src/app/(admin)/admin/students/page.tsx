export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { StudentsClient } from './students-client'

export default async function StudentsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('tenant_id, role').eq('id', user.id).single()

  if (!profile?.tenant_id) redirect('/login')

  const { data: students } = await supabase
    .from('users')
    .select('*')
    .eq('role', 'student')
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: false })

  return <StudentsClient initialStudents={students ?? []} />
}
