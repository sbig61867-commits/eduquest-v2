'use client'

import { useEffect } from 'react'
import { useUIStore } from '@/stores/ui-store'

/**
 * Syncs the current page's title into the header's wayfinding slot.
 * Place this at the top of any page component (RSC or client).
 * The title renders only in the header — the page's visual H1 is separate.
 */
export function PageTitle({ title }: { title: string }) {
  const setPageTitle = useUIStore(s => s.setPageTitle)
  useEffect(() => {
    setPageTitle(title)
    return () => setPageTitle('')
  }, [title, setPageTitle])
  return null
}
