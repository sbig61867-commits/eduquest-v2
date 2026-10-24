import { run } from '@/lib/db/sql'
import { parsePage } from '@/lib/data/people'

// ── /center/groups (B, absorbs F1) ──────────────────────────────────────────
//
// The institution's groups, read as the centre manager (RLS: groups_select —
// own tenant, not deleted), plus the same explicit tenant filter as before.
// ONE unit: the table's page (newest first, `id` breaks ties so pages never
// overlap or skip, a page past the end becomes the last page) with the active /
// archived totals, and the transfer picker's every ACTIVE group of the
// institution — not just the groups on the current page. A failed read throws,
// never a partial screen.

export const CENTER_GROUPS_PAGE_SIZE = 50

export interface TransferOptionRow {
  id: string; name: string; course_id: string | null; max_students: number | null
  group_students: { count: number }[] | null
}

const memberCount = (sql: Parameters<Parameters<typeof run>[1]>[0]) =>
  sql`json_build_array(json_build_object('count', (select count(*)::int from public.group_students s where s.group_id = g.id)))`

export async function loadCenterGroupsPage(userId: string, tenantId: string, rawPage: unknown) {
  const size = CENTER_GROUPS_PAGE_SIZE
  const [pageRows, transfer] = await run({ as: 'user', userId }, sql => [
    sql`with t as (select count(*) filter (where is_active)::int as active, count(*) filter (where not is_active)::int as archived
                   from public.groups where tenant_id = ${tenantId}),
             pg as (select least(${parsePage(rawPage)}, greatest(1, ceil((active + archived) / ${size}::numeric)::int)) as p from t)
        select (select active from t) as active, (select archived from t) as archived, (select p from pg) as page,
               coalesce((select json_agg(x order by x.created_at desc, x.id) from (
                 select g.id, g.name, g.description, g.is_active, g.teacher_id, g.course_id, g.image_url, g.max_students,
                        g.instructions, g.created_at, ${memberCount(sql)} as group_students,
                        case when u.id is null then null else json_build_object('full_name', u.full_name, 'role', u.role, 'is_active', u.is_active) end as teacher
                   from public.groups g left join public.users u on u.id = g.teacher_id
                  where g.tenant_id = ${tenantId}
                  order by g.created_at desc, g.id
                  limit ${size} offset ((select p from pg) - 1) * ${size}) x), '[]') as rows`,
    sql`select g.id, g.name, g.course_id, g.max_students, ${memberCount(sql)} as group_students
          from public.groups g where g.tenant_id = ${tenantId} and g.is_active order by g.name, g.id`,
  ])
  const p = pageRows[0] as { active: number; archived: number; page: number; rows: Record<string, unknown>[] }
  const total = p.active + p.archived
  return {
    rows: p.rows.map(({ created_at: _c, ...row }) => (void _c, row)),
    page: p.page, total, active: p.active, archived: p.archived,
    transferOptions: transfer as unknown as TransferOptionRow[],
    pageCount: Math.max(1, Math.ceil(total / size)),
  }
}
