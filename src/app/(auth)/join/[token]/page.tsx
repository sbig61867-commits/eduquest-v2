import { getLocale, getTranslations } from 'next-intl/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { AuthTopBar } from '@/components/public/auth-top-bar'
import { JoinForm } from './join-form'
import { checkSeatLimit, isSeatRole } from '@/lib/seat-limit'

// Invitation acceptance. Same public look (`.eq-public`, light/dark), shaped
// as an official invitation: a ticket with a perforated edge beside the
// registration form. Violet marks an open (public) link, blue a personal one.
// An invalid link shows the same ticket, greyed and stamped.

interface Props {
  params: Promise<{ token: string }>
}

type InvitationResult =
  | { email: string | null; role: string; tenant_name: string; expires_at: string; is_public: boolean; max_uses: number | null; use_count: number }
  | null

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function getInvitation(token: string): Promise<InvitationResult> {
  const { data, error } = await adminClient().rpc('get_invitation_by_token', { p_token: token })
  if (error) console.error('[join-page] RPC error:', error.message, error.code)
  if (!data) console.error('[join-page] RPC returned null for token:', token.slice(0, 8) + '…')
  return data as InvitationResult
}

/**
 * Why a still-valid link cannot be used right now: its institution is
 * suspended, or at its plan limit for the invited role. Shown instead of a
 * sign-up form that would only fail at the end (the accept route and the DB
 * trigger refuse it either way). Fails open — the refusal still happens there.
 */
async function closedReason(token: string): Promise<'full' | 'suspended' | null> {
  try {
    const admin = adminClient()
    const { data: inv } = await admin
      .from('invitations').select('tenant_id, role, tenants(is_active)').eq('token', token).maybeSingle()
    if (!inv) return null
    const tenant = inv.tenants as unknown as { is_active: boolean } | null
    if (tenant && tenant.is_active === false) return 'suspended'
    if (isSeatRole(inv.role) && !(await checkSeatLimit(admin, inv.tenant_id, inv.role)).allowed) return 'full'
  } catch (e) {
    console.error('[join-page] closed check failed:', e instanceof Error ? e.message : e)
  }
  return null
}

const ACCENT = {
  public: { band: 'from-violet-600/35 via-violet-600/10', chip: 'bg-violet-600 text-on-accent', text: 'text-violet-300', glow: 'bg-violet-500/15' },
  personal: { band: 'from-blue-600/35 via-blue-600/10', chip: 'bg-blue-600 text-on-accent', text: 'text-blue-300', glow: 'bg-blue-500/15' },
}

function Perforation() {
  return (
    <div aria-hidden="true" className="relative h-8">
      <span className="absolute inset-x-6 top-1/2 border-t-2 border-dashed border-slate-700" />
      <span className="absolute -start-4 top-0 w-8 h-8 rounded-full bg-slate-950 border border-slate-800" />
      <span className="absolute -end-4 top-0 w-8 h-8 rounded-full bg-slate-950 border border-slate-800" />
    </div>
  )
}

function Page({ glow, children }: { glow: string; children: React.ReactNode }) {
  return (
    <div className="eq-public relative min-h-screen bg-slate-950 overflow-hidden flex flex-col">
      <div aria-hidden="true" className={`absolute -top-40 start-1/4 w-[42rem] h-[42rem] rounded-full ${glow} blur-3xl`} />
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.05] [background-image:radial-gradient(var(--color-white)_1px,transparent_1px)] [background-size:22px_22px]"
      />
      <AuthTopBar className="px-4 sm:px-8 lg:px-12 py-5" />
      <main className="relative flex-1 flex items-center justify-center px-4 py-10">{children}</main>
    </div>
  )
}

