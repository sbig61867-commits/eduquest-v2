'use client'

import { useLang, PublicNav, PublicFooter } from './shell'

type Section = { h: string; body: string[] }
type PolicyDict = { title: string; updated: string; sections: Section[] }

const privacy: Record<'ar' | 'en', PolicyDict> = {
  ar: {
    title: 'سياسة الخصوصية',
    updated: 'آخر تحديث: يوليو 2026',
    sections: [
      { h: 'البيانات التي نجمعها', body: [
        'بيانات الحساب: الاسم الكامل والبريد الإلكتروني والدور (مدير جامعة / معلم / طالب) والجامعة التابع لها.',
        'المحتوى التعليمي: الدروس والاختبارات والإجابات والعلامات التي تُنشأ داخل المنصة.',
        'بيانات المراقبة أثناء الاختبارات المراقبة فقط: أحداث مثل تبديل النوافذ أو رصد أكثر من وجه. تُحلَّل لقطات الكاميرا لحظياً لاستخراج هذه الأحداث ولا نخزّن تسجيلات فيديو.',
      ]},
      { h: 'كيف نستخدم البيانات', body: [
        'تشغيل المنصة: عرض الدروس، تصحيح الاختبارات، نشر العلامات، وإرسال الدعوات.',
        'حماية نزاهة الاختبارات عبر أحداث المراقبة التي يراجعها معلم المادة فقط.',
        'لا نبيع بياناتك ولا نشاركها مع أي طرف ثالث لأغراض تسويقية.',
      ]},
      { h: 'عزل البيانات', body: [
        'كل جامعة معزولة تماماً عن غيرها على مستوى قاعدة البيانات (Row Level Security)، فلا يمكن لأي مستخدم الاطلاع على بيانات جامعة أخرى.',
        'الطالب يرى محتوى مجموعته فقط، والمعلم يرى مجموعاته فقط.',
      ]},
      { h: 'التخزين والأمان', body: [
        'تُستضاف البيانات لدى مزودين سحابيين موثوقين (Supabase على AWS في فرانكفورت، وVercel) مع تشفير أثناء النقل والتخزين.',
        'الوصول للأنظمة الإدارية محصور بمالك المنصة، وكل العمليات الحساسة تتم عبر الخادم لا المتصفح.',
      ]},
      { h: 'حقوقك', body: [
        'يمكنك طلب تصحيح بياناتك أو حذف حسابك بالتواصل مع إدارة جامعتك أو مراسلتنا مباشرة.',
        'عند حذف جامعة من المنصة تُحذف بيانات مستخدميها المرتبطة بها.',
      ]},
      { h: 'التواصل', body: [
        'لأي استفسار حول الخصوصية راسلنا على: sbig61867@gmail.com',
      ]},
    ],
  },
  en: {
    title: 'Privacy Policy',
    updated: 'Last updated: July 2026',
    sections: [
      { h: 'Data we collect', body: [
        'Account data: full name, email, role (university admin / teacher / student) and your university.',
        'Educational content: lessons, exams, answers and grades created inside the platform.',
        'Proctoring data during proctored exams only: events such as tab switching or multiple faces detected. Camera frames are analyzed in real time to extract these events; we do not store video recordings.',
      ]},
      { h: 'How we use data', body: [
        'Operating the platform: showing lessons, grading exams, publishing grades, and sending invitations.',
        'Protecting exam integrity through proctoring events reviewed only by the course teacher.',
        'We never sell your data or share it with third parties for marketing.',
      ]},
      { h: 'Data isolation', body: [
        'Every university is fully isolated at the database level (Row Level Security) — no user can access another university’s data.',
        'Students see only their own group’s content; teachers see only their own groups.',
      ]},
      { h: 'Storage & security', body: [
        'Data is hosted with trusted cloud providers (Supabase on AWS Frankfurt, and Vercel) with encryption in transit and at rest.',
        'Administrative access is restricted to the platform owner, and all sensitive operations run on the server, never in the browser.',
      ]},
      { h: 'Your rights', body: [
        'You may request correction of your data or deletion of your account through your university admin or by contacting us directly.',
        'When a university is removed from the platform, its users’ associated data is deleted.',
      ]},
      { h: 'Contact', body: [
        'For any privacy questions, email us at: sbig61867@gmail.com',
      ]},
    ],
  },
}

