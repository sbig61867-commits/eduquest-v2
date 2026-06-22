export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { StudentsClient } from './students-client'

export default async function StudentsPage() {
  const supabase = await createClient()
  const { data: students } = await supabase
    .from('users')
    .select('*')
    .eq('role', 'student')
    .order('created_at', { ascending: false })

  return <StudentsClient initialStudents={students ?? []} />
}
