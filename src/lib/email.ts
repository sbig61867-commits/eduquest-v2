import { Resend } from 'resend'

// Set EMAIL_FROM in your env to your verified domain (e.g. "EduQuest <noreply@yourdomain.com>")
// The resend.dev address only delivers to the Resend account owner — not production-ready.
const FROM_EMAIL = process.env.EMAIL_FROM ?? 'EduQuest <onboarding@resend.dev>'
const APP_NAME   = 'EduQuest'

const ROLE_LABELS: Record<string, string> = {
  university_admin: 'مدير المؤسسة',
  teacher:          'معلم',
  student:          'طالب',
}

function baseTemplate(content: string) {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${APP_NAME}</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI','Tahoma',Arial,sans-serif;direction:rtl;">
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
                © ${new Date().getFullYear()} ${APP_NAME}. جميع الحقوق محفوظة.<br/>
                إن لم تطلب هذه الدعوة، يمكنك تجاهل هذه الرسالة بأمان.
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

export async function sendInvitationEmail({
  to,
  role,
  tenantName,
  joinUrl,
  expiresAt,
  inviterName,
}: {
  to: string
  role: string
  tenantName: string
  joinUrl: string
  expiresAt: string
  inviterName?: string
}) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set, skipping email')
    return
  }

  if (!process.env.EMAIL_FROM && process.env.NODE_ENV === 'production') {
    console.warn('[email] EMAIL_FROM not set, using resend.dev sandbox address which only delivers to the account owner. Set EMAIL_FROM to your verified domain.')
  }

  const resend = new Resend(process.env.RESEND_API_KEY)

  const roleLabel = ROLE_LABELS[role] ?? role
  const expiry    = new Date(expiresAt).toLocaleDateString('ar', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
  const inviterLine = inviterName
    ? `<p style="margin:0 0 24px;color:#94a3b8;font-size:15px;line-height:1.6;">
         دعاك <strong style="color:#e2e8f0;">${inviterName}</strong> للانضمام إلى
         <strong style="color:#e2e8f0;">${tenantName}</strong> بصفة
         <strong style="color:#60a5fa;">${roleLabel}</strong>.
       </p>`
    : `<p style="margin:0 0 24px;color:#94a3b8;font-size:15px;line-height:1.6;">
         تمت دعوتك للانضمام إلى <strong style="color:#e2e8f0;">${tenantName}</strong> بصفة
         <strong style="color:#60a5fa;">${roleLabel}</strong>.
       </p>`

  const html = baseTemplate(`
    <h1 style="margin:0 0 8px;color:#f1f5f9;font-size:22px;font-weight:700;">تمت دعوتك!</h1>
    <p style="margin:0 0 28px;color:#64748b;font-size:13px;">دعوة إلى ${APP_NAME}</p>

    ${inviterLine}

    <div style="background:#0f172a;border-radius:12px;padding:24px;margin-bottom:28px;border:1px solid #334155;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="color:#64748b;font-size:13px;padding-bottom:12px;">المنصة</td>
          <td style="color:#e2e8f0;font-size:13px;font-weight:600;text-align:left;padding-bottom:12px;">${APP_NAME}</td>
        </tr>
        <tr>
          <td style="color:#64748b;font-size:13px;padding-bottom:12px;">المؤسسة</td>
          <td style="color:#e2e8f0;font-size:13px;font-weight:600;text-align:left;padding-bottom:12px;">${tenantName}</td>
        </tr>
        <tr>
          <td style="color:#64748b;font-size:13px;padding-bottom:12px;">الدور</td>
          <td style="color:#60a5fa;font-size:13px;font-weight:600;text-align:left;padding-bottom:12px;">${roleLabel}</td>
        </tr>
        <tr>
          <td style="color:#64748b;font-size:13px;">تنتهي في</td>
          <td style="color:#fbbf24;font-size:13px;font-weight:600;text-align:left;">${expiry}</td>
        </tr>
      </table>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td align="center">
          <a href="${joinUrl}"
             style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;
                    font-size:16px;font-weight:700;padding:14px 40px;border-radius:10px;
                    letter-spacing:0.3px;">
            قبول الدعوة ←
          </a>
        </td>
      </tr>
    </table>

    <p style="margin:0;color:#475569;font-size:12px;text-align:center;word-break:break-all;">
      أو انسخ هذا الرابط: <a href="${joinUrl}" style="color:#60a5fa;">${joinUrl}</a>
    </p>
  `)

  await resend.emails.send({
    from:    FROM_EMAIL,
    to,
    subject: `دعوة للانضمام إلى ${tenantName} على ${APP_NAME}`,
    html,
  })
}
