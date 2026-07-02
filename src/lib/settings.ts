import type { SupabaseClient } from '@supabase/supabase-js'

export interface AiRateLimits {
  lesson_per_hour: number
  exam_per_hour: number
}

export const FALLBACK_AI_RATE_LIMITS: AiRateLimits = {
  lesson_per_hour: 10,
  exam_per_hour: 20,
}

export async function getAiRateLimits(supabase: SupabaseClient): Promise<AiRateLimits> {
  const { data } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', 'ai_rate_limits')
    .maybeSingle()
  const v = (data?.value ?? {}) as Partial<AiRateLimits>
  return {
    lesson_per_hour: v.lesson_per_hour ?? FALLBACK_AI_RATE_LIMITS.lesson_per_hour,
    exam_per_hour: v.exam_per_hour ?? FALLBACK_AI_RATE_LIMITS.exam_per_hour,
  }
}

export interface ExamPolicies {
  proctoring_default_enabled: boolean
  violation_warning_threshold: number
}

export const FALLBACK_EXAM_POLICIES: ExamPolicies = {
  proctoring_default_enabled: false,
  violation_warning_threshold: 5,
}

export async function getExamPolicies(supabase: SupabaseClient): Promise<ExamPolicies> {
  const { data } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', 'exam_policies')
    .maybeSingle()
  const v = (data?.value ?? {}) as Partial<ExamPolicies>
  return {
    proctoring_default_enabled: v.proctoring_default_enabled ?? FALLBACK_EXAM_POLICIES.proctoring_default_enabled,
    violation_warning_threshold: v.violation_warning_threshold ?? FALLBACK_EXAM_POLICIES.violation_warning_threshold,
  }
}

export interface InvitationDefaults {
  university_admin: number
  teacher: number
  student: number
  max_expiry_hours: number
}

export const FALLBACK_INVITATION_DEFAULTS: InvitationDefaults = {
  university_admin: 72,
  teacher: 48,
  student: 168,
  max_expiry_hours: 720,
}

// Reads a platform setting with the caller's session client (RLS: any
// authenticated user can SELECT). Falls back silently so a missing row or
// un-applied migration never breaks the calling route.
export async function getInvitationDefaults(supabase: SupabaseClient): Promise<InvitationDefaults> {
  const { data } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', 'invitation_defaults')
    .maybeSingle()
  const v = (data?.value ?? {}) as Partial<InvitationDefaults>
  return {
    university_admin: v.university_admin ?? FALLBACK_INVITATION_DEFAULTS.university_admin,
    teacher: v.teacher ?? FALLBACK_INVITATION_DEFAULTS.teacher,
    student: v.student ?? FALLBACK_INVITATION_DEFAULTS.student,
    max_expiry_hours: v.max_expiry_hours ?? FALLBACK_INVITATION_DEFAULTS.max_expiry_hours,
  }
}