export default async function JoinPage({ params }: Props) {
  const { token } = await params
  const [invitation, closed, t, locale] = await Promise.all([getInvitation(token), closedReason(token), getTranslations('auth'), getLocale()])

  if (!invitation || closed) {
    const copy = closed === 'full'
      ? { stamp: t('join.fullStamp'), title: t('join.fullTitle'), body: t('join.fullBody'), hint: t('join.fullHint') }
      : { stamp: t('join.invalidStamp'), title: t('join.invalidTitle'), body: t('join.invalidBody'), hint: t('join.invalidHint') }
    return (
      <Page glow="bg-red-500/10">
        <div className="w-full max-w-md text-center">
          <div className="relative">
          <div className="rounded-[1.75rem] border border-slate-800 bg-slate-900/80 backdrop-blur-xl shadow-2xl overflow-hidden grayscale opacity-80">
            <div className="px-8 pt-9 pb-6 bg-gradient-to-b from-slate-700/30 to-transparent">
              <p className="text-slate-500 text-xs font-semibold">{t('join.ticketLabel')}</p>
              <div aria-hidden="true" className="mt-4 mx-auto h-3 w-2/3 rounded bg-slate-700" />
              <div aria-hidden="true" className="mt-3 mx-auto h-2 w-1/3 rounded bg-slate-800" />
            </div>
            <Perforation />
            <div className="px-8 pb-9 pt-2 space-y-2" aria-hidden="true">
              <div className="h-2 rounded bg-slate-800" />
              <div className="h-2 w-4/5 mx-auto rounded bg-slate-800" />
            </div>
          </div>
            <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-12 px-5 py-2 rounded-xl border-4 border-red-400 text-red-300 text-2xl font-extrabold tracking-wider bg-slate-950/70">
              {copy.stamp}
            </span>
          </div>
          <h1 className="mt-9 text-2xl font-bold text-white">{copy.title}</h1>
          <p className="text-slate-400 text-sm mt-3 leading-relaxed">{copy.body}</p>
          <p className="text-slate-500 text-sm mt-1 leading-relaxed">{copy.hint}</p>
          <a href="/login" className="inline-block mt-7 px-6 py-3 rounded-xl border border-slate-700 hover:border-slate-500 text-slate-200 text-sm transition-colors">
            {t('join.hasAccount')} {t('join.signIn')}
          </a>
        </div>
      </Page>
    )
  }

  const expiresLabel = new Date(invitation.expires_at).toLocaleDateString(
    locale === 'ar' ? 'ar-u-ca-gregory-nu-latn' : 'en-GB',
    { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' },
  )

  // Resolve the role label: if the key exists in the auth.roles namespace use
  // the translation, otherwise fall back to the raw role string from the DB.
  const knownRoles = ['university_admin', 'teacher', 'student'] as const
  type KnownRole = typeof knownRoles[number]
  const isKnownRole = (r: string): r is KnownRole => (knownRoles as readonly string[]).includes(r)
  const roleLabel = isKnownRole(invitation.role)
    ? t(`roles.${invitation.role}`)
    : invitation.role

  const accent = invitation.is_public ? ACCENT.public : ACCENT.personal
  const details: { label: string; value: string | number; tone?: string }[] = [
    ...(!invitation.is_public && invitation.email ? [{ label: t('join.invitedEmail'), value: invitation.email }] : []),
    ...(invitation.is_public ? [{ label: t('join.linkType'), value: t('join.openToAll'), tone: accent.text }] : []),
    ...(invitation.is_public && invitation.max_uses != null ? [{ label: t('join.seatsLeft'), value: invitation.max_uses - invitation.use_count }] : []),
    { label: t('join.expires'), value: expiresLabel, tone: 'text-amber-300' },
  ]

  return (
    <Page glow={accent.glow}>
      <div className="w-full max-w-6xl grid lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] gap-8 lg:gap-14 items-center">
        {/* The invitation */}
        <div className="eq-float">
          <article className="rounded-[1.75rem] border border-slate-800 bg-slate-900/80 backdrop-blur-xl shadow-2xl overflow-hidden">
            <div className={`px-8 pt-9 pb-7 bg-gradient-to-b ${accent.band} to-transparent`}>
              <p className={`${accent.text} text-xs font-bold tracking-wide`}>{t('join.ticketLabel')}</p>
              <p className="text-slate-300 text-sm mt-4">{t('join.headline')}</p>
              <h1 className="text-white text-3xl font-extrabold mt-2 leading-snug break-words">{invitation.tenant_name}</h1>
              <span className={`inline-block mt-5 px-4 py-1.5 rounded-full text-sm font-semibold ${accent.chip}`}>{roleLabel}</span>
            </div>
            <Perforation />
            <dl className="px-8 pb-8 pt-2 space-y-3.5">
              {details.map(d => (
                <div key={d.label} className="flex items-center justify-between gap-4 text-sm">
                  <dt className="text-slate-500">{d.label}</dt>
                  <dd className={`font-medium text-end break-all ${d.tone ?? 'text-white'}`}>{d.value}</dd>
                </div>
              ))}
            </dl>
          </article>
        </div>

        {/* Registration */}
        <div>
          <JoinForm token={token} invitedEmail={invitation.email ?? ''} isPublic={invitation.is_public} />
          <p className="mt-6 text-center text-slate-500 text-sm">
            {t('join.hasAccount')}{' '}
            <a href="/login" className="text-blue-400 hover:text-blue-300 underline underline-offset-4">{t('join.signIn')}</a>
          </p>
        </div>
      </div>
    </Page>
  )
}
