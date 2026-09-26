import { apiErr } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { can } from '@/lib/permissions'
import { getTenantSettings } from '@/lib/structure-mode'
import { canEditAnnouncement, canTargetUniversity, AUDIENCE_DENIED } from '@/lib/announcement-audience'

// GET /api/announcements/interested?id=… — the students who pressed
// "I'm interested" on one announcement, for its authors. Same gate as editing
// the announcement: `manage_announcements`, same tenant, and an author pinned
// to the centre cannot read an announcement that reaches university students.
// Read through the user session: announcement_events' SELECT policy already
// limits staff to their own tenant, and users are tenant-readable for staff.
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id, permissions').eq('id', user.id).single()
  if (!profile?.tenant_id || !can(profile.role, profile.permissions, 'manage_announcements')) {
    return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  }

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })

  const { data: ann } = await supabase
    .from('announcements').select('id, tenant_id, audience, center_students_only').eq('id', id).maybeSingle()
  if (!ann || ann.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ ...(await apiErr('announcementNotFound')) }, { status: 404 })
  }
  const mayTargetUniversity = !(await getTenantSettings(supabase, profile.tenant_id)).has_center
    || canTargetUniversity(profile.role, profile.permissions)
  if (!canEditAnnouncement(ann, mayTargetUniversity)) {
    return NextResponse.json({ ...(await apiErr(AUDIENCE_DENIED)) }, { status: 403 })
  }

  const { data: events, error } = await supabase
    .from('announcement_events')
    .select('student_id, created_at')
    .eq('announcement_id', id).eq('tenant_id', profile.tenant_id).eq('kind', 'interest')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ ...(await apiErr('announcementEventFailed')) }, { status: 503 })

  const ids = (events ?? []).map(e => e.student_id as string)
  const { data: people } = ids.length
    ? await supabase.from('users').select('id, full_name, email').eq('tenant_id', profile.tenant_id).in('id', ids)
    : { data: [] as { id: string; full_name: string; email: string }[] }
  const byId = new Map((people ?? []).map(p => [p.id, p]))

  return NextResponse.json({
    students: (events ?? []).map(e => ({
      id: e.student_id,
      full_name: byId.get(e.student_id)?.full_name ?? '',
      email: byId.get(e.student_id)?.email ?? '',
      at: e.created_at,
    })),
  })
}
