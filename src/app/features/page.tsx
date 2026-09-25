import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { FeaturesPage } from '@/components/public/features-page'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('public.meta.features')
  return { title: t('title'), description: t('description') }
}

export default function Features() {
  return <FeaturesPage />
}
