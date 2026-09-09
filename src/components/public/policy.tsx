'use client'

import { useEffect } from 'react'
import { useLang, PublicNav, PublicFooter } from './shell'

type Section = { h: string; body: string[] }
type PolicyDict = { title: string; updated: string; intro?: string; sections: Section[] }

const privacy: Record<'ar' | 'en', PolicyDict> = {
  ar: {
    title: 'سياسة الخصوصية',
    updated: 'آخر تحديث: سبتمبر 2026',
    intro: 'نحن في EduQuest نأخذ خصوصية بياناتك بجدية تامة. توضح هذه الوثيقة ما نجمعه ولماذا وكيف نحميه.',
    sections: [
      { h: 'البيانات التي نجمعها', body: [
        'بيانات الحساب: الاسم الكامل والبريد الإلكتروني والدور (مدير جامعة / معلم / طالب) والجامعة التابع لها.',
        'المحتوى التعليمي: الدروس والاختبارات والإجابات والعلامات التي تُنشأ داخل المنصة.',
        'بيانات المراقبة أثناء الاختبارات المراقبة فقط: أحداث مثل تبديل النوافذ أو رصد أكثر من وجه. تُحلَّل لقطات الكاميرا لحظياً لاستخراج هذه الأحداث ولا نخزّن تسجيلات فيديو.',
        'بيانات الاستخدام: سجلات الدخول ووقت الجلسات لأغراض الأمان وإصلاح الأخطاء.',
      ]},
      { h: 'كيف نستخدم البيانات', body: [
        'تشغيل المنصة: عرض الدروس، تصحيح الاختبارات، نشر العلامات، وإرسال الدعوات.',
        'حماية نزاهة الاختبارات عبر أحداث المراقبة التي يراجعها معلم المادة فقط.',
        'تحسين الخدمة: تحليل أنماط الاستخدام بشكل مجمّع ومجهول الهوية.',
        'لا نبيع بياناتك ولا نشاركها مع أي طرف ثالث لأغراض تسويقية.',
      ]},
      { h: 'عزل البيانات بين المؤسسات', body: [
        'كل جامعة معزولة تماماً عن غيرها على مستوى قاعدة البيانات (Row Level Security)، فلا يمكن لأي مستخدم الاطلاع على بيانات جامعة أخرى.',
        'الطالب يرى محتوى مجموعته فقط، والمعلم يرى مجموعاته فقط.',
        'حتى مالك المنصة لا يطّلع على محتوى الدروس والاختبارات إلا عند الطلب الصريح للدعم الفني.',
      ]},
      { h: 'التخزين والأمان', body: [
        'تُستضاف البيانات لدى مزودين سحابيين موثوقين (Supabase على AWS في فرانكفورت، وVercel) مع تشفير أثناء النقل (TLS) والتخزين (AES-256).',
        'الوصول للأنظمة الإدارية محصور بمالك المنصة، وكل العمليات الحساسة تتم عبر الخادم لا المتصفح.',
        'يتم عمل نسخ احتياطية منتظمة للبيانات.',
      ]},
      { h: 'الاحتفاظ بالبيانات', body: [
        'تُحتفظ ببيانات الحساب طوال مدة الاشتراك النشط.',
        'عند حذف جامعة من المنصة تُحذف بيانات مستخدميها المرتبطة بها خلال 30 يوماً.',
        'بيانات المراقبة تُحتفظ بها لمدة الفصل الدراسي ثم تُحذف تلقائياً.',
      ]},
      { h: 'حقوقك', body: [
        'يمكنك طلب الاطلاع على بياناتك المخزّنة أو تصحيحها.',
        'يمكنك طلب حذف حسابك بالتواصل مع إدارة جامعتك أو مراسلتنا مباشرة.',
        'يمكنك الاعتراض على معالجة بياناتك في حالات معينة وفق الأنظمة المعمول بها.',
      ]},
      { h: 'التواصل', body: [
        'لأي استفسار حول الخصوصية استخدم نموذج «تواصل معنا» في الصفحة الرئيسية.',
        'البريد الإلكتروني: support@eduquest.app',
      ]},
    ],
  },
  en: {
    title: 'Privacy Policy',
    updated: 'Last updated: September 2026',
    intro: 'At EduQuest we take your data privacy seriously. This document explains what we collect, why, and how we protect it.',
    sections: [
      { h: 'Data we collect', body: [
        'Account data: full name, email, role (university admin / teacher / student) and your university.',
        'Educational content: lessons, exams, answers and grades created inside the platform.',
        'Proctoring data during proctored exams only: events such as tab switching or multiple faces detected. Camera frames are analyzed in real time; we do not store video recordings.',
        'Usage data: login records and session duration for security and debugging purposes.',
      ]},
      { h: 'How we use data', body: [
        'Operating the platform: showing lessons, grading exams, publishing grades, and sending invitations.',
        'Protecting exam integrity through proctoring events reviewed only by the course teacher.',
        'Improving the service: analyzing aggregated, anonymized usage patterns.',
        'We never sell your data or share it with third parties for marketing.',
      ]},
      { h: 'Data isolation between institutions', body: [
        'Every university is fully isolated at the database level (Row Level Security) — no user can access another university\'s data.',
        'Students see only their own group\'s content; teachers see only their own groups.',
        'Even the platform owner does not view lesson or exam content unless explicitly requested for support.',
      ]},
      { h: 'Storage & security', body: [
        'Data is hosted with trusted cloud providers (Supabase on AWS Frankfurt, and Vercel) with encryption in transit (TLS) and at rest (AES-256).',
        'Administrative system access is restricted to the platform owner, and all sensitive operations run on the server.',
        'Regular automated backups are performed.',
      ]},
      { h: 'Data retention', body: [
        'Account data is retained for the duration of an active subscription.',
        'When a university is removed from the platform, its users\' associated data is deleted within 30 days.',
        'Proctoring data is retained for the duration of the semester then deleted automatically.',
      ]},
      { h: 'Your rights', body: [
        'You may request access to or correction of your stored data.',
        'You may request deletion of your account through your university admin or by contacting us directly.',
        'You may object to processing of your data in certain cases under applicable regulations.',
      ]},
      { h: 'Contact', body: [
        'For any privacy questions, use the "Contact Us" form on the home page.',
        'Email: support@eduquest.app',
      ]},
    ],
  },
}

