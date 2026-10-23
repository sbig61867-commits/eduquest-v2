import { apiErr, type ApiErrorCode } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { run, maybeOne, type Sql } from '@/lib/db/sql'
import { loadAnnouncementAuthor, type AnnouncementAuthor } from '@/lib/announcement-author'
import { canEditAnnouncement, resolveAudience, AUDIENCE_DENIED } from '@/lib/announcement-audience'
import { isAllowedCtaUrl } from '@/lib/announcement-contact'

// Announcements are authored by staff holding `manage_announcements`
// (university_admin / center_manager, or super_admin) and surface on the
// student home page. The caller (live), the institution, the announcement
// being edited and the target groups are read in one unit; the write runs as
// app_service pinned to the caller's institution and repeats the live check.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

/** Group ids from the body: UUIDs only (anything else can never be one of the institution's groups). */
function groupIdsOf(body: Record<string, unknown>): string[] | null {
  if (!Array.isArray(body.group_ids)) return []
  const ids = body.group_ids as unknown[]
  return ids.every(g => typeof g === 'string' && UUID.test(g)) ? ids as string[] : null
}

/** The caller is still a live author of this institution (repeated inside every write). */
const liveAuthor = (sql: Sql, a: AnnouncementAuthor) =>
  sql`exists (select 1 from public.users where id = ${a.id} and tenant_id = ${a.tenant_id} and is_active is not false and role = ${a.role})`

