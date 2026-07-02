export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { SettingsClient } from './settings-client'
import { getInvitationDefaults, getAiRateLimits, getExamPolicies } from '@/lib/settings'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('id, full_name, email, role, created_at')
    .eq('id', user.id)
    .single()

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

  const invitationDefaults = await getInvitationDefaults(supabase)
  const aiRateLimits = await getAiRateLimits(supabase)
  const examPolicies = await getExamPolicies(supabase)

  return <SettingsClient profile={profile} config={config} invitationDefaults={invitationDefaults} aiRateLimits={aiRateLimits} examPolicies={examPolicies} />
}
