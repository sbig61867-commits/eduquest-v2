import type { Metadata } from 'next'
import { RoleTourPage, roleTourMetadata } from '@/components/demo/role-tour'

// /solutions/training-centres/<role>/<page>: role tours in this institution type's vocabulary.
type Props = { params: Promise<{ role: string; page?: string[] }> }

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return roleTourMetadata('training_center', false, params)
}

export default function RoleTour({ params }: Props) {
  return <RoleTourPage type="training_center" fromDemo={false} params={params} />
}
