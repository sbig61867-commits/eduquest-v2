import type { Metadata } from 'next'
import { MarketingPage, marketingMetadata } from '@/components/public/marketing-page'
import { ContactPage } from '@/components/public/contact-page'

export function generateMetadata(): Promise<Metadata> {
  return marketingMetadata('contact', '/contact')
}

export default function Contact() {
  return <MarketingPage><ContactPage /></MarketingPage>
}
