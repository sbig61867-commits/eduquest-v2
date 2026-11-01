import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { MarketingPage, marketingMetadata } from '@/components/public/marketing-page'
import { Landing } from '@/components/public/landing'
import { faqJsonLd, type FaqCopy } from '@/components/public/faq-data'
import type { DeviceSample } from '@/components/public/landing-more'
import { toLocale } from '@/i18n/config'
import { getDemoData } from '@/lib/demo/data'

export function generateMetadata(): Promise<Metadata> {
  return marketingMetadata('home', '/')
}

/** The few demo-fixture rows the home page's device frames show (no full fixture set in the bundle). */
async function deviceSample(): Promise<DeviceSample> {
  const d = getDemoData(toLocale(await getLocale()))
  const exam = d.upcomingExams[0] ?? d.exams[0]
  return {
    course: d.courses[0].title, units: d.courses[0].units, courses: d.stats.courses,
    exam: exam.title, duration: exam.duration, announcement: d.announcements[0].title,
  }
}

/** FAQPage structured data for the home FAQ, in the page's language (server-rendered, no cookies read). */
async function faqStructuredData(): Promise<string> {
  const [t, locale] = await Promise.all([getTranslations('public.landing'), getLocale()])
  return faqJsonLd(t.raw('faq') as FaqCopy, toLocale(locale))
}

export default async function RootPage() {
  const [device, faqLd] = await Promise.all([deviceSample(), faqStructuredData()])
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqLd }} />
      <MarketingPage sections={['landing']}><Landing device={device} /></MarketingPage>
    </>
  )
}
