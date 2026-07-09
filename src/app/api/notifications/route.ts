import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface Notif { id: string; type: string; title: string; subtitle: string; date: string; href: string }

// GET /api/notifications — recent, role-aware activity for the header bell.
// Reads through the user's session (RLS-scoped); no notifications table —
// items are derived from recent domain activity, newest first.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id').eq('id', user.id).single()
  const role = profile?.role
  const items: Notif[] = []

  if (role === 'student') {
    const { data: memberOf } = await supabase.from('group_students').select('group_id').eq('student_id', user.id)
    const groupIds = (memberOf ?? []).map(r => r.group_id)
    const [{ data: lessons }, { data: rpcExams }, { data: grades }] = await Promise.all([
      groupIds.length
        ? supabase.from('lessons').select('id, title, created_at, groups(name)').in('group_id', groupIds).eq('is_published', true).is('deleted_at', null).order('created_at', { ascending: false }).limit(8)
        : Promise.resolve({ data: [] as unknown[] }),
      supabase.rpc('get_student_exams'),
      supabase.from('exam_submissions').select('id, score, max_score, submitted_at, exams(title)').eq('student_id', user.id).not('score', 'is', null).order('submitted_at', { ascending: false }).limit(6),
    ])
    for (const l of (lessons ?? []) as Array<{ id: string; title: string; created_at: string; groups: { name: string } | { name: string }[] | null }>) {
      const g = Array.isArray(l.groups) ? l.groups[0] : l.groups
      items.push({ id: `lesson-${l.id}`, type: 'lesson', title: `درس جديد: ${l.title}`, subtitle: g?.name ?? '', date: l.created_at, href: '/student/lessons' })
    }
    for (const e of ((rpcExams ?? []) as Array<{ id: string; title: string; created_at: string }>).slice(0, 8)) {
      items.push({ id: `exam-${e.id}`, type: 'exam', title: `اختبار جديد: ${e.title}`, subtitle: '', date: e.created_at, href: '/student/exams' })
    }
    for (const gr of (grades ?? []) as Array<{ id: string; score: number; max_score: number | null; submitted_at: string; exams: { title: string } | { title: string }[] | null }>) {
      const ex = Array.isArray(gr.exams) ? gr.exams[0] : gr.exams
      items.push({ id: `grade-${gr.id}`, type: 'grade', title: `نُشرت نتيجة: ${ex?.title ?? 'اختبار'}`, subtitle: `${gr.score}${gr.max_score ? `/${gr.max_score}` : ''}`, date: gr.submitted_at, href: '/student/grades' })
    }

  } else if (role === 'teacher') {
    // New submissions to the teacher's own exams/homework.
    const { data: exams } = await supabase.from('exams').select('id, title, type').eq('teacher_id', user.id).is('deleted_at', null)
    const examMap = new Map((exams ?? []).map(e => [e.id, e as { id: string; title: string; type: string }]))
    if (examMap.size) {
      const { data: subs } = await supabase
        .from('exam_submissions')
        .select('id, exam_id, submitted_at, users:student_id(full_name)')
        .in('exam_id', [...examMap.keys()])
        .order('submitted_at', { ascending: false })
        .limit(15)
      for (const s of (subs ?? []) as Array<{ id: string; exam_id: string; submitted_at: string; users: { full_name: string } | { full_name: string }[] | null }>) {
        const ex = examMap.get(s.exam_id)
        const u = Array.isArray(s.users) ? s.users[0] : s.users
        const kind = ex?.type === 'homework' ? 'واجب' : 'اختبار'
        items.push({ id: `sub-${s.id}`, type: 'submission', title: `تسليم جديد في ${kind}: ${ex?.title ?? ''}`, subtitle: u?.full_name ?? '', date: s.submitted_at, href: '/teacher/exams' })
      }
    }

  } else if (role === 'university_admin') {
    // Newly added teachers/students in the tenant.
    const { data: users } = await supabase
      .from('users').select('id, full_name, role, created_at')
      .eq('tenant_id', profile!.tenant_id).in('role', ['teacher', 'student'])
      .order('created_at', { ascending: false }).limit(15)
    for (const u of (users ?? []) as Array<{ id: string; full_name: string; role: string; created_at: string }>) {
      items.push({ id: `user-${u.id}`, type: 'user', title: `${u.role === 'teacher' ? 'معلم' : 'طالب'} جديد: ${u.full_name}`, subtitle: '', date: u.created_at, href: u.role === 'teacher' ? '/admin/teachers' : '/admin/students' })
    }

  } else if (role === 'super_admin') {
    const [{ data: msgs }, { data: tenants }] = await Promise.all([
      supabase.from('contact_messages').select('id, name, subject, created_at, is_read').order('created_at', { ascending: false }).limit(10),
      supabase.from('tenants').select('id, name, created_at').order('created_at', { ascending: false }).limit(8),
    ])
    for (const m of (msgs ?? []) as Array<{ id: string; name: string; subject: string | null; created_at: string; is_read: boolean }>) {
      items.push({ id: `msg-${m.id}`, type: 'message', title: `رسالة تواصل من ${m.name}`, subtitle: m.subject ?? '', date: m.created_at, href: '/super-admin/messages' })
    }
    for (const tn of (tenants ?? []) as Array<{ id: string; name: string; created_at: string }>) {
      items.push({ id: `tenant-${tn.id}`, type: 'tenant', title: `جامعة جديدة: ${tn.name}`, subtitle: '', date: tn.created_at, href: '/super-admin/tenants' })
    }
  }

  items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  return NextResponse.json({ notifications: items.slice(0, 15) })
}
