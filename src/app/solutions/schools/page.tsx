import type { Metadata } from 'next'
import { MarketingPage, marketingMetadata } from '@/components/public/marketing-page'
import { SolutionsPage } from '@/components/public/solutions-page'
import { solutionProps } from '@/components/public/solution-props'

export function generateMetadata(): Promise<Metadata> {
  return marketingMetadata('solutions.school', '/solutions/schools')
}

export default async function Solution() {
  return <MarketingPage sections={['solutions']}><SolutionsPage {...await solutionProps('school')} /></MarketingPage>
}