const terms: Record<'ar' | 'en', PolicyDict> = {
  ar: {
    title: 'شروط الاستخدام',
    updated: 'آخر تحديث: يوليو 2026',
    sections: [
      { h: 'القبول بالشروط', body: [
        'باستخدامك منصة EduQuest فأنت توافق على هذه الشروط. إن لم توافق عليها فلا تستخدم المنصة.',
      ]},
      { h: 'الحسابات والدعوات', body: [
        'الدخول للمنصة بالدعوة فقط. أنت مسؤول عن سرية بيانات دخولك وعن كل نشاط يتم عبر حسابك.',
        'يُمنع مشاركة الحساب أو رابط الدعوة مع أي شخص غير المعني به.',
      ]},
      { h: 'الاستخدام المقبول', body: [
        'تُستخدم المنصة للأغراض التعليمية فقط.',
        'يُمنع محاولة الغش في الاختبارات أو الالتفاف على أنظمة المراقبة، ويُمنع رفع محتوى مخالف للقانون أو مسيء.',
        'يُمنع أي محاولة لاختراق المنصة أو الوصول لبيانات جامعات أو مستخدمين آخرين.',
      ]},
      { h: 'المحتوى والملكية', body: [
        'المحتوى التعليمي الذي ينشئه المعلمون ملك لجامعاتهم.',
        'المحتوى المولّد بالذكاء الاصطناعي أداة مساعدة — مسؤولية مراجعته واعتماده تقع على المعلم قبل نشره.',
      ]},
      { h: 'الاشتراك والإيقاف', body: [
        'اشتراك الجامعات بالاتفاق المباشر مع إدارة المنصة.',
        'يحق لإدارة المنصة تعليق أي حساب يخالف هذه الشروط، ويحق لإدارة الجامعة تعطيل حسابات مستخدميها.',
      ]},
      { h: 'حدود المسؤولية', body: [
        'نبذل جهدنا لإبقاء المنصة متاحة وآمنة، لكنها تُقدَّم "كما هي" دون ضمانات مطلقة ضد الانقطاع.',
        'قد تُحدَّث هذه الشروط، وسيُعلن عن أي تغيير جوهري داخل المنصة.',
      ]},
      { h: 'التواصل', body: [
        'لأي استفسار حول هذه الشروط راسلنا على: sbig61867@gmail.com',
      ]},
    ],
  },
  en: {
    title: 'Terms of Use',
    updated: 'Last updated: July 2026',
    sections: [
      { h: 'Acceptance of terms', body: [
        'By using EduQuest you agree to these terms. If you do not agree, do not use the platform.',
      ]},
      { h: 'Accounts & invitations', body: [
        'Access is invitation-only. You are responsible for keeping your credentials confidential and for all activity under your account.',
        'Sharing your account or an invitation link with anyone other than its intended recipient is prohibited.',
      ]},
      { h: 'Acceptable use', body: [
        'The platform is for educational purposes only.',
        'Attempting to cheat in exams or bypass proctoring, and uploading unlawful or abusive content, are prohibited.',
        'Any attempt to breach the platform or access other universities’ or users’ data is prohibited.',
      ]},
      { h: 'Content & ownership', body: [
        'Educational content created by teachers belongs to their universities.',
        'AI-generated content is an assistive tool — the teacher is responsible for reviewing and approving it before publishing.',
      ]},
      { h: 'Subscription & suspension', body: [
        'University subscriptions are arranged directly with the platform’s management.',
        'The platform may suspend any account violating these terms, and university admins may disable their own users’ accounts.',
      ]},
      { h: 'Limitation of liability', body: [
        'We work to keep the platform available and secure, but it is provided “as is” without absolute guarantees against interruption.',
        'These terms may be updated; any material change will be announced inside the platform.',
      ]},
      { h: 'Contact', body: [
        'For any questions about these terms, email us at: sbig61867@gmail.com',
      ]},
    ],
  },
}

export function PolicyPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const [lang, setLang] = useLang()
  const t = (kind === 'privacy' ? privacy : terms)[lang]

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-950">
      <PublicNav lang={lang} setLang={setLang} />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-14">
        <h1 className="text-3xl sm:text-4xl font-bold text-white">{t.title}</h1>
        <p className="text-slate-500 text-sm mt-2 mb-10">{t.updated}</p>
        <div className="space-y-8">
          {t.sections.map((s, i) => (
            <section key={i}>
              <h2 className="text-white font-semibold text-lg mb-3">{s.h}</h2>
              <ul className="space-y-2">
                {s.body.map((line, j) => (
                  <li key={j} className="text-slate-400 text-sm leading-relaxed">{line}</li>
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
