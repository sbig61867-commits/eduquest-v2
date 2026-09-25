'use client'

import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslations } from 'next-intl'

// Triggers a normal browser navigation to the xlsx endpoint (not fetch+blob)
// so the browser's own download flow handles the file — same pattern as
// grades/export. The API route itself re-checks the session and scopes the
// query via RLS; this button carries no privilege of its own.
export function ReportDownloadButton() {
  const t = useTranslations('admin.appeals')
  return (
    <Button
      variant="secondary"
      onClick={() => { window.location.href = '/api/appeals/report?format=xlsx' }}
    >
      <Download className="w-4 h-4" /> {t('downloadFullReport')}
    </Button>
  )
}
