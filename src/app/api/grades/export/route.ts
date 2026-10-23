import { currentCtx } from '@/lib/auth/current'
import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { getTranslations } from 'next-intl/server'
import { run, maybeOne } from '@/lib/db/sql'
import { buildXlsx, type Cell } from '@/lib/xlsx'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/grades/export?group_id=xxx&format=csv|json
export async function GET(request: Request) {
  const ctx = await currentCtx()
  if (!ctx) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const user = { id: ctx.sub }
  if (!ctx.tenant_id) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const groupId = searchParams.get('group_id')
  const format = searchParams.get('format') ?? 'csv'

  if (!groupId) return NextResponse.json({ ...(await apiErr('missingGroupId')) }, { status: 400 })
  if (!UUID.test(groupId)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })

  // One unit, as app_service pinned to the teacher's institution: the group
  // (ownership), its exams (homework and exams), its students with names, and
  // every submission to exactly those exams — read whole in one statement
  // (no page cap to stitch around). A failed read is an error, never a sheet
  // with missing grades.
  let groupRows, examRows, memberRows, subRows
  try {
    ;[groupRows, examRows, memberRows, subRows] = await run({ as: 'service', tenantId: ctx.tenant_id }, sql => [
      sql`select teacher_id, tenant_id, name from public.groups where id = ${groupId}`,
      sql`select id, title, type, questions from public.exams
           where group_id = ${groupId} and teacher_id = ${user.id} and deleted_at is null
           order by created_at`,
      sql`select gs.student_id, u.full_name, u.email
            from public.group_students gs left join public.users u on u.id = gs.student_id
           where gs.group_id = ${groupId}`,
      sql`select s.exam_id, s.student_id, s.score
            from public.exam_submissions s join public.exams e on e.id = s.exam_id
           where e.group_id = ${groupId} and e.teacher_id = ${user.id} and e.deleted_at is null`,
    ])
  } catch (e) {
    console.error('[api/grades/export]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('dataReadIncomplete')) }, { status: 503 })
  }

  const group = maybeOne<{ teacher_id: string; tenant_id: string; name: string }>(groupRows)
  if (!group || group.tenant_id !== ctx.tenant_id || group.teacher_id !== user.id) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }
  const exams = examRows as unknown as { id: string; title: string; type: string; questions: unknown }[]
  if (exams.length === 0) {
    return NextResponse.json({ ...(await apiErr('noGroupExams')) }, { status: 404 })
  }
  const members = memberRows as unknown as { student_id: string; full_name: string | null; email: string | null }[]
  if (members.length === 0) {
    return NextResponse.json({ ...(await apiErr('noGroupStudents')) }, { status: 404 })
  }
  const submissions = subRows as unknown as { exam_id: string; student_id: string; score: number | null }[]

  // Build grade matrix
  type StudentRow = {
    student_id: string
    full_name: string
    email: string
    [key: string]: string | number | null
  }

  // Column names are the sheet's headers, so they are written in the
  // downloader's language (same request locale the page rendered with).
  const t = await getTranslations('reports.exports.grades')
  const tr = await getTranslations('reports.exports')

  const rows: StudentRow[] = members.map((m) => {
    const row: StudentRow = {
      student_id: m.student_id,
      full_name: m.full_name ?? t('unknownStudent'),
      email: m.email ?? '',
    }
    let totalScore = 0
    let totalMax = 0

    for (const exam of exams) {
      const sub = submissions.find(s => s.exam_id === exam.id && s.student_id === m.student_id)
      const maxScore = (exam.questions as Array<{ points?: number }>)
        .reduce((s, q) => s + (q.points ?? 0), 0)
      const score = sub?.score ?? null

      const colName = t('column', { kind: exam.type === 'homework' ? t('homework') : t('exam'), title: exam.title, max: maxScore })
      row[colName] = score !== null ? `${score}/${maxScore}` : '·'

      if (score !== null) { totalScore += Number(score); totalMax += maxScore }
    }

    row[t('total')] = totalMax > 0 ? totalScore : '·'
    row[t('outOf')] = exams.reduce((s, e) => {
      const max = (e.questions as Array<{ points?: number }>).reduce((a, q) => a + (q.points ?? 0), 0)
      return s + max
    }, 0)
    row[t('percent')] = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : '·'

    return row
  })

  if (format === 'json') {
    return NextResponse.json({ group: group.name, rows })
  }

  if (rows.length === 0) return NextResponse.json({ ...(await apiErr('noData')) }, { status: 404 })

  // Real XLSX (not CSV): native UTF-8 keeps Arabic names intact, columns
  // always split correctly, numbers stay numeric, and no Excel warning.
  const HEADER_LABEL: Record<string, string> = { full_name: t('studentName'), email: t('email') }
  const headers = Object.keys(rows[0]).filter(k => k !== 'student_id')
  const today = new Date().toISOString().slice(0, 10)

  const numeric = (v: string | number | null): Cell => {
    if (v === null || v === '' || v === '·') return v ?? ''
    const n = Number(v)
    return Number.isFinite(n) && String(v).trim() !== '' ? n : v
  }

  const sheet: Cell[][] = [
    [t('title', { group: group.name })],
    [tr('exportedOn', { date: today })],
    [],
    headers.map(h => HEADER_LABEL[h] ?? h),
    ...rows.map(row => headers.map(h =>
      (h === 'full_name' || h === 'email') ? (row[h] ?? '') : numeric(row[h])
    )),
  ]

  const buf = await buildXlsx(sheet, t('sheet'))
  const filename = `grades_${group.name.replace(/\s+/g, '_')}_${today}.xlsx`

  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
