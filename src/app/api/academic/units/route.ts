import { NextResponse } from 'next/server'
import { getCaller, serviceClient, staffCan } from '@/lib/staff-auth'
import { getTenantStructureMode } from '@/lib/structure-mode'

// Academic units (level 1 = faculty/stage/track…, level 2 = department/grade…).
// Capability `manage_academic_structure` is checked with the user session, then
// the write runs on the service-role client — the tables have a SELECT policy
// only (academic_structure_migration.sql). The DB triggers additionally reject
// any cross-tenant parent, so the tenant check here is defence in depth.

async function authorize() {
  const res = await getCaller()
  if ('error' in res) return res
  if (!staffCan(res.caller, 'manage_academic_structure')) {
    return { error: NextResponse.json({ error: 'ممنوع' }, { status: 403 }) }
  }
  // Tenants on the original ('flat') structure can't touch this at all.
  if ((await getTenantStructureMode(serviceClient(), res.caller.tenant_id)) !== 'academic') {
    return { error: NextResponse.json({ error: 'الهيكل الأكاديمي غير مفعّل لمؤسستك' }, { status: 409 }) }
  }
  return res
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try { return await request.json() } catch { return null }
}

function cleanName(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s.length >= 1 && s.length <= 120 ? s : null
}

function cleanCode(v: unknown): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const s = String(v).trim()
  return s.length <= 30 ? s : undefined
}

// POST { name, code?, parent_id? } — parent_id makes it a level-2 unit
export async function POST(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { caller } = auth
  const body = await readBody(request)
  if (!body) return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })

  const name = cleanName(body.name)
  if (!name) return NextResponse.json({ error: 'الاسم مطلوب (حتى 120 حرفاً)' }, { status: 400 })
  const code = cleanCode(body.code)
  if (code === undefined && body.code !== undefined) {
    return NextResponse.json({ error: 'الرمز طويل جداً' }, { status: 400 })
  }

  const admin = serviceClient()
  const parentId = typeof body.parent_id === 'string' && body.parent_id ? body.parent_id : null
  if (parentId) {
    const { data: parent } = await admin
      .from('academic_units').select('id, tenant_id, level, deleted_at').eq('id', parentId).maybeSingle()
    if (!parent || parent.tenant_id !== caller.tenant_id || parent.deleted_at) {
      return NextResponse.json({ error: 'الوحدة الأم غير موجودة' }, { status: 404 })
    }
    if (parent.level !== 1) {
      return NextResponse.json({ error: 'لا يمكن إضافة مستوى ثالث' }, { status: 400 })
    }
  }

  const { data, error } = await admin
    .from('academic_units')
    .insert({
      tenant_id: caller.tenant_id,
      parent_id: parentId,
      level: parentId ? 2 : 1,
      name,
      code: code ?? null,
      sort_order: Number.isInteger(body.sort_order) ? body.sort_order : 0,
    })
    .select('id, parent_id, level, name, code, sort_order')
    .single()
  if (error) {
    console.error('[api/academic/units POST]', error)
    return NextResponse.json({ error: 'تعذّر الإنشاء' }, { status: 500 })
  }
  return NextResponse.json({ unit: data }, { status: 201 })
}

// PATCH { id, name?, code?, sort_order? } — the parent is never re-assigned
export async function PATCH(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { caller } = auth
  const body = await readBody(request)
  if (!body || typeof body.id !== 'string') return NextResponse.json({ error: 'المعرّف مفقود' }, { status: 400 })

  const admin = serviceClient()
  const { data: existing } = await admin
    .from('academic_units').select('id, tenant_id, deleted_at').eq('id', body.id).maybeSingle()
  if (!existing || existing.tenant_id !== caller.tenant_id || existing.deleted_at) {
    return NextResponse.json({ error: 'غير موجود' }, { status: 404 })
  }

  const update: Record<string, unknown> = {}
  if (body.name !== undefined) {
    const name = cleanName(body.name)
    if (!name) return NextResponse.json({ error: 'الاسم مطلوب (حتى 120 حرفاً)' }, { status: 400 })
    update.name = name
  }
  if (body.code !== undefined) {
    const code = cleanCode(body.code)
    if (code === undefined) return NextResponse.json({ error: 'الرمز طويل جداً' }, { status: 400 })
    update.code = code
  }
  if (body.sort_order !== undefined) {
    if (!Number.isInteger(body.sort_order)) return NextResponse.json({ error: 'ترتيب غير صالح' }, { status: 400 })
    update.sort_order = body.sort_order
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'لا يوجد ما يُحدَّث' }, { status: 400 })

  const { data, error } = await admin
    .from('academic_units').update(update).eq('id', body.id)
    .select('id, parent_id, level, name, code, sort_order').single()
  if (error) {
    console.error('[api/academic/units PATCH]', error)
    return NextResponse.json({ error: 'تعذّر التحديث' }, { status: 500 })
  }
  return NextResponse.json({ unit: data })
}

// DELETE { id } — archives (soft delete) the unit and its children; links on
// groups/courses stay in place and simply stop resolving in the UI.
export async function DELETE(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { caller } = auth
  const body = await readBody(request)
  if (!body || typeof body.id !== 'string') return NextResponse.json({ error: 'المعرّف مفقود' }, { status: 400 })

  const admin = serviceClient()
  const { data: existing } = await admin
    .from('academic_units').select('id, tenant_id, deleted_at').eq('id', body.id).maybeSingle()
  if (!existing || existing.tenant_id !== caller.tenant_id || existing.deleted_at) {
    return NextResponse.json({ error: 'غير موجود' }, { status: 404 })
  }

  const now = new Date().toISOString()
  const { error } = await admin
    .from('academic_units').update({ deleted_at: now })
    .eq('tenant_id', caller.tenant_id)
    // existing.id came back from the DB (a real UUID), never the raw body — no filter injection
    .or(`id.eq.${existing.id},parent_id.eq.${existing.id}`)
    .is('deleted_at', null)
  if (error) {
    console.error('[api/academic/units DELETE]', error)
    return NextResponse.json({ error: 'تعذّر الأرشفة' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
