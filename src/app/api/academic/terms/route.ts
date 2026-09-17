import { NextResponse } from 'next/server'
import { getCaller, serviceClient, staffCan } from '@/lib/staff-auth'
import { getTenantStructureMode } from '@/lib/structure-mode'

// Academic terms (semester / term / session / period — named per institution
// type). Same privileged-write pattern as ../units/route.ts.

async function authorize() {
  const res = await getCaller()
  if ('error' in res) return res
  if (!staffCan(res.caller, 'manage_academic_structure')) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  // Tenants on the original ('flat') structure can't touch this at all.
  if ((await getTenantStructureMode(serviceClient(), res.caller.tenant_id)) !== 'academic') {
    return { error: NextResponse.json({ error: 'الهيكل الأكاديمي غير مفعّل لمؤسستك' }, { status: 409 }) }
  }
  return res
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function validDate(v: unknown): string | null {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return null
  return Number.isNaN(Date.parse(v)) ? null : v
}

const SELECT = 'id, name, starts_on, ends_on, is_current'

// Only one current term per tenant (unique partial index): clear the others first.
async function clearCurrent(admin: ReturnType<typeof serviceClient>, tenantId: string, exceptId?: string) {
  let q = admin.from('academic_terms').update({ is_current: false })
    .eq('tenant_id', tenantId).eq('is_current', true)
  if (exceptId) q = q.neq('id', exceptId)
  return q
}

// POST { name, starts_on, ends_on, is_current? }
export async function POST(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { caller } = auth
  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 120) return NextResponse.json({ error: 'الاسم مطلوب (حتى 120 حرفاً)' }, { status: 400 })
  const starts = validDate(body.starts_on)
  const ends = validDate(body.ends_on)
  if (!starts || !ends || ends <= starts) {
    return NextResponse.json({ error: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية' }, { status: 400 })
  }

  const admin = serviceClient()
  const isCurrent = body.is_current === true
  if (isCurrent) {
    const { error } = await clearCurrent(admin, caller.tenant_id)
    if (error) return NextResponse.json({ error: 'تعذّر الإنشاء' }, { status: 500 })
  }

  const { data, error } = await admin
    .from('academic_terms')
    .insert({ tenant_id: caller.tenant_id, name, starts_on: starts, ends_on: ends, is_current: isCurrent })
    .select(SELECT).single()
  if (error) {
    console.error('[api/academic/terms POST]', error)
    return NextResponse.json({ error: 'تعذّر الإنشاء' }, { status: 500 })
  }
  return NextResponse.json({ term: data }, { status: 201 })
}

// PATCH { id, name?, starts_on?, ends_on?, is_current? }
export async function PATCH(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { caller } = auth
  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (typeof body.id !== 'string') return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const admin = serviceClient()
  const { data: existing } = await admin
    .from('academic_terms').select('id, tenant_id, starts_on, ends_on, deleted_at').eq('id', body.id).maybeSingle()
  if (!existing || existing.tenant_id !== caller.tenant_id || existing.deleted_at) {
    return NextResponse.json({ error: 'غير موجود' }, { status: 404 })
  }

  const update: Record<string, unknown> = {}
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 120) return NextResponse.json({ error: 'الاسم مطلوب (حتى 120 حرفاً)' }, { status: 400 })
    update.name = name
  }
  if (body.starts_on !== undefined || body.ends_on !== undefined) {
    const starts = body.starts_on !== undefined ? validDate(body.starts_on) : existing.starts_on
    const ends = body.ends_on !== undefined ? validDate(body.ends_on) : existing.ends_on
    if (!starts || !ends || ends <= starts) {
      return NextResponse.json({ error: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية' }, { status: 400 })
    }
    update.starts_on = starts
    update.ends_on = ends
  }
  if (body.is_current !== undefined) update.is_current = body.is_current === true
  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  if (update.is_current === true) {
    const { error } = await clearCurrent(admin, caller.tenant_id, existing.id)
    if (error) return NextResponse.json({ error: 'تعذّر التحديث' }, { status: 500 })
  }

  const { data, error } = await admin
    .from('academic_terms').update(update).eq('id', existing.id).select(SELECT).single()
  if (error) {
    console.error('[api/academic/terms PATCH]', error)
    return NextResponse.json({ error: 'تعذّر التحديث' }, { status: 500 })
  }
  return NextResponse.json({ term: data })
}

// DELETE { id } — archive
export async function DELETE(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { caller } = auth
  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (typeof body.id !== 'string') return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const admin = serviceClient()
  const { data: existing } = await admin
    .from('academic_terms').select('id, tenant_id, deleted_at').eq('id', body.id).maybeSingle()
  if (!existing || existing.tenant_id !== caller.tenant_id || existing.deleted_at) {
    return NextResponse.json({ error: 'غير موجود' }, { status: 404 })
  }

  const { error } = await admin
    .from('academic_terms').update({ deleted_at: new Date().toISOString(), is_current: false }).eq('id', existing.id)
  if (error) {
    console.error('[api/academic/terms DELETE]', error)
    return NextResponse.json({ error: 'تعذّر الأرشفة' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
