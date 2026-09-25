import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Landing } from '@/components/public/landing'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('public.meta.home')
  return { title: t('title'), description: t('description') }
}

export default function RootPage() {
  return <Landing />
}
