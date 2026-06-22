export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { TeachersClient } from './teachers-client'

export default async function TeachersPage() {
  const supabase = await createClient()
  const { data: teachers } = await supabase
    .from('users')
    .select('*')
    .eq('role', 'teacher')
    .order('created_at', { ascending: false })

  return <TeachersClient initialTeachers={teachers ?? []} />
}
