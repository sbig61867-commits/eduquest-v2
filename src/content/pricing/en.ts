// English wording of the /pricing page plans. Mirrors src/content/pricing/ar.ts.
// Prices and usage limits live in src/lib/pricing/plans.ts; the numbers repeated
// in `features` below must match that file's `limits`.
// Style of the public pages: no dashes or commas or parentheses, every sentence
// ends with a period, and FAQ entries are topic titles rather than questions.
import type { PricingText } from './types'

export const pricingText: PricingText = {
  currency: '$',
  lastUpdated: 'Prices last updated in September 2026',
  plans: {
    pilot: {
      name: 'Free trial',
      tagline: 'A full month for one department or centre with no commitment.',
      badge: 'Free for 30 days',
      cta: 'Start the trial',
      features: [
        'One department or centre.',
        'Up to 50 active students.',
        'Up to 5 instructor and staff accounts.',
        '150 AI requests for the whole trial.',
        '250 live proctoring minutes for the whole trial.',
        'Every platform component without exception.',
        'No payment method required.',
      ],
    },
    institution: {
      name: 'Institution',
      tagline: 'For centres and faculties that rely on the platform in their daily work.',
      badge: 'Most chosen',
      cta: 'Request this plan',
      features: [
        'Up to 150 active students.',
        'Up to 15 instructor and staff accounts.',
        '1000 AI requests per month.',
        '750 live proctoring minutes per month.',
        'Proctoring on the student device with grading on the server.',
        'Timetables and announcements and administrative correspondence and institution reports.',
        'Email support within one working day.',
      ],
    },
    university: {
      name: 'Full institution',
      tagline: 'For an institution with several faculties or centres. Limits and price are set according to its size.',
      cta: 'Contact us to set a price',
      features: [
        'Number of students and accounts by agreement.',
        'Several faculties or stages and centres in the same institution.',
        'AI and live proctoring allowances set according to size.',
        'Training for the institution staff on the platform.',
        'A service level agreement and daily backups.',
        'Direct contact with the platform team.',
      ],
    },
  },
  includedInAll: [
    'Each institution is isolated from all others at the database level.',
    'Enrolment by invitation with no open sign up.',
    'Data encrypted in transit and at rest.',
    'Complete Arabic and English interfaces that work on mobile devices.',
    'Updates and new features at no additional cost.',
  ],
  faqs: [
    {
      q: 'How a plan is calculated',
      a: 'Plans are calculated by active students during the academic year. A student who does not use the platform is not counted.',
    },
    {
      q: 'Reaching a usage limit',
      a: 'When an institution approaches any limit the platform management contacts it to raise the limit by agreement or to move to a higher plan.',
    },
    {
      q: 'Upgrading and expanding',
      a: 'You can upgrade at any time. Moving from the trial to a subscription loses no data because the same environment continues.',
    },
    {
      q: 'Configuration fees',
      a: 'There are no configuration fees. We create the institution environment and invite its administrator at no additional cost.',
    },
    {
      q: 'Payment',
      a: 'Payment is arranged directly with the platform management through a monthly or yearly invoice.',
    },
    {
      q: 'Ending the subscription',
      a: 'We hand the institution a copy of its content and its students’ grades before its environment is closed.',
    },
  ],
  limits: {
    title: 'Usage limits of every plan',
    desc: 'Defined numbers for every plan that keep the service stable for all institutions on the platform.',
    limitLabel: 'Limit',
    byAgreement: 'By agreement',
    labels: {
      students: 'Active students',
      staff: 'Instructor and staff accounts',
      aiRequests: 'AI requests per month',
      liveMinutes: 'Live proctoring minutes per month',
      liveConcurrent: 'Students in live proctoring at the same time',
      storageMb: 'File storage in MB',
    },
    notes: [
      'The AI and live proctoring figures of the free trial cover the whole trial.',
      'A live proctoring minute is counted for every connected student and for the watching instructor. Watching 9 students live for a whole 45 minute examination uses about 450 minutes.',
      'Proctoring on the student device is available in every plan with no limit on the number of examinations.',
    ],
  },
}
