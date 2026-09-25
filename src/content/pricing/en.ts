// English wording of the /pricing page plans. Mirrors src/content/pricing/ar.ts.
// Style of the public pages: no dashes or commas or parentheses, every sentence
// ends with a period, and FAQ entries are topic titles rather than questions.
import type { PricingText } from './types'

export const pricingText: PricingText = {
  currency: '$',
  lastUpdated: 'Prices last updated September 2026',
  plans: {
    pilot: {
      name: 'Free trial',
      tagline: 'A full month for one department or centre with no commitment.',
      badge: 'Free for 30 days',
      cta: 'Start the trial',
      features: [
        'One department or centre.',
        'Up to 50 students.',
        'Every platform feature.',
        'We help you set up and launch.',
        'No credit card needed.',
      ],
    },
    institution: {
      name: 'Institution',
      tagline: 'For centres and faculties that use the platform every day.',
      badge: 'Most chosen',
      cta: 'Request this plan',
      features: [
        'Up to 500 active students.',
        'Unlimited teachers and groups.',
        'Lessons and exams prepared with AI.',
        'Camera exam monitoring with grading on the server.',
        'Timetables and announcements and staff requests.',
        'Institution reports and grade export.',
        'Email support within one working day.',
      ],
    },
    university: {
      name: 'Full institution',
      tagline: 'Several faculties and centres in one institution. The price depends on your size.',
      cta: 'Contact us for a price',
      features: [
        'Unlimited students.',
        'Several faculties or stages and centres in the same institution.',
        'Live exam monitoring.',
        'Training for your team on the platform.',
        'A service level agreement and backups.',
        'Direct contact with the platform team for support.',
      ],
    },
  },
  includedInAll: [
    'The data of each institution is separated from the others at the database level.',
    'Access is by invitation only with no open signup.',
    'Data is encrypted in transit and at rest.',
    'An Arabic and English interface that works on mobile.',
    'Updates and new features at no extra cost.',
  ],
  faqs: [
    {
      q: 'How a plan is counted',
      a: 'Plans are counted by active students during the school year. A student who never signs in is not counted.',
    },
    {
      q: 'Upgrading or expanding later',
      a: 'You can upgrade at any time. Moving from the trial to a subscription keeps all your data because the same environment continues.',
    },
    {
      q: 'Setup fees',
      a: 'There are no setup fees. We prepare your institution’s environment and invite its admin at no extra cost.',
    },
    {
      q: 'Payment',
      a: 'Payment is arranged directly with the platform management through a monthly or yearly invoice.',
    },
    {
      q: 'Stopping the subscription',
      a: 'We give you a copy of your content and your students’ grades before the environment is closed.',
    },
  ],
}
