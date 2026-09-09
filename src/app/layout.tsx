import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import { AuthProvider } from '@/components/shared/auth-provider'
import { Toaster } from '@/components/ui/toast'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })

export const metadata: Metadata = {
  title: 'EduQuest · Educational SaaS Platform',
  description: 'Multi-tenant educational platform with AI-powered learning tools',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} h-full`} suppressHydrationWarning translate="no">
      <body className="h-full">
        <AuthProvider>{children}</AuthProvider>
        <Toaster />
      </body>
    </html>
  )
}
