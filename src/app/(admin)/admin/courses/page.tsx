export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { BookOpen, Users, ClipboardList, GraduationCap } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { redirect } from 'next/navigation'

interface TeacherRow  { full_name: string; email: string }
interface CountRow    { count: number }
interface GroupRow {
  id: string
  name: string
  description: string | null
  created_at: string
  teacher: TeacherRow | null
  group_students: CountRow[]
  lessons: CountRow[]
  exams: CountRow[]
}

export default async function AdminCoursesPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const { data: adminUser } = await supabase
    .from('users').select('tenant_id').eq('id', user.id).single()

  if (!adminUser?.tenant_id) redirect('/login')

  const { data: raw } = await supabase
    .from('groups')
    .select(`
      id, name, description, created_at,
      teacher:users!groups_teacher_id_fkey(full_name, email),
      group_students(count),
      lessons(count),
      exams(count)
    `)
    .eq('tenant_id', adminUser.tenant_id)
    .order('created_at', { ascending: false })

  const groups = (raw ?? []) as unknown as GroupRow[]

  const totalGroups   = groups.length
  const totalStudents = groups.reduce((s, g) => s + (g.group_students[0]?.count ?? 0), 0)
  const totalLessons  = groups.reduce((s, g) => s + (g.lessons[0]?.count ?? 0), 0)
  const totalExams    = groups.reduce((s, g) => s + (g.exams[0]?.count ?? 0), 0)

  const stats = [
    { label: 'Groups',         value: totalGroups,   icon: Users,        color: 'text-blue-400',   bg: 'bg-blue-600/20' },
    { label: 'Total Students', value: totalStudents,  icon: GraduationCap,color: 'text-emerald-400',bg: 'bg-emerald-600/20' },
    { label: 'Lessons',        value: totalLessons,   icon: BookOpen,     color: 'text-violet-400', bg: 'bg-violet-600/20' },
    { label: 'Exams',          value: totalExams,     icon: ClipboardList,color: 'text-amber-400',  bg: 'bg-amber-600/20' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Courses & Groups</h2>
        <p className="text-slate-400 mt-1">All groups created by teachers in your institution</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(s => (
          <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className={`w-10 h-10 rounded-lg ${s.bg} flex items-center justify-center mb-3`}>
              <s.icon className={`w-5 h-5 ${s.color}`} />
            </div>
            <p className="text-2xl font-bold text-white">{s.value}</p>
            <p className="text-slate-400 text-sm mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
          <Users className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No groups yet. Teachers create groups from their panel.</p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">Group</th>
                <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden md:table-cell">Teacher</th>
                <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3">Students</th>
                <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden lg:table-cell">Lessons</th>
                <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden lg:table-cell">Exams</th>
                <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-5 py-3 hidden xl:table-cell">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {groups.map(group => (
                <tr key={group.id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-blue-600/20 flex items-center justify-center shrink-0">
                        <Users className="w-4 h-4 text-blue-400" />
                      </div>
                      <div>
                        <p className="text-white text-sm font-medium">{group.name}</p>
                        {group.description && (
                          <p className="text-slate-500 text-xs mt-0.5 line-clamp-1">{group.description}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 hidden md:table-cell">
                    <span className="text-slate-300 text-sm">{group.teacher?.full_name ?? '—'}</span>
                  </td>
                  <td className="px-5 py-4 text-slate-300 text-sm">{group.group_students[0]?.count ?? 0}</td>
                  <td className="px-5 py-4 hidden lg:table-cell text-slate-300 text-sm">{group.lessons[0]?.count ?? 0}</td>
                  <td className="px-5 py-4 hidden lg:table-cell text-slate-300 text-sm">{group.exams[0]?.count ?? 0}</td>
                  <td className="px-5 py-4 hidden xl:table-cell text-slate-500 text-sm">{formatDate(group.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
