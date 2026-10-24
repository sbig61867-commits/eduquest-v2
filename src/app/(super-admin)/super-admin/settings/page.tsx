export const dynamic = 'force-dynamic'

import { currentUser } from '@/lib/auth/current'
import { run } from '@/lib/db/sql'
import { redirect } from 'next/navigation'
import { SettingsClient } from './settings-client'
import { invitationDefaultsAs, aiRateLimitsAs, examPoliciesAs, deletionPolicyAs } from '@/lib/super-admin-data'
import { PreferencesCard } from '@/components/shared/preferences-card'
import { PasswordCard } from '@/components/shared/account-settings'

export default async function SettingsPage() {
  const user = await currentUser()
  if (!user) redirect('/login')

  const [profiles, invitationDefaults, aiRateLimits, examPolicies, deletionPolicy] = await Promise.all([
    run({ as: 'user', userId: user.id }, sql => [
      sql`select id, full_name, email, role, created_at from public.users where id = ${user.id}`,
    ]).then(([rows]) => rows),
    invitationDefaultsAs(user.id),
    aiRateLimitsAs(user.id),
    examPoliciesAs(user.id),
    deletionPolicyAs(user.id),
  ])
  const profile = (profiles[0] ?? null) as unknown as Parameters<typeof SettingsClient>[0]['profile']

  // Configuration health — checked server-side, only booleans reach the client
  const isSet = (v: string | undefined, placeholder: string) => !!v && v !== placeholder
  const config = {
    groq: isSet(process.env.GROQ_API_KEY, 'your_groq_api_key_here'),
    gemini: isSet(process.env.GEMINI_API_KEY, 'your_gemini_api_key_here'),
    resend: !!process.env.RESEND_API_KEY,
    serviceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? null,
  }

  return (
    <div className="space-y-8">
      <PasswordCard />
      <PreferencesCard />
      <SettingsClient profile={profile} config={config} invitationDefaults={invitationDefaults} aiRateLimits={aiRateLimits} examPolicies={examPolicies} deletionPolicy={deletionPolicy} />
    </div>
  )
}
