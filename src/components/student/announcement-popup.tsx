'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { AnnouncementsBanner, type StudentAnnouncement } from '@/components/student/announcements-banner'

// Pops the student's live announcements over whatever page they land on first.
// Mounted in the student layout, so it runs once per full page load — client
// navigation keeps the layout mounted and doesn't re-open it. Each announcement
// pops only until the student dismisses it; the dashboard banner keeps showing
// it for the rest of its window. The feed comes from the same RPC as the
// dashboard, so targeting and the date window are still applied server-side.
const SEEN_KEY = 'eq-seen-announcements'

function readSeen(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function writeSeen(ids: string[]) {
  // Capped so the key can't grow forever; old ids have long since expired.
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-100))) } catch {}
}

export function AnnouncementPopup() {
  const t = useTranslations('student.widgets.popup')
  const [unseen, setUnseen] = useState<StudentAnnouncement[]>([])

  useEffect(() => {
    let cancelled = false
    createClient().rpc('get_student_announcements').then(({ data, error }) => {
      if (cancelled || error || !data) return
      const seen = new Set(readSeen())
      setUnseen((data as unknown as StudentAnnouncement[]).filter(a => !seen.has(a.id)))
    })
    return () => { cancelled = true }
  }, [])

  function dismiss() {
    writeSeen([...readSeen(), ...unseen.map(a => a.id)])
    setUnseen([])
  }

  return (
    <Modal
      open={unseen.length > 0}
      onClose={dismiss}
      title={unseen.length > 1 ? t('titleMany', { count: unseen.length }) : t('titleOne')}
      size="lg"
    >
      <div className="space-y-4" dir="auto">
        <AnnouncementsBanner announcements={unseen} track />
        <div className="flex justify-end">
          <Button onClick={dismiss}>{t('dismiss')}</Button>
        </div>
      </div>
    </Modal>
  )
}
