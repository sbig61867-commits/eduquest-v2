import { apiErr, type ApiErrorCode } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { can } from '@/lib/permissions'
import { getTenantSettings } from '@/lib/structure-mode'
import {
  canEditAnnouncement, canTargetUniversity, resolveAudience, AUDIENCE_DENIED,
} from '@/lib/announcement-audience'
import { isAllowedCtaUrl } from '@/lib/announcement-contact'

// Announcements are authored by staff holding `manage_announcements`
// (university_admin / center_manager, or super_admin) and surface on the
// student home page. Auth + capability are checked with the user session;
// the writes run through the service-role client, matching the codebase's
// privileged-write pattern.
function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

interface Caller {
  id: string
  role: string
  tenant_id: string
  permissions: Record<string, boolean> | null
  /** Holds `announce_to_university` — may reach beyond the centre's students. */
  mayTargetUniversity: boolean
}

async function authorize(): Promise<{ caller: Caller } | { error: NextResponse }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id, permissions').eq('id', user.id).single()

  if (!profile?.tenant_id || !can(profile.role, profile.permissions, 'manage_announcements')) {
    return { error: NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 }) }
  }
  return {
    caller: {
      id: user.id,
      role: profile.role,
      tenant_id: profile.tenant_id,
      permissions: profile.permissions,
      // No centre ⇒ a single student population, so nothing to restrict.
      mayTargetUniversity: !(await getTenantSettings(supabase, profile.tenant_id)).has_center
        || canTargetUniversity(profile.role, profile.permissions),
    },
  }
}

/** Verify every supplied group id belongs to the caller's tenant. */
async function validateGroups(admin: ReturnType<typeof adminClient>, tenantId: string, groupIds: string[]) {
  if (groupIds.length === 0) return false
  const { data } = await admin.from('groups').select('id').eq('tenant_id', tenantId).in('id', groupIds)
  return (data ?? []).length === groupIds.length
}

/** Only accept image URLs actually hosted in our own public bucket. */
function isOwnBucketImage(url: string): boolean {
  try {
    const base = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!)
    const u = new URL(url)
    return u.protocol === 'https:' && u.host === base.host &&
      u.pathname.includes('/storage/v1/object/public/announcement-images/')
  } catch { return false }
}

/** starts_at/ends_at must be valid ISO instants, end strictly after start. */
function validateWindow(startsAt: unknown, endsAt: unknown): ApiErrorCode | null {
  const start = startsAt ? new Date(String(startsAt)) : null
  const end = endsAt ? new Date(String(endsAt)) : null
  if (start && isNaN(start.getTime())) return 'invalidStartDate'
  if (end && isNaN(end.getTime())) return 'invalidEndDate'
  if (start && end && end.getTime() <= start.getTime()) return 'endBeforeStart'
  return null
}

const MAX_TITLE = 200
const MAX_BODY = 4000
const MAX_CTA = 60

export async function POST(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { caller } = auth

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const title = String(body.title ?? '').trim()
  if (!title) return NextResponse.json({ ...(await apiErr('titleRequired')) }, { status: 400 })
  if (title.length > MAX_TITLE) return NextResponse.json({ ...(await apiErr('titleTooLong')) }, { status: 400 })
  if (body.body && String(body.body).length > MAX_BODY) return NextResponse.json({ ...(await apiErr('textTooLong')) }, { status: 400 })
  if (body.cta_label && String(body.cta_label).length > MAX_CTA) return NextResponse.json({ ...(await apiErr('ctaTooLong')) }, { status: 400 })

  if (body.link_url && !isAllowedCtaUrl(String(body.link_url))) {
    return NextResponse.json({ ...(await apiErr('ctaUrlScheme')) }, { status: 400 })
  }

  if (body.image_url && !isOwnBucketImage(String(body.image_url))) {
    return NextResponse.json({ ...(await apiErr('imageMustUpload')) }, { status: 400 })
  }

  const windowError = validateWindow(body.starts_at, body.ends_at)
  if (windowError) return NextResponse.json({ ...(await apiErr(windowError)) }, { status: 400 })

  // The audience — and whether this announcement is pinned to centre students —
  // is decided from the caller's capability, never taken from the request body.
  const decided = resolveAudience(body.audience, caller.mayTargetUniversity)
  if ('error' in decided) return NextResponse.json({ ...(await apiErr(decided.error)) }, { status: 403 })
  const { audience, center_students_only } = decided
  const groupIds = Array.isArray(body.group_ids) ? (body.group_ids as string[]) : []

  const admin = adminClient()
  if (audience === 'groups' && !(await validateGroups(admin, caller.tenant_id, groupIds))) {
    return NextResponse.json({ ...(await apiErr('invalidGroups')) }, { status: 400 })
  }

  const { data: created, error } = await admin
    .from('announcements')
    .insert({
      tenant_id: caller.tenant_id,
      created_by: caller.id,
      title,
      body: body.body ? String(body.body).trim() : null,
      image_url: body.image_url ? String(body.image_url) : null,
      link_url: body.link_url ? String(body.link_url) : null,
      cta_label: body.cta_label ? String(body.cta_label).trim() : null,
      audience,
      center_students_only,
      is_published: body.is_published === true,
      starts_at: body.starts_at ? String(body.starts_at) : null,
      ends_at: body.ends_at ? String(body.ends_at) : null,
      // Columns from announcement_engagement_migration.sql. Only sent when
      // switched on, so creating a plain announcement keeps working on a
      // database where that migration is not applied yet.
      ...(body.pinned === true ? { pinned: true } : {}),
      ...(body.collect_interest === true ? { collect_interest: true } : {}),
    })
    .select('id')
    .single()

  if (error || !created) {
    console.error('[api/announcements POST]', error)
    return NextResponse.json({ ...(await apiErr('announcementCreateFailed')) }, { status: 500 })
  }

  if (audience === 'groups' && groupIds.length > 0) {
    await admin.from('announcement_groups')
      .insert(groupIds.map(g => ({ announcement_id: created.id, group_id: g })))
  }

  return NextResponse.json({ id: created.id }, { status: 201 })
}