const MAX_TITLE = 200
const MAX_BODY = 4000
const MAX_CTA = 60

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try { body = await request.json() } catch { body = {} }

  const groupIds = groupIdsOf(body)
  const auth = await loadAnnouncementAuthor({ groupIds: groupIds ?? [] })
  if ('error' in auth) return auth.error
  const caller = auth.author

  if (!Object.keys(body).length) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
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
  const groups = audience === 'groups' ? (groupIds ?? []) : []
  if (audience === 'groups' && (!groupIds || groups.length === 0 || auth.validGroups !== groups.length)) {
    return NextResponse.json({ ...(await apiErr('invalidGroups')) }, { status: 400 })
  }

  // One unit: the announcement, then its groups — written only while the
  // caller is still a live author of this institution; the groups are
  // re-checked against the institution. The id is chosen here so the group
  // rows can name it: the row-level check on announcement_groups looks the
  // announcement up, and a row inserted by the same statement is not yet
  // visible to it.
  const newId = crypto.randomUUID()
  try {
    const [rows] = await run({ as: 'service', tenantId: caller.tenant_id }, sql => [
      sql`insert into public.announcements (id, tenant_id, created_by, title, body, image_url, link_url, cta_label,
                                            audience, center_students_only, is_published, starts_at, ends_at,
                                            pinned, collect_interest)
          select ${newId}, ${caller.tenant_id}, ${caller.id}, ${title}, ${body.body ? String(body.body).trim() : null},
                 ${body.image_url ? String(body.image_url) : null}, ${body.link_url ? String(body.link_url) : null},
                 ${body.cta_label ? String(body.cta_label).trim() : null}, ${audience}, ${center_students_only},
                 ${body.is_published === true}, ${body.starts_at ? String(body.starts_at) : null},
                 ${body.ends_at ? String(body.ends_at) : null}, ${body.pinned === true}, ${body.collect_interest === true}
           where ${liveAuthor(sql, caller)}
          returning id`,
      ...(groups.length ? [
        sql`insert into public.announcement_groups (announcement_id, group_id)
            select a.id, gr.id from public.announcements a
              join public.groups gr on gr.tenant_id = a.tenant_id
               and gr.id in (select (jsonb_array_elements_text(${sql.json(groups)}))::uuid)
             where a.id = ${newId}`,
      ] : []),
    ])
    const created = maybeOne<{ id: string }>(rows)
    if (!created) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
    return NextResponse.json({ id: created.id }, { status: 201 })
  } catch (e) {
    console.error('[api/announcements POST]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('announcementCreateFailed')) }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  let body: Record<string, unknown>
  try { body = await request.json() } catch { body = {} }

  const id = String(body.id ?? '')
  const groupIds = groupIdsOf(body)
  const auth = await loadAnnouncementAuthor({ announcementId: UUID.test(id) ? id : undefined, groupIds: groupIds ?? [] })
  if ('error' in auth) return auth.error
  const caller = auth.author

  if (!Object.keys(body).length) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  if (!id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })

  const existing = auth.existing
  if (!existing) return NextResponse.json({ ...(await apiErr('announcementNotFound')) }, { status: 404 })
  // An author pinned to the centre may not take over an announcement that
  // reaches university students — publishing/hiding it included.
  if (!canEditAnnouncement(existing, caller.mayTargetUniversity)) {
    return NextResponse.json({ ...(await apiErr(AUDIENCE_DENIED)) }, { status: 403 })
  }

  const update: Record<string, unknown> = {}
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
  for (const f of ['body', 'image_url', 'link_url', 'cta_label', 'starts_at', 'ends_at'] as const) {
    if (body[f] !== undefined) update[f] = body[f] ? String(body[f]) : null
  }
  // Validate the effective window: merge any changed field(s) with the
  // existing row so a partial PATCH (e.g. only ends_at) is still checked
  // against the real start/end pair, not just the field(s) sent this call.
  const windowError = validateWindow(
    'starts_at' in update ? update.starts_at : existing.starts_at,
    'ends_at' in update ? update.ends_at : existing.ends_at,
  )
  if (windowError) return NextResponse.json({ ...(await apiErr(windowError)) }, { status: 400 })
  if (body.is_published !== undefined) update.is_published = body.is_published === true
  if (typeof body.pinned === 'boolean') update.pinned = body.pinned
  if (typeof body.collect_interest === 'boolean') update.collect_interest = body.collect_interest

  let groups: string[] | null = null   // null: the audience is not being changed
  if (body.audience !== undefined) {
    const decided = resolveAudience(body.audience, caller.mayTargetUniversity)
    if ('error' in decided) return NextResponse.json({ ...(await apiErr(decided.error)) }, { status: 403 })
    groups = decided.audience === 'groups' ? (groupIds ?? []) : []
    if (decided.audience === 'groups' && (!groupIds || groups.length === 0 || auth.validGroups !== groups.length)) {
      return NextResponse.json({ ...(await apiErr('invalidGroups')) }, { status: 400 })
    }
    update.audience = decided.audience
    update.center_students_only = decided.center_students_only
  }

  // One unit: the group set (when the audience changes) and the row, each only
  // while the caller is still a live author of this institution.
  const set = (k: string) => k in update
  try {
    const out = await run({ as: 'service', tenantId: caller.tenant_id }, sql => [
      ...(groups !== null ? [
        sql`delete from public.announcement_groups where announcement_id = ${id} and ${liveAuthor(sql, caller)}`,
        sql`insert into public.announcement_groups (announcement_id, group_id)
            select ${id}, gr.id from public.groups gr
             where gr.tenant_id = ${caller.tenant_id}
               and gr.id in (select (jsonb_array_elements_text(${sql.json(groups)}))::uuid)
               and ${liveAuthor(sql, caller)}`,
      ] : []),
      sql`update public.announcements set
            updated_at = now(),
            title = case when ${set('title')} then ${(update.title as string) ?? null}::text else title end,
            body = case when ${set('body')} then ${(update.body as string) ?? null}::text else body end,
            image_url = case when ${set('image_url')} then ${(update.image_url as string) ?? null}::text else image_url end,
            link_url = case when ${set('link_url')} then ${(update.link_url as string) ?? null}::text else link_url end,
            cta_label = case when ${set('cta_label')} then ${(update.cta_label as string) ?? null}::text else cta_label end,
            starts_at = case when ${set('starts_at')} then ${(update.starts_at as string) ?? null}::timestamptz else starts_at end,
            ends_at = case when ${set('ends_at')} then ${(update.ends_at as string) ?? null}::timestamptz else ends_at end,
            is_published = coalesce(${(update.is_published as boolean) ?? null}::boolean, is_published),
            pinned = coalesce(${(update.pinned as boolean) ?? null}::boolean, pinned),
            collect_interest = coalesce(${(update.collect_interest as boolean) ?? null}::boolean, collect_interest),
            audience = coalesce(${(update.audience as string) ?? null}::text, audience),
            center_students_only = coalesce(${(update.center_students_only as boolean) ?? null}::boolean, center_students_only)
          where id = ${id} and tenant_id = ${caller.tenant_id} and ${liveAuthor(sql, caller)}
          returning id`,
    ])
    if (!maybeOne(out[out.length - 1])) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  } catch (e) {
    console.error('[api/announcements PATCH]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('announcementUpdateFailed')) }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}

export async function DELETE(request: Request) {
  let body: { id?: string }
  try { body = await request.json() } catch { body = {} }
  const id = body.id ?? ''

  const auth = await loadAnnouncementAuthor({ announcementId: UUID.test(id) ? id : undefined })
  if ('error' in auth) return auth.error
  const caller = auth.author
  if (!id) return NextResponse.json({ ...(await apiErr('missingId')) }, { status: 400 })

  const existing = auth.existing
  if (!existing) return NextResponse.json({ ...(await apiErr('announcementNotFound')) }, { status: 404 })
  if (!canEditAnnouncement(existing, caller.mayTargetUniversity)) {
    return NextResponse.json({ ...(await apiErr(AUDIENCE_DENIED)) }, { status: 403 })
  }

  try {
    const [rows] = await run({ as: 'service', tenantId: caller.tenant_id }, sql => [
      sql`delete from public.announcements where id = ${id} and tenant_id = ${caller.tenant_id} and ${liveAuthor(sql, caller)}
          returning id`,
    ])
    if (!maybeOne(rows)) return NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  } catch (e) {
    console.error('[api/announcements DELETE]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('announcementDeleteFailed')) }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