const terms: Record<'ar' | 'en', PolicyDict> = {
  ar: {
    title: 'شروط الاستخدام',
    updated: 'آخر تحديث: سبتمبر 2026',
    intro: 'يُرجى قراءة هذه الشروط بعناية قبل استخدام منصة EduQuest. استخدامك للمنصة يعني موافقتك على هذه الشروط.',
    sections: [
      { h: 'قبول الشروط', body: [
        'باستخدامك منصة EduQuest فأنت توافق على هذه الشروط وسياسة الخصوصية. إن لم توافق عليها فلا تستخدم المنصة.',
        'قد تُحدَّث هذه الشروط دورياً، وسيُعلَن عن أي تغيير جوهري داخل المنصة قبل تطبيقه.',
      ]},
      { h: 'الحسابات والدعوات', body: [
        'الدخول للمنصة بالدعوة فقط من مدير الجامعة أو المعلم المعني.',
        'أنت مسؤول عن سرية بيانات دخولك وعن كل نشاط يتم عبر حسابك.',
        'يُمنع مشاركة الحساب أو رابط الدعوة مع أي شخص غير المعني به.',
      ]},
      { h: 'الاستخدام المقبول', body: [
        'تُستخدم المنصة للأغراض التعليمية الأكاديمية فقط.',
        'يُمنع محاولة الغش في الاختبارات أو الالتفاف على أنظمة المراقبة بأي وسيلة.',
        'يُمنع رفع أي محتوى مخالف للقانون أو مسيء أو ينتهك حقوق الملكية الفكرية.',
        'يُمنع أي محاولة لاختراق المنصة أو الوصول لبيانات جامعات أو مستخدمين آخرين.',
      ]},
      { h: 'المحتوى والملكية الفكرية', body: [
        'المحتوى التعليمي الذي ينشئه المعلمون ملك لجامعاتهم.',
        'المحتوى المولّد بالذكاء الاصطناعي أداة مساعدة — مسؤولية مراجعته واعتماده تقع على المعلم قبل نشره.',
        'الكود البرمجي للمنصة وتصميمها حقوق محفوظة لـ EduQuest.',
      ]},
      { h: 'الاشتراك والإيقاف', body: [
        'اشتراك الجامعات بالاتفاق المباشر مع إدارة المنصة.',
        'يحق لإدارة المنصة تعليق أي حساب يخالف هذه الشروط فوراً ودون إشعار مسبق في الحالات الجسيمة.',
        'يحق لإدارة الجامعة تعطيل حسابات مستخدميها في أي وقت.',
      ]},
      { h: 'إخلاء المسؤولية وحدودها', body: [
        'نبذل جهدنا لإبقاء المنصة متاحة وآمنة، لكنها تُقدَّم "كما هي" دون ضمانات مطلقة ضد الانقطاع أو الأخطاء.',
        'لا تتحمل EduQuest مسؤولية أي خسائر غير مباشرة ناتجة عن استخدام المنصة أو عدم توافرها.',
      ]},
      { h: 'القانون الواجب التطبيق', body: [
        'تخضع هذه الشروط للأنظمة واللوائح المعمول بها في المملكة العربية السعودية ما لم يُتفق خلافه كتابياً.',
      ]},
      { h: 'التواصل', body: [
        'لأي استفسار حول هذه الشروط استخدم نموذج «تواصل معنا» في الصفحة الرئيسية.',
        'البريد الإلكتروني: support@eduquest.app',
      ]},
    ],
  },
  en: {
    title: 'Terms of Use',
    updated: 'Last updated: September 2026',
    intro: 'Please read these terms carefully before using EduQuest. Using the platform means you agree to these terms.',
    sections: [
      { h: 'Acceptance of terms', body: [
        'By using EduQuest you agree to these terms and the Privacy Policy. If you do not agree, do not use the platform.',
        'These terms may be updated periodically; any material change will be announced inside the platform before taking effect.',
      ]},
      { h: 'Accounts & invitations', body: [
        'Access is by invitation only from the university admin or relevant teacher.',
        'You are responsible for keeping your credentials confidential and for all activity under your account.',
        'Sharing your account or an invitation link with anyone other than its intended recipient is prohibited.',
      ]},
      { h: 'Acceptable use', body: [
        'The platform is for academic educational purposes only.',
        'Attempting to cheat in exams or bypass proctoring systems by any means is prohibited.',
        'Uploading unlawful, abusive, or intellectual-property-infringing content is prohibited.',
        'Any attempt to breach the platform or access other universities\' or users\' data is prohibited.',
      ]},
      { h: 'Content & intellectual property', body: [
        'Educational content created by teachers belongs to their universities.',
        'AI-generated content is an assistive tool — the teacher is responsible for reviewing and approving it before publishing.',
        'The platform\'s code and design are the intellectual property of EduQuest.',
      ]},
      { h: 'Subscription & suspension', body: [
        'University subscriptions are arranged directly with the platform\'s management.',
        'The platform may suspend any account violating these terms immediately and without prior notice in serious cases.',
        'University admins may disable their own users\' accounts at any time.',
      ]},
      { h: 'Disclaimer & limitation of liability', body: [
        'We work to keep the platform available and secure, but it is provided "as is" without absolute guarantees against interruption or errors.',
        'EduQuest is not liable for any indirect losses resulting from use of or inability to access the platform.',
      ]},
      { h: 'Governing law', body: [
        'These terms are governed by the laws and regulations of the Kingdom of Saudi Arabia unless otherwise agreed in writing.',
      ]},
      { h: 'Contact', body: [
        'For any questions about these terms, use the "Contact Us" form on the home page.',
        'Email: support@eduquest.app',
      ]},
    ],
  },
}

