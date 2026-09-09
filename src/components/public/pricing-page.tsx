'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useLang, PublicNav, PublicFooter } from './shell'
import { CheckCircle2, Mail } from 'lucide-react'
import { RevealOnScroll, StaggerGrid, StaggerItem } from '@/components/shared/motion'

// ── Toggle: set to true when pricing is ready to show ──────────────────────
export const PRICING_ENABLED = false

const dict = {
  ar: {
    badge: 'الأسعار',
    title: 'باقات تناسب جامعتك',
    subtitle: 'ابدأ مجاناً، وسعّد طلابك من اليوم الأول.',
    comingSoonTitle: 'صفحة الأسعار قريباً',
    comingSoonDesc: 'نعمل على إعداد باقات مناسبة لجميع أحجام الجامعات. تواصل معنا مباشرة للحصول على عرض مخصص.',
    contactBtn: 'تواصل معنا للحصول على عرض',
    perMonth: '/شهرياً',
    perYear: '/سنوياً',
    popular: 'الأكثر طلباً',
    contactSales: 'تواصل مع المبيعات',
    startFree: 'ابدأ مجاناً',
    subscribe: 'اشترك الآن',
    plans: [
      {
        name: 'تجريبي',
        nameEn: 'Starter',
        price: 'مجاناً',
        desc: 'لجامعة واحدة تريد استكشاف المنصة',
        features: [
          'حتى 100 طالب',
          '3 معلمين',
          'توليد الدروس بالذكاء الاصطناعي (10/ساعة)',
          'الاختبارات والتصحيح التلقائي',
          'دعم عبر البريد الإلكتروني',
        ],
        cta: 'ابدأ مجاناً',
        href: '/contact',
        highlighted: false,
      },
      {
        name: 'احترافي',
        nameEn: 'Pro',
        price: 'تواصل معنا',
        desc: 'للجامعات المتوسطة والكبيرة',
        features: [
          'طلاب غير محدودين',
          'معلمون غير محدودين',
          'توليد الدروس بالذكاء الاصطناعي (غير محدود)',
          'المراقبة الحية لجميع الاختبارات',
          'عزل بيانات كامل',
          'تقارير متقدمة',
          'دعم فني على مدار الساعة',
          'مرافقة كاملة عند الإطلاق',
        ],
        cta: 'تواصل معنا',
        href: '/contact',
        highlighted: true,
      },
      {
        name: 'مؤسسي',
        nameEn: 'Enterprise',
        price: 'مخصص',
        desc: 'للمجمعات التعليمية والجهات الكبرى',
        features: [
          'جميع مميزات الاحترافي',
          'SLA مخصص',
          'تكاملات مع الأنظمة الجامعية',
          'مدير حساب مخصص',
          'تدريب الفريق',
          'اتفاقية خصوصية مخصصة (DPA)',
        ],
        cta: 'تواصل مع المبيعات',
        href: '/contact',
        highlighted: false,
      },
    ],
    faqTitle: 'أسئلة شائعة حول الأسعار',
    faqs: [
      { q: 'هل هناك رسوم إعداد؟', a: 'لا، نجهّز بيئة جامعتك بأنفسنا ونرافقكم خطوة بخطوة دون أي رسوم إضافية.' },
      { q: 'هل يمكن تغيير الباقة لاحقاً؟', a: 'نعم، يمكن الترقية أو التخفيض في أي وقت بالتواصل مع فريقنا.' },
      { q: 'ماذا يحدث لبياناتنا إذا ألغينا الاشتراك؟', a: 'تحتفظون ببياناتكم كاملة — نوفر لكم نسخة احتياطية شاملة قبل إغلاق البيئة بـ 30 يوماً من الإشعار.' },
      { q: 'هل التسعير بالطالب أم بالمؤسسة؟', a: 'التسعير بالمؤسسة الجامعية — يمكنكم إضافة أي عدد من الطلاب ضمن حدود الباقة.' },
    ],
  },
  en: {
    badge: 'Pricing',
    title: 'Plans that fit your university',
    subtitle: 'Start free and delight your students from day one.',
    comingSoonTitle: 'Pricing coming soon',
    comingSoonDesc: 'We are preparing plans to suit universities of all sizes. Contact us directly for a custom quote.',
    contactBtn: 'Contact us for a quote',
    perMonth: '/month',
    perYear: '/year',
    popular: 'Most popular',
    contactSales: 'Contact sales',
    startFree: 'Start free',
    subscribe: 'Subscribe now',
    plans: [
      {
        name: 'Starter',
        nameEn: 'Starter',
        price: 'Free',
        desc: 'For a single university exploring the platform',
        features: [
          'Up to 100 students',
          '3 teachers',
          'AI lesson generation (10/hour)',
          'Exams & automatic grading',
          'Email support',
        ],
        cta: 'Start free',
        href: '/contact',
        highlighted: false,
      },
      {
        name: 'Pro',
        nameEn: 'Pro',
        price: 'Contact us',
        desc: 'For medium and large universities',
        features: [
          'Unlimited students',
          'Unlimited teachers',
          'Unlimited AI generation',
          'Live proctoring for all exams',
          'Full data isolation',
          'Advanced reports',
          '24/7 technical support',
          'Full onboarding assistance',
        ],
        cta: 'Contact us',
        href: '/contact',
        highlighted: true,
      },
      {
        name: 'Enterprise',
        nameEn: 'Enterprise',
        price: 'Custom',
        desc: 'For educational groups and large institutions',
        features: [
          'Everything in Pro',
          'Custom SLA',
          'University system integrations',
          'Dedicated account manager',
          'Team training',
          'Custom Data Processing Agreement (DPA)',
        ],
        cta: 'Contact sales',
        href: '/contact',
        highlighted: false,
      },
    ],
    faqTitle: 'Pricing FAQ',
    faqs: [
      { q: 'Are there setup fees?', a: 'No. We set up your university environment ourselves and guide you step by step at no extra cost.' },
      { q: 'Can I change plans later?', a: 'Yes — upgrade or downgrade at any time by contacting our team.' },
      { q: 'What happens to our data if we cancel?', a: 'You keep all your data — we provide a full backup before closing your environment with 30 days notice.' },
      { q: 'Is pricing per student or per institution?', a: 'Pricing is per institution — you can add any number of students within your plan limits.' },
    ],
  },
}

