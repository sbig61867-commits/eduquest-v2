import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { ContactPage } from '@/components/public/contact-page'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('public.meta.contact')
  return { title: t('title'), description: t('description') }
}

export default function Contact() {
  return <ContactPage />
}
