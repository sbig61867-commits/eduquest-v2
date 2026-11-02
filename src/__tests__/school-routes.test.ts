// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SqlCall } from './helpers/fake-sql'

// /api/school/structure and /api/school/placement on the SQL layer (fake):
// who may call (a school's staff holding manage_academic_structure), that a
// non-school institution is refused before any write, that every write runs
// as app_service pinned to the SESSION's institution (never one from the
// body), and that the database's refusals come back as precise errors.

const TENANT = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const id = (k: number) => `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`

const env = vi.hoisted(() => ({
  session: null as null | { sub: string; role: string; tenant_id: string | null },
  me: null as null | Record<string, unknown>,
  answer: ((q: SqlCall) => (void q, [])) as (q: SqlCall) => unknown[] | Error,
  calls: [] as SqlCall[],
}))

vi.mock('@/lib/auth/current', () => ({
  currentCtx: async () => (env.session ? { ...env.session, email: null, is_active: true, must_change_password: false } : null),
}))
vi.mock('@/lib/api-error', () => ({ apiErr: async (code: string, params?: unknown) => ({ error: code, code, params }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ allowed: true, remaining: 1, resetAt: 0 }) }))
vi.mock('@/lib/db/sql', async () => (await import('./helpers/fake-sql')).fakeSqlModule(q => {
  env.calls.push(q)
  if (q.text.startsWith('select u.role, u.tenant_id, u.permissions, t.institution_type')) return env.me ? [env.me] : []
  return env.answer(q)
}))

