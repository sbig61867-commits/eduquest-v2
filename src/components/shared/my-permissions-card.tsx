import { getTranslations } from 'next-intl/server'
import { CAPABILITIES, type Capability } from '@/lib/permissions'

/**
 * Read-only: what this staff member may do, as their institution configured it
 * (2026-10-17). A centre manager starts with nothing and is granted capabilities
 * one by one; before this they had no way to see which ones they hold.
 */
export async function MyPermissionsCard({ permissions }: { permissions: Record<Capability, boolean> }) {
  const [t, tc] = await Promise.all([getTranslations('staff.myPermissions'), getTranslations('staff.capabilities')])
  return (
    <section aria-labelledby="my-permissions-title" className="rounded-overlay border border-line bg-surface p-6">
      <h2 id="my-permissions-title" className="text-h3 text-fg">{t('title')}</h2>
      <p className="mt-1 text-body-sm text-fg-2">{t('intro')}</p>
      <ul className="mt-4 divide-y divide-line">
        {CAPABILITIES.map(cap => (
          <li key={cap} className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-body-sm text-fg">{tc(`${cap}.label`)}</p>
              <p className="text-meta text-fg-muted">{tc(`${cap}.hint`)}</p>
            </div>
            <span className={`shrink-0 rounded-control px-2 py-1 text-label ${permissions[cap] ? 'bg-success-subtle text-success' : 'bg-elevated text-fg-muted'}`}>
              {permissions[cap] ? t('on') : t('off')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
