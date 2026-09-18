import Link from 'next/link'
import { Compass, Home } from 'lucide-react'

export const metadata = {
  title: 'Page not found · EduQuest',
}

/**
 * Root 404. Reached both by unmatched URLs and by any notFound() call inside a
 * route group, so it must stand on its own without a sidebar or role context.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas bg-[radial-gradient(ellipse_at_top,var(--color-accent-subtle),var(--color-canvas)_60%)] p-4">
      <div className="w-full max-w-md p-8 space-y-5 bg-elevated border border-border rounded-2xl shadow-xl text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent-subtle border border-accent-border">
          <Compass className="w-7 h-7 text-accent" aria-hidden="true" />
        </div>

        <div className="space-y-2">
          <p className="text-[13px] font-medium tracking-wide text-fg-muted uppercase">خطأ 404</p>
          <h1 className="text-xl font-semibold text-fg">هذه الصفحة غير موجودة</h1>
          <p className="text-[13px] text-fg-secondary leading-relaxed">
            قد يكون الرابط قديماً، أو أن العنصر قد أُرشف من قِبل مؤسستك. حسابك وبياناتك غير متأثرة.
          </p>
        </div>

        <Link
          href="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-accent-hover text-accent-fg font-medium rounded-lg transition-colors text-sm focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        >
          <Home className="w-4 h-4" aria-hidden="true" />
          العودة إلى إديوكويست
        </Link>
      </div>
    </div>
  )
}
