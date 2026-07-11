import { NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'

const PAGE_SIZE = 50

export async function GET(request: Request) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user || user.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const tenantId = searchParams.get('tenant_id')
  const role     = searchParams.get('role') ?? undefined
  const search   = searchParams.get('search') ?? ''
  const page     = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))

  if (!tenantId) return NextResponse.json({ error: 'tenant_id required' }, { status: 400 })

  let query = supabase
    .from('users')
    .select('id, full_name, email, role, is_active, created_at, tenant_id', { count: 'exact' })
    .eq('tenant_id', tenantId)

  if (role) query = query.eq('role', role)
  if (search) query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`)

  const from = (page - 1) * PAGE_SIZE
  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1)

  if (error) {
    console.error('[tenant-users]', error)
    return NextResponse.json({ error: 'Failed to load users' }, { status: 500 })
  }

  return NextResponse.json({ users: data ?? [], total: count ?? 0, page, pageSize: PAGE_SIZE })
}
