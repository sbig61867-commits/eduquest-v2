export const dynamic = 'force-dynamic'

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { SettingsClient } from './settings-client'
import { getInvitationDefaults, getAiRateLimits, getExamPolicies, getDeletionPolicy } from '@/lib/settings'

export default async function SettingsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/login')

  const [{ data: profile }, invitationDefaults, aiRateLimits, examPolicies, deletionPolicy] = await Promise.all([
    supabase
      .from('users')
      .select('id, full_name, email, role, created_at')
      .eq('id', user.id)
      .single(),
    getInvitationDefaults(supabase),
    getAiRateLimits(supabase),
    getExamPolicies(supabase),
    getDeletionPolicy(supabase),
  ])

  // Configuration health — checked server-side, only booleans reach the client
  const isSet = (v: string | undefined, placeholder: string) => !!v && v !== placeholder
  const config = {
    groq: isSet(process.env.GROQ_API_KEY, 'your_groq_api_key_here'),
    gemini: isSet(process.env.GEMINI_API_KEY, 'your_gemini_api_key_here'),
    resend: !!process.env.RESEND_API_KEY,
    serviceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? null,
    serverProctoring: process.env.NEXT_PUBLIC_SERVER_PROCTORING === 'true',
  }

  return <SettingsClient profile={profile} config={config} invitationDefaults={invitationDefaults} aiRateLimits={aiRateLimits} examPolicies={examPolicies} deletionPolicy={deletionPolicy} />
}
