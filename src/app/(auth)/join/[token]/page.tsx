import { createClient as createAdminClient } from '@supabase/supabase-js'
import { JoinForm } from './join-form'

interface Props {
  params: Promise<{ token: string }>
}

const ROLE_LABELS: Record<string, string> = {
  university_admin: 'University Administrator',
  teacher:          'Teacher',
  student:          'Student',
}

type InvitationResult =
  | { email: string | null; role: string; tenant_name: string; expires_at: string; is_public: boolean; max_uses: number | null; use_count: number }
  | null

const ERROR_MESSAGES = {
  title: 'Invalid or Expired Invitation',
  body:  'This invitation link is invalid, has expired, or has already been fully used.',
  hint:  'Please contact your administrator for a new invitation.',
}

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

  if (!invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
        <div className="w-full max-w-md p-8 text-center bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl space-y-4">
          <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto">
            <span className="text-red-400 text-2xl">✕</span>
          </div>
          <h1 className="text-xl font-bold text-white">{ERROR_MESSAGES.title}</h1>
          <p className="text-slate-400 text-sm">{ERROR_MESSAGES.body}</p>
          <p className="text-slate-500 text-sm">{ERROR_MESSAGES.hint}</p>
          <a href="/login" className="inline-block mt-2 text-blue-400 hover:text-blue-300 text-sm underline">
            Already have an account? Sign in
          </a>
        </div>
      </div>
    )
  }

  const expiresLabel = new Date(invitation.expires_at).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  const accentColor = invitation.is_public ? 'purple' : 'blue'

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 p-4">
      <div className="w-full max-w-md space-y-6">

        {/* Header */}
        <div className="text-center">
          <div className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-${accentColor}-600 mb-4`}>
            <span className="text-white text-2xl font-bold">E</span>
          </div>
          <h1 className="text-2xl font-bold text-white">You&apos;re invited!</h1>
          <p className="text-slate-400 text-sm mt-1">
            Join <span className="text-white font-semibold">{invitation.tenant_name}</span> as a{' '}
            <span className={`text-${accentColor}-400 font-semibold`}>
              {ROLE_LABELS[invitation.role] ?? invitation.role}
            </span>
          </p>
        </div>

        {/* Invitation details card */}
        <div className={`bg-${accentColor}-500/10 border border-${accentColor}-500/20 rounded-xl px-5 py-4 space-y-1.5`}>
          {!invitation.is_public && invitation.email && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Invited email</span>
              <span className="text-white font-medium">{invitation.email}</span>
            </div>
          )}
          {invitation.is_public && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Link type</span>
              <span className="text-purple-400 font-medium">Open to anyone</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">University</span>
            <span className="text-white font-medium">{invitation.tenant_name}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Role</span>
            <span className="text-white font-medium">{ROLE_LABELS[invitation.role] ?? invitation.role}</span>
          </div>
          {invitation.is_public && invitation.max_uses != null && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Spots remaining</span>
              <span className="text-white font-medium">{invitation.max_uses - invitation.use_count}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Expires</span>
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
          Already have an account?{' '}
          <a href="/login" className="text-blue-400 hover:text-blue-300 underline">Sign in</a>
        </p>
      </div>
    </div>
  )
}
