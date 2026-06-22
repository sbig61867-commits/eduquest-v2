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
  | { email: string; role: string; tenant_name: string; expires_at: string }
  | { error: 'NOT_FOUND' | 'USED' | 'REVOKED' | 'EXPIRED' }

const ERROR_MESSAGES: Record<string, { title: string; body: string; hint?: string }> = {
  NOT_FOUND: {
    title: 'Invalid Invitation',
    body: 'This invitation link is invalid.',
  },
  USED: {
    title: 'Invitation Already Used',
    body: 'This invitation has already been used.',
    hint: 'If you already registered, please sign in.',
  },
  REVOKED: {
    title: 'Invitation Revoked',
    body: 'This invitation has been revoked.',
    hint: 'Please contact your administrator for a new invitation.',
  },
  EXPIRED: {
    title: 'Invitation Expired',
    body: 'This invitation link has expired. Please contact your administrator to request a new one.',
  },
}

async function getInvitation(token: string): Promise<InvitationResult | null> {
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const { data } = await admin.rpc('get_invitation_by_token', { p_token: token })
  return data as InvitationResult | null
}

export default async function JoinPage({ params }: Props) {
  const { token } = await params
  const result = await getInvitation(token)

  // ── Error / invalid ──
  if (!result || 'error' in result) {
    const code = result && 'error' in result ? result.error : 'NOT_FOUND'
    const msg = ERROR_MESSAGES[code] ?? ERROR_MESSAGES['NOT_FOUND']
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
        <div className="w-full max-w-md p-8 text-center bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl space-y-4">
          <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto">
            <span className="text-red-400 text-2xl">✕</span>
          </div>
          <h1 className="text-xl font-bold text-white">{msg.title}</h1>
          <p className="text-slate-400 text-sm">{msg.body}</p>
          {msg.hint && (
            <p className="text-slate-500 text-sm">{msg.hint}</p>
          )}
          <a
            href="/login"
            className="inline-block mt-2 text-blue-400 hover:text-blue-300 text-sm underline"
          >
            Already have an account? Sign in
          </a>
        </div>
      </div>
    )
  }

  const invitation = result

  const expiresDate = new Date(invitation.expires_at)
  const expiresLabel = expiresDate.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 p-4">
      <div className="w-full max-w-md space-y-6">

        {/* Header */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4">
            <span className="text-white text-2xl font-bold">E</span>
          </div>
          <h1 className="text-2xl font-bold text-white">You're invited!</h1>
          <p className="text-slate-400 text-sm mt-1">
            Join <span className="text-white font-semibold">{invitation.tenant_name}</span> as a{' '}
            <span className="text-blue-400 font-semibold">
              {ROLE_LABELS[invitation.role] ?? invitation.role}
            </span>
          </p>
        </div>

        {/* Invitation details card */}
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-5 py-4 space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Invited email</span>
            <span className="text-white font-medium">{invitation.email}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">University</span>
            <span className="text-white font-medium">{invitation.tenant_name}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Role</span>
            <span className="text-white font-medium">{ROLE_LABELS[invitation.role] ?? invitation.role}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Expires</span>
            <span className="text-amber-400 font-medium">{expiresLabel}</span>
          </div>
        </div>

        {/* Registration form */}
        <JoinForm token={token} invitedEmail={invitation.email} />

        <p className="text-center text-slate-500 text-xs">
          Already have an account?{' '}
          <a href="/login" className="text-blue-400 hover:text-blue-300 underline">Sign in</a>
        </p>
      </div>
    </div>
  )
}
