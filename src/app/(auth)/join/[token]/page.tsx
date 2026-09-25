import { getTranslations } from 'next-intl/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { JoinForm } from './join-form'

interface Props {
  params: Promise<{ token: string }>
}

type InvitationResult =
  | { email: string | null; role: string; tenant_name: string; expires_at: string; is_public: boolean; max_uses: number | null; use_count: number }
  | null

async function getInvitation(token: string): Promise<InvitationResult> {
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const { data, error } = await admin.rpc('get_invitation_by_token', { p_token: token })
  if (error) console.error('[join-page] RPC error:', error.message, error.code)
  if (!data) console.error('[join-page] RPC returned null for token:', token.slice(0, 8) + '…')
  return data as InvitationResult
}

export default async function JoinPage({ params }: Props) {
  const { token } = await params
  const invitation = await getInvitation(token)
  const t = await getTranslations('auth')

  if (!invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
        <div className="w-full max-w-md p-8 text-center bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl space-y-4">
          <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto">
            <span className="text-red-400 text-2xl">✕</span>
          </div>
          <h1 className="text-xl font-bold text-white">{t('join.invalidTitle')}</h1>
          <p className="text-slate-400 text-sm">{t('join.invalidBody')}</p>
          <p className="text-slate-500 text-sm">{t('join.invalidHint')}</p>
          <a href="/login" className="inline-block mt-2 text-blue-400 hover:text-blue-300 text-sm underline">
            {t('join.hasAccount')} {t('join.signIn')}
          </a>
        </div>
      </div>
    )
  }

  const expiresLabel = new Date(invitation.expires_at).toLocaleDateString('ar-u-ca-gregory-nu-latn', {
    month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  // Resolve the role label: if the key exists in the auth.roles namespace use
  // the translation, otherwise fall back to the raw role string from the DB.
  const knownRoles = ['university_admin', 'teacher', 'student'] as const
  type KnownRole = typeof knownRoles[number]
  const isKnownRole = (r: string): r is KnownRole => (knownRoles as readonly string[]).includes(r)
  const roleLabel = isKnownRole(invitation.role)
    ? t(`roles.${invitation.role}`)
    : invitation.role

  const accentColor = invitation.is_public ? 'purple' : 'blue'

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 p-4">
      <div className="w-full max-w-md space-y-6">

        {/* Header */}
        <div className="text-center">
          <div className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-${accentColor}-600 mb-4`}>
            <span className="text-white text-2xl font-bold">E</span>
          </div>
          <h1 className="text-2xl font-bold text-white">{t('join.invited')}</h1>
          <p className="text-slate-400 text-sm mt-1">
            {t('join.subtitle', { institution: invitation.tenant_name, role: roleLabel })}
          </p>
        </div>

        {/* Invitation details card */}
        <div className={`bg-${accentColor}-500/10 border border-${accentColor}-500/20 rounded-xl px-5 py-4 space-y-1.5`}>
          {!invitation.is_public && invitation.email && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">{t('join.invitedEmail')}</span>
              <span className="text-white font-medium">{invitation.email}</span>
            </div>
          )}
          {invitation.is_public && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">{t('join.linkType')}</span>
              <span className="text-purple-400 font-medium">{t('join.openToAll')}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">{t('join.institution')}</span>
            <span className="text-white font-medium">{invitation.tenant_name}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">{t('join.role')}</span>
            <span className="text-white font-medium">{roleLabel}</span>
          </div>
          {invitation.is_public && invitation.max_uses != null && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">{t('join.seatsLeft')}</span>
              <span className="text-white font-medium">{invitation.max_uses - invitation.use_count}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">{t('join.expires')}</span>
            <span className="text-amber-400 font-medium">{expiresLabel}</span>
          </div>
        </div>

        {/* Registration form */}
        <JoinForm
          token={token}
          invitedEmail={invitation.email ?? ''}
          isPublic={invitation.is_public}
        />

        <p className="text-center text-slate-500 text-xs">
          {t('join.hasAccount')}{' '}
          <a href="/login" className="text-blue-400 hover:text-blue-300 underline">{t('join.signIn')}</a>
        </p>
      </div>
    </div>
  )
}