export function PricingPageContent() {
  const [lang, setLang] = useLang()
  const t = dict[lang]

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'light')
    return () => document.documentElement.removeAttribute('data-theme')
  }, [])

  if (!PRICING_ENABLED) {
    return (
      <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="min-h-screen bg-canvas">
        <PublicNav lang={lang} setLang={setLang} />
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-accent-subtle flex items-center justify-center mx-auto mb-6">
            <Mail className="w-8 h-8 text-accent" />
          </div>
          <h1 className="text-3xl font-bold text-fg mb-4">{t.comingSoonTitle}</h1>
          <p className="text-fg-secondary leading-relaxed mb-8">{t.comingSoonDesc}</p>
          <Link href="/contact"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-fg font-semibold transition-colors">
            {t.contactBtn}
          </Link>
        </div>
        <PublicFooter lang={lang} />
      </div>
    )
  }

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="min-h-screen bg-canvas">
      <PublicNav lang={lang} setLang={setLang} />

      {/* Header */}
      <RevealOnScroll className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 pb-10 text-center">
        <span className="inline-block px-4 py-1.5 rounded-full bg-accent-subtle border border-accent-border text-accent text-sm font-medium mb-5">
          {t.badge}
        </span>
        <h1 className="text-3xl sm:text-5xl font-extrabold text-fg mb-4">{t.title}</h1>
        <p className="text-fg-secondary text-lg max-w-xl mx-auto">{t.subtitle}</p>
      </RevealOnScroll>

      {/* Plans */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-16">
        <StaggerGrid className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {t.plans.map((plan, i) => (
            <StaggerItem key={i} className={`eq-card-hover relative rounded-2xl p-8 flex flex-col gap-6 ${
              plan.highlighted
                ? 'bg-accent text-accent-fg shadow-2xl shadow-accent/20 scale-[1.02]'
                : 'bg-elevated border border-border'
            }`}>
              {plan.highlighted && (
                <span className="absolute -top-3 start-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-elevated text-accent text-xs font-bold border border-accent-border whitespace-nowrap">
                  {t.popular}
                </span>
              )}
              <div>
                <p className={`text-sm font-medium mb-1 ${plan.highlighted ? 'text-accent-fg/70' : 'text-fg-muted'}`}>
                  {plan.name}
                </p>
                <p className={`text-3xl font-extrabold ${plan.highlighted ? 'text-accent-fg' : 'text-fg'}`}>
                  {plan.price}
                </p>
                <p className={`text-sm mt-2 ${plan.highlighted ? 'text-accent-fg/80' : 'text-fg-secondary'}`}>
                  {plan.desc}
                </p>
              </div>
              <ul className="space-y-2.5 flex-1">
                {plan.features.map((f, j) => (
                  <li key={j} className={`flex items-start gap-2.5 text-sm ${plan.highlighted ? 'text-accent-fg' : 'text-fg-secondary'}`}>
                    <CheckCircle2 className={`w-4 h-4 shrink-0 mt-0.5 ${plan.highlighted ? 'text-accent-fg' : 'text-accent'}`} />
                    {f}
                  </li>
                ))}
              </ul>
              <Link href={plan.href}
                className={`text-center py-3 rounded-xl font-semibold transition-colors ${
                  plan.highlighted
                    ? 'bg-elevated text-accent hover:bg-surface'
                    : 'bg-accent hover:bg-accent-hover text-accent-fg'
                }`}>
                {plan.cta}
              </Link>
            </StaggerItem>
          ))}
        </StaggerGrid>
      </section>

      {/* FAQ */}
      <section className="bg-surface border-y border-border">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <h2 className="text-2xl font-bold text-fg text-center mb-8">{t.faqTitle}</h2>
          <div className="space-y-3">
            {t.faqs.map((f, i) => (
              <details key={i} className="group bg-elevated border border-border rounded-xl overflow-hidden">
                <summary className="flex items-center justify-between gap-3 p-5 cursor-pointer list-none text-fg font-medium">
                  {f.q}
                  <span className="text-fg-muted text-lg shrink-0 transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="px-5 pb-5 -mt-1 text-fg-secondary text-sm leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <PublicFooter lang={lang} />
    </div>
  )
}
