import { Resend } from 'resend'
import { getTranslations } from 'next-intl/server'
import { dirFor, type Locale } from '@/i18n/config'
import { getRoleLabel } from '@/lib/utils'
import type { Role } from '@/types'

// Set EMAIL_FROM in your env to your verified domain (e.g. "EduQuest <noreply@yourdomain.com>")
// The resend.dev address only delivers to the Resend account owner — not production-ready.
const FROM_EMAIL = process.env.EMAIL_FROM ?? 'EduQuest <onboarding@resend.dev>'
const APP_NAME   = 'EduQuest'

// Same pinning as src/lib/utils.ts: a bare 'ar' can render Arabic-Indic
// digits or a non-Gregorian calendar depending on the host's ICU build.
const DATE_LOCALE: Record<Locale, string> = {
  ar: 'ar-u-ca-gregory-nu-latn',
  en: 'en-GB-u-ca-gregory-nu-latn',
}

// Inviter and institution names are user-entered and land inside HTML.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function baseTemplate(content: string, locale: Locale, footer: string) {
  const dir = dirFor(locale)
  return `<!DOCTYPE html>
<html lang="${locale}" dir="${dir}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${APP_NAME}</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI','Tahoma',Arial,sans-serif;direction:${dir};">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:16px;overflow:hidden;border:1px solid #334155;">
          <!-- Header -->
          <tr>
            <td style="background:#2563eb;padding:32px 40px;text-align:center;">
              <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:12px;padding:12px 20px;">
                <span style="color:#fff;font-size:24px;font-weight:800;letter-spacing:-0.5px;">${APP_NAME}</span>
              </div>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #334155;text-align:center;">
              <p style="margin:0;color:#64748b;font-size:12px;">
                ${footer}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * Sends an invitation email in `locale` — the RECIPIENT's language, which the
 * caller decides (the invitee has no account yet, so the route picks the
 * institution's default, falling back to the inviter's). It is passed
 * explicitly because the request locale belongs to the sender.
 */
export async function sendInvitationEmail({
  to,
  role,
  tenantName,
  institutionType,
  joinUrl,
  expiresAt,
  inviterName,
  locale,
}: {
  to: string
  role: string
  tenantName: string | null
  institutionType?: string | null
  joinUrl: string
  expiresAt: string
  inviterName?: string
  locale: Locale
}) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set, skipping email')
    return
  }

  if (!process.env.EMAIL_FROM && process.env.NODE_ENV === 'production') {
    console.warn('[email] EMAIL_FROM not set, using resend.dev sandbox address which only delivers to the account owner. Set EMAIL_FROM to your verified domain.')
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const t = await getTranslations({ locale, namespace: 'email.invitation' })

  const institution = tenantName ?? t('fallbackInstitution')
  const roleLabel = getRoleLabel(role as Role, institutionType, locale) ?? role
  const expiry = new Intl.DateTimeFormat(DATE_LOCALE[locale], {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }).format(new Date(expiresAt))

  // Values are escaped here because t.markup inserts them verbatim.
  const safe = {
    inviter: escapeHtml(inviterName ?? ''),
    institution: escapeHtml(institution),
    role: escapeHtml(roleLabel),
  }
  const tags = {
    b: (chunks: string) => `<strong style="color:#e2e8f0;">${chunks}</strong>`,
    role: (chunks: string) => `<strong style="color:#60a5fa;">${chunks}</strong>`,
  }
  const intro = inviterName
    ? t.markup('invitedBy', { ...safe, ...tags })
    : t.markup('invited', { ...safe, ...tags })
  // Values inside table cells align to the far edge of the reading direction.
  const valueAlign = dirFor(locale) === 'rtl' ? 'left' : 'right'
  const arrow = dirFor(locale) === 'rtl' ? '←' : '→'

  const html = baseTemplate(`
    <h1 style="margin:0 0 8px;color:#f1f5f9;font-size:22px;font-weight:700;">${escapeHtml(t('title'))}</h1>
    <p style="margin:0 0 28px;color:#64748b;font-size:13px;">${escapeHtml(t('subtitle', { app: APP_NAME }))}</p>

    <p style="margin:0 0 24px;color:#94a3b8;font-size:15px;line-height:1.6;">${intro}</p>

    <div style="background:#0f172a;border-radius:12px;padding:24px;margin-bottom:28px;border:1px solid #334155;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="color:#64748b;font-size:13px;padding-bottom:12px;">${escapeHtml(t('platform'))}</td>
          <td style="color:#e2e8f0;font-size:13px;font-weight:600;text-align:${valueAlign};padding-bottom:12px;">${APP_NAME}</td>
        </tr>
        <tr>
          <td style="color:#64748b;font-size:13px;padding-bottom:12px;">${escapeHtml(t('institution'))}</td>
          <td style="color:#e2e8f0;font-size:13px;font-weight:600;text-align:${valueAlign};padding-bottom:12px;">${safe.institution}</td>
        </tr>
        <tr>
          <td style="color:#64748b;font-size:13px;padding-bottom:12px;">${escapeHtml(t('role'))}</td>
          <td style="color:#60a5fa;font-size:13px;font-weight:600;text-align:${valueAlign};padding-bottom:12px;">${safe.role}</td>
        </tr>
        <tr>
          <td style="color:#64748b;font-size:13px;">${escapeHtml(t('expires'))}</td>
          <td style="color:#fbbf24;font-size:13px;font-weight:600;text-align:${valueAlign};">${escapeHtml(expiry)}</td>
        </tr>
      </table>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td align="center">
          <a href="${escapeHtml(joinUrl)}"
             style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;
                    font-size:16px;font-weight:700;padding:14px 40px;border-radius:10px;
                    letter-spacing:0.3px;">
            ${escapeHtml(t('cta'))} ${arrow}
          </a>
        </td>
      </tr>
    </table>

    <p style="margin:0;color:#475569;font-size:12px;text-align:center;word-break:break-all;">
      ${escapeHtml(t('copyLink'))} <a href="${escapeHtml(joinUrl)}" style="color:#60a5fa;">${escapeHtml(joinUrl)}</a>
    </p>
  `, locale, `© ${new Date().getFullYear()} ${APP_NAME}. ${escapeHtml(t('rights'))}<br/>${escapeHtml(t('ignore'))}`)

  await resend.emails.send({
    from:    FROM_EMAIL,
    to,
    subject: t('subject', { institution, app: APP_NAME }),
    html,
  })
}