const structure = () => import('@/app/api/school/structure/route')
const placement = () => import('@/app/api/school/placement/route')
const req = (method: string, body?: unknown, qs = '') =>
  new Request(`http://x/api/school/x${qs}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const json = async (res: Response) => ({ status: res.status, body: await res.json() as Record<string, unknown> })
const writes = () => env.calls.filter(c => !c.text.startsWith('select u.role, u.tenant_id'))

beforeEach(() => {
  env.session = { sub: id(1), role: 'university_admin', tenant_id: TENANT }
  env.me = { role: 'university_admin', tenant_id: TENANT, permissions: {}, institution_type: 'school' }
  env.answer = () => []
  env.calls = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('school routes: the gate', () => {
  it('no session → 401, nothing read', async () => {
    env.session = null
    expect((await json(await (await structure()).POST(req('POST', { kind: 'stage' })))).status).toBe(401)
    expect(env.calls).toHaveLength(0)
  })

  it('a teacher, a student and a centre manager without the capability → 403', async () => {
    for (const role of ['teacher', 'student', 'center_manager']) {
      env.me = { role, tenant_id: TENANT, permissions: {}, institution_type: 'school' }
      expect((await json(await (await structure()).POST(req('POST', { kind: 'stage', stage_kind: 'basic', name: 'B' })))).status).toBe(403)
    }
    expect(writes()).toHaveLength(0)
  })

  it('an account no longer live in the session institution → 403', async () => {
    env.me = null
    expect((await json(await (await placement()).GET(req('GET', undefined, `?year_id=${id(5)}`)))).status).toBe(403)
  })

  it('a university (any non-school) → 409 schoolOnly, before any write', async () => {
    env.me = { role: 'university_admin', tenant_id: TENANT, permissions: {}, institution_type: 'university' }
    const res = await json(await (await structure()).POST(req('POST', { kind: 'stage', stage_kind: 'basic', name: 'B' })))
    expect(res).toMatchObject({ status: 409, body: { code: 'schoolOnly' } })
    expect(writes()).toHaveLength(0)
    expect((await json(await (await placement()).POST(req('POST', { section_id: id(2), student_ids: [id(3)] })))).status).toBe(409)
  })

  it('the caller is read as app_service pinned to the session institution', async () => {
    await (await structure()).POST(req('POST', { kind: 'stage', stage_kind: 'basic', name: 'B' }))
    expect(env.calls[0].ctx).toEqual({ as: 'service', tenantId: TENANT })
    expect(env.calls[0].values).toEqual([id(1), TENANT])
  })

  it('a centre manager granted the capability passes', async () => {
    env.me = { role: 'center_manager', tenant_id: TENANT, permissions: { manage_academic_structure: true }, institution_type: 'school' }
    env.answer = () => [{ id: id(9), kind: 'basic', name: 'B', code: null, sort_order: 0 }]
    expect((await json(await (await structure()).POST(req('POST', { kind: 'stage', stage_kind: 'basic', name: 'B' })))).status).toBe(201)
  })
})

describe('school routes: structure writes', () => {
  it('creates a stage in the session institution even when the body names another', async () => {
    env.answer = q => q.text.startsWith('insert into public.school_stages') ? [{ id: id(9), kind: 'basic', name: 'Basic', code: 'B', sort_order: 0 }] : []
    const res = await json(await (await structure()).POST(req('POST', { kind: 'stage', stage_kind: 'basic', name: ' Basic ', code: 'B', tenant_id: OTHER })))
    expect(res).toMatchObject({ status: 201, body: { stage: { id: id(9), name: 'Basic' } } })
    const insert = writes().find(c => c.text.startsWith('insert into public.school_stages'))!
    expect(insert.ctx).toEqual({ as: 'service', tenantId: TENANT })
    expect(insert.values).toContain(TENANT)
    expect(insert.values).not.toContain(OTHER)
    expect(insert.values).toContain('Basic')
  })

  it('invalid input is refused before the database', async () => {
    const r = await structure()
    expect((await json(await r.POST(req('POST', { kind: 'school' })))).body.code).toBe('invalidData')
    expect((await json(await r.POST(req('POST', { kind: 'section', grade_id: id(1), year_id: id(2), label: '' })))).body.code).toBe('sectionLabelInvalid')
    expect((await json(await r.PATCH(req('PATCH', { kind: 'stage', id: 'nope', name: 'X' })))).status).toBe(404)
    expect((await json(await r.PATCH(req('PATCH', { kind: 'stage', order: [id(1), id(1)] })))).body.code).toBe('invalidOrder')
    expect((await json(await r.PATCH(req('PATCH', { kind: 'year', order: [id(1)] })))).body.code).toBe('invalidOrder')
    expect(writes()).toHaveLength(0)
  })

  it('a duplicate code comes back as codeTaken, not a 500', async () => {
    env.answer = q => q.text.startsWith('insert into public.school_stages')
      ? Object.assign(new Error('duplicate key value violates unique constraint "school_stages_code_uq"'), { code: '23505', constraint_name: 'school_stages_code_uq' })
      : []
    const res = await json(await (await structure()).POST(req('POST', { kind: 'stage', stage_kind: 'basic', name: 'B', code: 'b' })))
    expect(res).toMatchObject({ status: 409, body: { code: 'codeTaken' } })
  })

  it('a term outside its year (trigger 23514) is termOutsideYear', async () => {
    env.answer = q => q.text.startsWith('insert into public.school_terms')
      ? Object.assign(new Error('a term must lie inside its academic year'), { code: '23514' })
      : []
    const res = await json(await (await structure()).POST(req('POST', {
      kind: 'term', year_id: id(4), term_no: 2, name: 'T2', starts_on: '2027-02-01', ends_on: '2027-07-30',
    })))
    expect(res).toMatchObject({ status: 400, body: { code: 'termOutsideYear' } })
  })

  it('a section with a homeroom teacher of another institution is refused, nothing inserted', async () => {
    env.answer = q => q.text.startsWith('select exists') ? [{ grade: true, year: true, teacher: false, sections: 0 }] : []
    const res = await json(await (await structure()).POST(req('POST', { kind: 'section', grade_id: id(1), year_id: id(2), label: 'A', teacher_id: id(7) })))
    expect(res).toMatchObject({ status: 400, body: { code: 'teacherNotInTenant' } })
  })

  it('reorder sends the full order in one statement, pinned', async () => {
    env.answer = q => q.text.startsWith('update public.school_stages') ? [{ id: id(2) }, { id: id(1) }] : []
    const res = await json(await (await structure()).PATCH(req('PATCH', { kind: 'stage', order: [id(2), id(1)] })))
    expect(res).toMatchObject({ status: 200, body: { order: { updated: 2 } } })
    const upd = writes().find(c => c.text.startsWith('update public.school_stages'))!
    expect(upd.values).toContain(`${id(2)},${id(1)}`)
    expect(upd.ctx).toEqual({ as: 'service', tenantId: TENANT })
  })

  it('archiving a grade with active sections is 409; an unknown one is 404', async () => {
    env.answer = q => q.text.startsWith('select exists') ? [{ blocked: true }] : []
    expect((await json(await (await structure()).DELETE(req('DELETE', { kind: 'grade', id: id(3) })))).body.code).toBe('hasActiveSections')
    env.answer = () => []
    expect((await json(await (await structure()).DELETE(req('DELETE', { kind: 'grade', id: id(3) })))).body.code).toBe('gradeNotFound')
  })

  it('the active year cannot be archived', async () => {
    env.answer = q => q.text.startsWith('select is_active as blocked') ? [{ blocked: true }] : []
    expect((await json(await (await structure()).DELETE(req('DELETE', { kind: 'year', id: id(3) })))).body.code).toBe('yearIsActive')
  })
})

describe('school routes: placement', () => {
  it('more than 100 students in one request is refused', async () => {
    const res = await json(await (await placement()).POST(req('POST', { section_id: id(1), student_ids: Array.from({ length: 101 }, (_, k) => id(k + 10)) })))
    expect(res).toMatchObject({ status: 400, body: { code: 'tooManyStudentsSelected' } })
    expect(writes()).toHaveLength(0)
  })

  it('a full section refuses the batch and writes nothing', async () => {
    env.answer = q => {
      if (q.text.startsWith('select g.id, g.max_students')) return [{ id: id(1), max_students: 2, school_year_id: id(5) }]
      if (q.text.startsWith('select count(*)::int as n from public.users')) return [{ n: 2 }]
      if (q.text.startsWith('select count(*)::int as n from public.group_students')) return [{ n: 1 }]
      return new Error('unexpected: ' + q.text)
    }
    const res = await json(await (await placement()).POST(req('POST', { section_id: id(1), student_ids: [id(11), id(12)] })))
    expect(res).toMatchObject({ status: 409, body: { code: 'sectionFull', params: { max: 2 } } })
    expect(writes().some(c => /^(insert|delete)/.test(c.text))).toBe(false)
  })

  it('a student outside the institution refuses the batch', async () => {
    env.answer = q => {
      if (q.text.startsWith('select g.id, g.max_students')) return [{ id: id(1), max_students: null, school_year_id: id(5) }]
      if (q.text.startsWith('select count(*)::int as n from public.users')) return [{ n: 1 }]
      return new Error('unexpected: ' + q.text)
    }
    const res = await json(await (await placement()).POST(req('POST', { section_id: id(1), student_ids: [id(11), id(12)] })))
    expect(res).toMatchObject({ status: 404, body: { code: 'studentNotInTenant' } })
  })

  it('places: removes the same-year placement elsewhere first, then inserts', async () => {
    env.answer = q => {
      if (q.text.startsWith('select g.id, g.max_students')) return [{ id: id(1), max_students: null, school_year_id: id(5) }]
      if (q.text.startsWith('select count(*)::int as n from public.users')) return [{ n: 2 }]
      if (q.text.startsWith('delete from public.group_students')) return [{ student_id: id(11) }]
      if (q.text.startsWith('insert into public.group_students')) return []
      return new Error('unexpected: ' + q.text)
    }
    const res = await json(await (await placement()).POST(req('POST', { section_id: id(1), student_ids: [id(11), id(12)] })))
    expect(res).toMatchObject({ status: 201, body: { placed: 2, moved: 1 } })
    const order = writes().map(c => c.text.split(' ')[0])
    expect(order.indexOf('delete')).toBeLessThan(order.indexOf('insert'))
    expect(writes().every(c => c.ctx.as === 'service' && c.ctx.tenantId === TENANT)).toBe(true)
  })

  it('a concurrent placement of the same student (unique index) is placementConflict', async () => {
    env.answer = q => {
      if (q.text.startsWith('select g.id, g.max_students')) return [{ id: id(1), max_students: null, school_year_id: id(5) }]
      if (q.text.startsWith('select count(*)::int as n from public.users')) return [{ n: 1 }]
      if (q.text.startsWith('delete from public.group_students')) return []
      return Object.assign(new Error('dup'), { code: '23505', constraint_name: 'group_students_one_section_per_year_uq' })
    }
    const res = await json(await (await placement()).POST(req('POST', { section_id: id(1), student_ids: [id(11)] })))
    expect(res).toMatchObject({ status: 409, body: { code: 'placementConflict' } })
  })

  it('the list needs a year of the institution, read as the user', async () => {
    const r = await placement()
    expect((await json(await r.GET(req('GET', undefined, '?year_id=nope')))).status).toBe(404)
    env.answer = q => q.text.startsWith('with base as') ? [{ year_ok: false, total: 0, page: 1, rows: [] }] : []
    expect((await json(await r.GET(req('GET', undefined, `?year_id=${id(5)}`)))).body.code).toBe('yearNotFound')
    env.answer = q => q.text.startsWith('with base as') ? [{ year_ok: true, total: 1, page: 1, rows: [{ id: id(11), full_name: 'Sara', section_id: null }] }] : []
    const res = await json(await r.GET(req('GET', undefined, `?year_id=${id(5)}&q=Sa%25ra&unplaced=1`)))
    expect(res).toMatchObject({ status: 200, body: { total: 1, page: 1, pageCount: 1, students: [{ full_name: 'Sara' }] } })
    const list = env.calls.filter(c => c.text.startsWith('with base as')).at(-1)!
    expect(list.ctx).toEqual({ as: 'user', userId: id(1) })
    expect(list.values).toContain('%Sa ra%') // search wildcards are neutralised
    expect(list.text).toMatch(/limit \$ offset/)
  })
})