export async function PATCH(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { caller } = auth

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }

  const id = String(body.id ?? '')
  if (!id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })

  const admin = adminClient()
  const { data: existing } = await admin
    .from('announcements')
    .select('id, tenant_id, audience, center_students_only')
    .eq('id', id).single()
  if (!existing || existing.tenant_id !== caller.tenant_id) {
    return NextResponse.json({ ...(await apiErr('announcementNotFound')) }, { status: 404 })
  }
  // An author pinned to the centre may not take over an announcement that
  // reaches university students — publishing/hiding it included.
  if (!canEditAnnouncement(existing, caller.mayTargetUniversity)) {
    return NextResponse.json({ ...(await apiErr(AUDIENCE_DENIED)) }, { status: 403 })
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.title !== undefined) {
    const t = String(body.title).trim()
    if (!t) return NextResponse.json({ ...(await apiErr('titleRequired')) }, { status: 400 })
    if (t.length > MAX_TITLE) return NextResponse.json({ ...(await apiErr('titleTooLong')) }, { status: 400 })
    update.title = t
  }
  if (body.body !== undefined && body.body && String(body.body).length > MAX_BODY) {
    return NextResponse.json({ ...(await apiErr('textTooLong')) }, { status: 400 })
  }
  if (body.cta_label !== undefined && body.cta_label && String(body.cta_label).length > MAX_CTA) {
    return NextResponse.json({ ...(await apiErr('ctaTooLong')) }, { status: 400 })
  }
  if (body.link_url !== undefined && body.link_url && !isAllowedCtaUrl(String(body.link_url))) {
    return NextResponse.json({ ...(await apiErr('ctaUrlScheme')) }, { status: 400 })
  }
  if (body.image_url !== undefined && body.image_url && !isOwnBucketImage(String(body.image_url))) {
    return NextResponse.json({ ...(await apiErr('imageMustUpload')) }, { status: 400 })
  }
  for (const f of ['body', 'image_url', 'link_url', 'cta_label'] as const) {
    if (body[f] !== undefined) update[f] = body[f] ? String(body[f]) : null
  }
  for (const f of ['starts_at', 'ends_at'] as const) {
    if (body[f] !== undefined) update[f] = body[f] ? String(body[f]) : null
  }
  {
    // Validate the effective window: merge any changed field(s) with the
    // existing row so a partial PATCH (e.g. only ends_at) is still checked
    // against the real start/end pair, not just the field(s) sent this call.
    const { data: currentRow } = await admin
      .from('announcements').select('starts_at, ends_at').eq('id', id).single()
    const effectiveStart = 'starts_at' in update ? update.starts_at : currentRow?.starts_at ?? null
    const effectiveEnd = 'ends_at' in update ? update.ends_at : currentRow?.ends_at ?? null
    const windowError = validateWindow(effectiveStart, effectiveEnd)
    if (windowError) return NextResponse.json({ ...(await apiErr(windowError)) }, { status: 400 })
  }
  if (body.is_published !== undefined) update.is_published = body.is_published === true
  // The manager only sends these once the engagement migration is applied.
  if (typeof body.pinned === 'boolean') update.pinned = body.pinned
  if (typeof body.collect_interest === 'boolean') update.collect_interest = body.collect_interest

  if (body.audience !== undefined) {
    const decided = resolveAudience(body.audience, caller.mayTargetUniversity)
    if ('error' in decided) return NextResponse.json({ ...(await apiErr(decided.error)) }, { status: 403 })
    const { audience } = decided
    const groupIds = Array.isArray(body.group_ids) ? (body.group_ids as string[]) : []
    if (audience === 'groups' && !(await validateGroups(admin, caller.tenant_id, groupIds))) {
      return NextResponse.json({ ...(await apiErr('invalidGroups')) }, { status: 400 })
    }
    update.audience = audience
    update.center_students_only = decided.center_students_only
    await admin.from('announcement_groups').delete().eq('announcement_id', id)
    if (audience === 'groups' && groupIds.length > 0) {
      await admin.from('announcement_groups')
        .insert(groupIds.map(g => ({ announcement_id: id, group_id: g })))
    }
  }

  const { error } = await admin.from('announcements').update(update).eq('id', id)
  if (error) {
    console.error('[api/announcements PATCH]', error)
    return NextResponse.json({ ...(await apiErr('announcementUpdateFailed')) }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}

export async function DELETE(request: Request) {
  const auth = await authorize()
  if ('error' in auth) return auth.error
  const { caller } = auth

  let body: { id?: string }
  try { body = await request.json() } catch { return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 }) }
  if (!body.id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })

  const admin = adminClient()
  const { data: existing } = await admin
    .from('announcements')
    .select('id, tenant_id, audience, center_students_only')
    .eq('id', body.id).single()
  if (!existing || existing.tenant_id !== caller.tenant_id) {
    return NextResponse.json({ ...(await apiErr('announcementNotFound')) }, { status: 404 })
  }
  if (!canEditAnnouncement(existing, caller.mayTargetUniversity)) {
    return NextResponse.json({ ...(await apiErr(AUDIENCE_DENIED)) }, { status: 403 })
  }

  const { error } = await admin.from('announcements').delete().eq('id', body.id)
  if (error) {
    console.error('[api/announcements DELETE]', error)
    return NextResponse.json({ ...(await apiErr('announcementDeleteFailed')) }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
