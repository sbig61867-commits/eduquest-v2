import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { AlertTriangle } from 'lucide-react'
import { ScopedIntlProvider } from '@/i18n/provider'
import { verifySecondCameraToken } from '@/lib/second-camera-token'
import { CamClient } from './cam-client'

// The page a student's phone opens from the QR code on the exam page. Public
// (no sign-in: the signed token is the credential), never indexed.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function SecondCameraPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const valid = verifySecondCameraToken(decodeURIComponent(token))
  const t = await getTranslations('student.secondCamera')

  if (!valid) {
    return (
      <main className="min-h-screen bg-slate-950 text-white p-6 flex items-center justify-center">
        <div className="max-w-sm text-center space-y-3">
          <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto" />
          <p className="text-slate-300">{t('invalidLink')}</p>
        </div>
      </main>
    )
  }

  return (
    <ScopedIntlProvider namespaces={['common', 'student']}>
      <CamClient token={decodeURIComponent(token)} />
    </ScopedIntlProvider>
  )
}
