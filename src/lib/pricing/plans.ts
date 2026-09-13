// الملف الوحيد الذي تُعدَّل فيه الأسعار.
// Single source of truth for the public /pricing page. Change numbers, plan
// names, features, currency or FAQ here and the page updates — no layout or
// component edits needed. Everything is typed, so a missing or renamed field is
// a build error, never a silently blank card.
//
// - `priceMonthly` / `priceYearly`: a number renders as a price; `null` renders
//   the plan as "on request" and hides the billing toggle for that card.
// - Set `highlight: true` on exactly one plan to give it the accent border.
// - `showBillingToggle: false` hides the monthly/yearly switch site-wide.
//
// ملاحظة: الأرقام الحالية مبدئية — استبدلها بأسعارك الفعلية.

/**
 * قسم الأسعار مخفي حالياً: الروابط في الهيدر/الفوتر لا تظهر و /pricing تُرجع 404.
 * غيّرها إلى true لإظهار القسم مرة أخرى — لا حاجة لأي تعديل آخر.
 */
export const pricingEnabled = false

export type BillingPeriod = 'monthly' | 'yearly'

export interface PricingPlan {
  id: string
  /** Accent card + "most popular" badge. Keep at most one. */
  highlight?: boolean
  priceMonthly: number | null
  priceYearly: number | null
  ar: { name: string; tagline: string; badge?: string; cta: string; features: string[] }
  en: { name: string; tagline: string; badge?: string; cta: string; features: string[] }
}

export interface PricingConfig {
  /** Shown next to every number. Change both languages together. */
  currency: { ar: string; en: string }
  showBillingToggle: boolean
  /** Displayed under the page title, e.g. after a price change. */
  lastUpdated: { ar: string; en: string }
  plans: PricingPlan[]
  /** Bullets shown once under the cards — true for every plan. */
  includedInAll: { ar: string[]; en: string[] }
  faqs: { ar: { q: string; a: string }[]; en: { q: string; a: string }[] }
}