const cookies: Record<'ar' | 'en', PolicyDict> = {
  ar: {
    title: 'سياسة ملفات تعريف الارتباط (الكوكيز)',
    updated: 'آخر تحديث: سبتمبر 2026',
    intro: 'تستخدم منصة EduQuest ملفات تعريف ارتباط (Cookies) محدودة وضرورية لعمل المنصة. لا نستخدم كوكيز تتبع تسويقية.',
    sections: [
      { h: 'ما هي ملفات تعريف الارتباط؟', body: [
        'ملفات تعريف الارتباط هي ملفات نصية صغيرة تُخزَّن في متصفحك عند زيارة المنصة.',
        'تساعدنا في الحفاظ على جلستك نشطة والتعرف عليك بعد تسجيل الدخول.',
      ]},
      { h: 'الكوكيز الضرورية (إلزامية)', body: [
        'كوكيز الجلسة (Session): تحفظ حالة تسجيل دخولك وتُمكّنك من التنقل بين صفحات المنصة دون إعادة تسجيل الدخول في كل مرة. مدتها: حتى انتهاء الجلسة أو 7 أيام.',
        'كوكيز الأمان (CSRF): تحمي طلباتك من الهجمات الإلكترونية. مدتها: حتى إغلاق المتصفح.',
        'تفضيل اللغة: تحفظ اختيارك بين العربية والإنجليزية في localStorage (ليست كوكيز تقنياً لكن بيانات محلية مشابهة).',
      ]},
      { h: 'الكوكيز التحليلية (اختيارية)', body: [
        'لا نستخدم حالياً أي كوكيز تحليلية أو تتبع من طرف ثالث مثل Google Analytics.',
        'إذا أضفنا في المستقبل أي أداة تحليلية، سنطلب موافقتك الصريحة أولاً.',
      ]},
      { h: 'الكوكيز التسويقية', body: [
        'لا نستخدم أي كوكيز تسويقية أو إعلانية أو ملفات تتبع لإعادة الاستهداف.',
      ]},
      { h: 'كيف تتحكم في الكوكيز؟', body: [
        'يمكنك حذف الكوكيز أو تعطيلها من إعدادات متصفحك في أي وقت.',
        'تعطيل كوكيز الجلسة قد يمنعك من تسجيل الدخول للمنصة.',
        'روابط إعدادات الكوكيز: Chrome: الإعدادات > الخصوصية والأمان | Firefox: الإعدادات > الخصوصية | Safari: التفضيلات > الخصوصية.',
      ]},
      { h: 'التواصل', body: [
        'لأي استفسار حول سياسة الكوكيز راسلنا عبر نموذج «تواصل معنا».',
        'البريد الإلكتروني: support@eduquest.app',
      ]},
    ],
  },
  en: {
    title: 'Cookie Policy',
    updated: 'Last updated: September 2026',
    intro: 'EduQuest uses a limited set of strictly necessary cookies to operate the platform. We do not use marketing or tracking cookies.',
    sections: [
      { h: 'What are cookies?', body: [
        'Cookies are small text files stored in your browser when you visit the platform.',
        'They help us keep your session active and recognize you after you sign in.',
      ]},
      { h: 'Strictly necessary cookies', body: [
        'Session cookies: preserve your signed-in state so you can navigate without signing in again on each page. Duration: until session ends or 7 days.',
        'Security cookies (CSRF): protect your requests from cross-site attacks. Duration: until the browser is closed.',
        'Language preference: stored in localStorage (technically local storage, not a cookie) to remember your Arabic/English choice.',
      ]},
      { h: 'Analytics cookies (optional)', body: [
        'We currently use no third-party analytics or tracking cookies such as Google Analytics.',
        'If we add any analytics tool in the future we will request your explicit consent first.',
      ]},
      { h: 'Marketing cookies', body: [
        'We do not use any marketing, advertising, or retargeting cookies or trackers.',
      ]},
      { h: 'How to control cookies', body: [
        'You can delete or disable cookies from your browser settings at any time.',
        'Disabling session cookies may prevent you from signing in to the platform.',
        'Settings links: Chrome: Settings > Privacy & Security | Firefox: Settings > Privacy | Safari: Preferences > Privacy.',
      ]},
      { h: 'Contact', body: [
        'For any questions about our cookie policy, reach us via the "Contact Us" form.',
        'Email: support@eduquest.app',
      ]},
    ],
  },
}

