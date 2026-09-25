import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { PolicyPage } from '@/components/public/policy'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('public.meta.terms')
  return { title: t('title'), description: t('description') }
}

export default function TermsPage() {
  return <PolicyPage kind="terms" />
}
