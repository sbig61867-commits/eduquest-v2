import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { buildXlsx, type Cell } from '@/lib/xlsx'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// GET /api/grades/export?group_id=xxx&format=csv|json
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id').eq('id', user.id).single()
  if (!profile?.tenant_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const groupId = searchParams.get('group_id')
  const format = searchParams.get('format') ?? 'csv'

  if (!groupId) return NextResponse.json({ error: 'group_id required' }, { status: 400 })

  // Verify teacher owns the group
  const { data: group } = await adminClient()
    .from('groups').select('teacher_id, tenant_id, name').eq('id', groupId).single()
  if (!group || group.tenant_id !== profile.tenant_id || group.teacher_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Get all exams for this group (both homework and exams)
  const { data: exams } = await adminClient()
    .from('exams')
    .select('id, title, type, questions')
    .eq('group_id', groupId)
    .eq('teacher_id', user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (!exams || exams.length === 0) {
    return NextResponse.json({ error: 'No exams found for this group' }, { status: 404 })
  }

  // Get all students in the group
  const { data: members } = await adminClient()
    .from('group_students')
    .select('student_id, users(full_name, email)')
    .eq('group_id', groupId)

  if (!members || members.length === 0) {
    return NextResponse.json({ error: 'No students in this group' }, { status: 404 })
  }

  // Get all submissions for these exams
  const examIds = exams.map(e => e.id)
  const { data: submissions } = await adminClient()
    .from('exam_submissions')
    .select('exam_id, student_id, score, max_score, is_graded')
    .in('exam_id', examIds)

  // Build grade matrix
  type StudentRow = {
    student_id: string
    full_name: string
    email: string
    [key: string]: string | number | null
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: StudentRow[] = (members as any[]).map((m: any) => {
    const row: StudentRow = {
      student_id: m.student_id,
      full_name: m.users?.full_name ?? 'Unknown',
      email: m.users?.email ?? '',
    }
    let totalScore = 0
    let totalMax = 0

    for (const exam of exams) {
      const sub = submissions?.find(s => s.exam_id === exam.id && s.student_id === m.student_id)
      const maxScore = (exam.questions as Array<{ points?: number }>)
        .reduce((s, q) => s + (q.points ?? 0), 0)
      const score = sub?.score ?? null

      const colName = `${exam.type === 'homework' ? '[واجب]' : '[اختبار]'} ${exam.title} (من ${maxScore})`
      row[colName] = score !== null ? `${score}/${maxScore}` : '·'

      if (score !== null) { totalScore += Number(score); totalMax += maxScore }
    }

    row['المجموع'] = totalMax > 0 ? totalScore : '·'
    row['من أصل'] = exams.reduce((s, e) => {
      const max = (e.questions as Array<{ points?: number }>).reduce((a, q) => a + (q.points ?? 0), 0)
      return s + max
    }, 0)
    row['النسبة %'] = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : '·'

    return row
  })

  if (format === 'json') {
    return NextResponse.json({ group: group.name, rows })
  }

  if (rows.length === 0) return NextResponse.json({ error: 'No data' }, { status: 404 })

  // Real XLSX (not CSV): native UTF-8 keeps Arabic names intact, columns
  // always split correctly, numbers stay numeric, and no Excel warning.
  const HEADER_LABEL: Record<string, string> = { full_name: 'اسم الطالب', email: 'البريد الإلكتروني' }
  const headers = Object.keys(rows[0]).filter(k => k !== 'student_id')
  const today = new Date().toISOString().slice(0, 10)

  const numeric = (v: string | number | null): Cell => {
    if (v === null || v === '' || v === '·') return v ?? ''
    const n = Number(v)
    return Number.isFinite(n) && String(v).trim() !== '' ? n : v
  }

  const sheet: Cell[][] = [
    [`كشف علامات، المجموعة: ${group.name}`],
    [`تاريخ التصدير: ${today}`],
    [],
    headers.map(h => HEADER_LABEL[h] ?? h),
    ...rows.map(row => headers.map(h =>
      (h === 'full_name' || h === 'email') ? (row[h] ?? '') : numeric(row[h])
    )),
  ]

  const buf = await buildXlsx(sheet, 'العلامات')
  const filename = `grades_${group.name.replace(/\s+/g, '_')}_${today}.xlsx`

  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