export const pricing: PricingConfig = {
  currency: { ar: '$', en: '$' },
  showBillingToggle: true,
  lastUpdated: { ar: 'أسعار محدّثة — سبتمبر 2026', en: 'Prices updated — September 2026' },

  plans: [
    {
      id: 'pilot',
      priceMonthly: 0,
      priceYearly: 0,
      ar: {
        name: 'تجربة تجريبية',
        tagline: 'شهر كامل لقسم أو مركز واحد — بدون التزام.',
        badge: 'مجاناً 30 يوماً',
        cta: 'ابدأ التجربة',
        features: [
          'قسم أو مركز واحد',
          'حتى 50 طالباً',
          'كل مزايا المنصة بلا استثناء',
          'مرافقة أثناء التجهيز والإطلاق',
          'بدون بطاقة ائتمان',
        ],
      },
      en: {
        name: 'Pilot',
        tagline: 'A full month for one department or centre — no commitment.',
        badge: 'Free for 30 days',
        cta: 'Start the pilot',
        features: [
          'One department or centre',
          'Up to 50 students',
          'Every platform feature, nothing held back',
          'Guided setup and launch',
          'No credit card required',
        ],
      },
    },
    {
      id: 'institution',
      highlight: true,
      priceMonthly: 149,
      priceYearly: 1490,
      ar: {
        name: 'مؤسسي',
        tagline: 'للمراكز والكليات التي تعمل بشكل يومي على المنصة.',
        badge: 'الأكثر اختياراً',
        cta: 'اطلب هذه الباقة',
        features: [
          'حتى 500 طالب نشط',
          'عدد غير محدود من المعلمين والمجموعات',
          'توليد الدروس والاختبارات بالذكاء الاصطناعي',
          'مراقبة الاختبارات بالكاميرا والتصحيح على الخادم',
          'الجداول والإعلانات وطلبات الكادر',
          'تقارير المؤسسة وتصدير العلامات',
          'دعم بالبريد خلال يوم عمل',
        ],
      },
      en: {
        name: 'Institution',
        tagline: 'For centres and faculties running on the platform daily.',
        badge: 'Most popular',
        cta: 'Request this plan',
        features: [
          'Up to 500 active students',
          'Unlimited teachers and groups',
          'AI lesson and exam generation',
          'Camera proctoring with server-side grading',
          'Schedules, announcements and staff requests',
          'Institution reports and grade export',
          'Email support within one business day',
        ],
      },
    },
    {
      id: 'university',
      priceMonthly: null,
      priceYearly: null,
      ar: {
        name: 'جامعة كاملة',
        tagline: 'عدة كليات ومراكز تحت مظلة واحدة، بسعر يُبنى على حجمك.',
        cta: 'تواصل معنا للتسعير',
        features: [
          'عدد غير محدود من الطلاب',
          'عدة كليات ومراكز في نفس الجامعة',
          'المراقبة المباشرة للاختبارات (الجدار المباشر)',
          'تدريب لفريقك على المنصة',
          'اتفاقية مستوى خدمة ونسخ احتياطي',
          'قناة دعم مباشرة مع فريق المنصة',
        ],
      },
      en: {
        name: 'Full university',
        tagline: 'Several faculties and centres under one roof, priced to your size.',
        cta: 'Contact us for pricing',
        features: [
          'Unlimited students',
          'Multiple faculties and centres in one university',
          'Live exam monitoring (the live wall)',
          'Training sessions for your team',
          'Service-level agreement and backups',
          'A direct support channel with the platform team',
        ],
      },
    },
  ],

  includedInAll: {
    ar: [
      'عزل كامل لبيانات كل جامعة على مستوى قاعدة البيانات',
      'الدخول بالدعوة فقط — لا تسجيل مفتوح',
      'استضافة مشفّرة أثناء النقل والتخزين',
      'واجهة عربية/إنجليزية تعمل على الجوال',
      'التحديثات والمزايا الجديدة بدون رسوم إضافية',
    ],
    en: [
      'Full per-university data isolation at the database level',
      'Invitation-only access — no open signup',
      'Hosting encrypted in transit and at rest',
      'Arabic/English interface that works on mobile',
      'Updates and new features at no extra cost',
    ],
  },

  faqs: {
    ar: [
      { q: 'كيف تُحتسب الباقة؟', a: 'بعدد الطلاب النشطين خلال العام الدراسي. الطالب الذي لا يدخل المنصة لا يُحتسب.' },
      { q: 'هل أستطيع الترقية أو التوسعة لاحقاً؟', a: 'نعم، والانتقال من التجربة إلى الاشتراك لا يفقدك أي بيانات — نفس البيئة تستمر كما هي.' },
      { q: 'هل هناك رسوم إعداد؟', a: 'لا. نجهّز بيئة جامعتك وندعو مديرها دون رسوم إضافية.' },
      { q: 'كيف يتم الدفع؟', a: 'بالاتفاق المباشر مع إدارة المنصة عبر فاتورة شهرية أو سنوية.' },
      { q: 'ماذا يحدث لو أوقفنا الاشتراك؟', a: 'نزوّدك بنسخة من محتواك وعلامات طلابك قبل إغلاق البيئة.' },
    ],
    en: [
      { q: 'How is a plan counted?', a: 'By active students during the academic year. A student who never signs in is not counted.' },
      { q: 'Can we upgrade or expand later?', a: 'Yes, and moving from the pilot to a subscription loses no data — the same environment simply continues.' },
      { q: 'Is there a setup fee?', a: 'No. We prepare your university’s environment and invite its admin at no extra cost.' },
      { q: 'How is payment handled?', a: 'Arranged directly with the platform’s management via a monthly or yearly invoice.' },
      { q: 'What happens if we stop the subscription?', a: 'We hand you an export of your content and your students’ grades before the environment is closed.' },
    ],
  },
}
