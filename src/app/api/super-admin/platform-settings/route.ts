import { NextResponse } from 'next/server'
import { apiErr } from '@/lib/api-error'
import { run } from '@/lib/db/sql'
import { ownerCaller, ownerGate } from '@/lib/owner-gate'

// The owner's platform settings (/super-admin/settings). Only these four keys,
// each with its own shape: a value stored under any other key, or a value out
// of range, is refused. The statement re-checks the owner's live role.

const int = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max
const bool = (v: unknown) => typeof v === 'boolean'

const SHAPES: Record<string, (v: Record<string, unknown>) => Record<string, unknown> | null> = {
  deletion_policy: v => (bool(v.hard_delete_enabled) ? { hard_delete_enabled: v.hard_delete_enabled } : null),
  ai_rate_limits: v => (int(v.lesson_per_hour, 1, 1000) && int(v.exam_per_hour, 1, 1000)
    ? { lesson_per_hour: v.lesson_per_hour, exam_per_hour: v.exam_per_hour } : null),
  exam_policies: v => (bool(v.proctoring_default_enabled) && int(v.violation_warning_threshold, 1, 100)
    ? { proctoring_default_enabled: v.proctoring_default_enabled, violation_warning_threshold: v.violation_warning_threshold } : null),
  invitation_defaults: v => (int(v.university_admin, 1, 8760) && int(v.teacher, 1, 8760) && int(v.student, 1, 8760) && int(v.max_expiry_hours, 1, 8760)
    ? { university_admin: v.university_admin, teacher: v.teacher, student: v.student, max_expiry_hours: v.max_expiry_hours } : null),
}

/** PUT { key, value } — save one platform setting (the owner only). */
export async function PUT(request: Request) {
  const me = await ownerCaller()
  if (!me) return NextResponse.json({ ...(await apiErr('unauthorized')) }, { status: 401 })
  const b = await request.json().catch(() => null) as { key?: unknown; value?: unknown } | null
  const shape = typeof b?.key === 'string' ? SHAPES[b.key] : undefined
  const raw = b?.value && typeof b.value === 'object' && !Array.isArray(b.value) ? b.value as Record<string, unknown> : null
  const value = shape && raw ? shape(raw) : null
  if (!shape || !value) return NextResponse.json({ ...(await apiErr('invalidData')) }, { status: 400 })
  const key = b!.key as string
  try {
    const [rows] = await run({ as: 'user', userId: me.id }, sql => [
      sql`insert into public.platform_settings (key, value, updated_at)
          select ${key}, ${sql.json(value as Parameters<typeof sql.json>[0])}, now() where ${ownerGate(sql, me.id)}
          on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at
          returning key`,
    ])
    return rows.length ? NextResponse.json({ ok: true }) : NextResponse.json({ ...(await apiErr('forbidden')) }, { status: 403 })
  } catch (e) {
    console.error('[super-admin/platform-settings PUT]', e instanceof Error ? e.message : e)
    return NextResponse.json({ ...(await apiErr('unexpected')) }, { status: 500 })
  }
}
