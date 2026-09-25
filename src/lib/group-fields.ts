import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiErrorCode } from '@/lib/api-error'

// Optional group settings added by group_course_transfer_migration.sql:
// the course this group is a section of, a picture, a seat cap and the
// group's instructions shown to its students. Shared by POST/PATCH /api/groups.

export interface GroupFieldUpdate {
  course_id?: string | null
  image_url?: string | null
  max_students?: number | null
  instructions?: string | null
}

// `error` is an errors-namespace code; the route turns it into a message in
// the caller's language with apiErr().
type Parsed = { update: GroupFieldUpdate } | { error: ApiErrorCode }

/** Validate the optional fields present in a request body; absent keys are left untouched. */
export function parseGroupFields(body: Record<string, unknown>): Parsed {
  const update: GroupFieldUpdate = {}

  if ('course_id' in body) {
    const v = body.course_id
    if (v !== null && v !== '' && typeof v !== 'string') return { error: 'groupCourseInvalid' }
    update.course_id = v ? (v as string) : null
  }

  if ('image_url' in body) {
    const v = typeof body.image_url === 'string' ? body.image_url.trim() : ''
    if (v && (!/^https:\/\/\S+$/i.test(v) || v.length > 2000)) {
      return { error: 'groupImageUrlHttps' }
    }
    update.image_url = v || null
  }

  if ('max_students' in body) {
    const v = body.max_students
    if (v === null || v === '' || v === undefined) update.max_students = null
    else {
      const n = Number(v)
      if (!Number.isInteger(n) || n < 1 || n > 100000) return { error: 'groupMaxStudentsInvalid' }
      update.max_students = n
    }
  }

  if ('instructions' in body) {
    const v = typeof body.instructions === 'string' ? body.instructions.trim() : ''
    if (v.length > 2000) return { error: 'groupInstructionsTooLong' }
    update.instructions = v || null
  }

  return { update }
}

/** The linked course must exist in the caller's tenant (the DB trigger enforces it too). */
export async function courseInTenant(admin: SupabaseClient, tenantId: string, courseId: string | null | undefined) {
  if (!courseId) return true
  const { data } = await admin.from('courses').select('id').eq('id', courseId).eq('tenant_id', tenantId).maybeSingle()
  return !!data
}