export function PolicyPage({ kind }: { kind: 'privacy' | 'terms' | 'cookies' }) {
  const [lang, setLang] = useLang()
  const dict = kind === 'privacy' ? privacy : kind === 'terms' ? terms : cookies
  const t = dict[lang]

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'light')
    return () => document.documentElement.removeAttribute('data-theme')
  }, [])

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="min-h-screen bg-canvas">
      <PublicNav lang={lang} setLang={setLang} />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-14">
        <h1 className="text-3xl sm:text-4xl font-bold text-fg">{t.title}</h1>
        <p className="text-fg-muted text-sm mt-2">{t.updated}</p>
        {t.intro && (
          <p className="text-fg-secondary text-base leading-relaxed mt-4 mb-10 p-4 bg-accent-subtle border border-accent-border rounded-xl">
            {t.intro}
          </p>
        )}
        <div className="space-y-8 mt-8">
          {t.sections.map((s, i) => (
            <section key={i} className="border-b border-border pb-8 last:border-0">
              <h2 className="text-fg font-semibold text-lg mb-3">{s.h}</h2>
              <ul className="space-y-2">
                {s.body.map((line, j) => (
                  <li key={j} className="text-fg-secondary text-sm leading-relaxed flex gap-2">
                    <span className="text-accent mt-1 shrink-0">•</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>
      <PublicFooter lang={lang} />
    </div>
  )
}
