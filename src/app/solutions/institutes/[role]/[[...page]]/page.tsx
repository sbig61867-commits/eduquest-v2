import type { Metadata } from 'next'
import { RoleTourPage, roleTourMetadata } from '@/components/demo/role-tour'

// /solutions/institutes/<role>/<page>: role tours in this institution type's vocabulary.
type Props = { params: Promise<{ role: string; page?: string[] }> }

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return roleTourMetadata('institute', false, params)
}

export default function RoleTour({ params }: Props) {
  return <RoleTourPage type="institute" fromDemo={false} params={params} />
}
