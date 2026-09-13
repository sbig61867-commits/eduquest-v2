# المراحل 1+2+7 — المعمارية، المكدس التقني، والابتكار (بمقارنة خارجية موثَّقة)

بحثت عن معمارية Canvas وOpen edX وMoodle، وعن الإجماع الحالي (2026) لهندسة SaaS متعددة المستأجرين، لمقارنة EduQuest بمعايير صناعية حقيقية لا افتراضات. المصادر في آخر الملف.

## 1) الحكم الأهم أولاً: قرار العزل الأساسي في EduQuest **صحيح فعلاً**، ليس نقطة ضعف

كنت سأفترض أن اعتماد جدول مشترك + `tenant_id` + Postgres RLS (بدل قاعدة/schema منفصلة لكل مستأجر) قد يكون تبسيطاً ساذجاً لمشروع فردي. **البحث يقول العكس تماماً:**

> "For almost every SaaS, the right multi-tenant architecture is a shared Postgres database with a shared schema, where every tenant row carries an account_id and Row Level Security enforces isolation at the database... it's the cheapest to operate, the easiest to run migrations against, and it scales further than founders expect."

هذا بالضبط ما بنيته. **القرار المعماري الجوهري لـ EduQuest متوافق مع الإجماع الصناعي لعام 2026، لا يحتاج إعادة تفكير.** البديل (schema/قاعدة منفصلة لكل مستأجر) يُنصَح به فقط عند الحاجة التعاقدية/التنظيمية للعزل الفيزيائي، أو عند تجاوز بضع مئات من المستأجرين — EduQuest بعيد عن هذه النقطة حالياً.

## 2) ماذا يملك Canvas/Moodle/Open edX ولا تملكه EduQuest — فجوات حقيقية مكتشَفة بالمقارنة

| العنصر | Canvas | Moodle | Open edX | EduQuest الآن | الفجوة |
|---|---|---|---|---|---|
| **طبقة تخزين مؤقت (Cache)** | Redis | Redis (موصى به رسمياً للتوسع) | Redis/Memcached | **لا توجد** | فجوة حقيقية — كل قراءة تذهب مباشرة لـ Postgres |
| **طابور مهام خلفية (Job Queue)** | Sidekiq/Redis | Cron + Task API | Celery | **لا يوجد** — مؤكَّد في المرحلة 3: حذف مؤسسة كاملة ينفَّذ في حلقة تسلسلية داخل طلب HTTP واحد | فجوة حقيقية، ولها حل مجاني جاهز (أدناه) |
| **معالجة مخصصة (Dedicated Compute)** | خوادم AWS مخصصة، أفقية التوسع | خوادم مخصصة قابلة للتجميع (cluster) | خوادم Kubernetes | **Serverless مشترك على خطة مجانية** | مؤكَّد تجريبياً في المرحلة 6 كأول اختناق حقيقي |
| **معيار تكامل مؤسسي (LTI)** | يدعم LTI 1.3 (معيار الصناعة) | يدعم LTI 1.3 | يدعم LTI | **غير موجود** | يمنع أي تكامل مع أنظمة الجامعات القائمة — حاجز حقيقي أمام مبيعات B2B |
| **سجل تدقيق (Audit Log) شامل** | نعم | نعم (Logs API) | نعم | جزئي (بعض RPCs توثّق `p_actor`، لا يوجد سجل موحَّد) | فجوة متوسطة |
| **فصل قراءة/كتابة أو Replica** | نعم عند الحجم الكبير | يُنصَح به رسمياً عند التوسع | نعم | لا يوجد (ولا حاجة له بعد عند الحجم الحالي) | غير عاجل |

## 3) لماذا Vercel Serverless هو الاختناق الحقيقي (ربط مباشر بنتيجة المرحلة 6)
Canvas وMoodle وOpen edX الثلاثة تعمل على **خوادم مخصصة قابلة للتوسع الأفقي المتحكَّم به** (AWS EC2/ECS، أو عناقيد Kubernetes) — ليس على دوال Serverless مشتركة بخطة مجانية. هذا يفسّر بدقة لماذا انهار موقع EduQuest عند 50 طلباً متزامناً فقط بينما هذه المنصات تخدم ملايين المستخدمين: **الفارق ليس في جودة الكود، بل في نوع طبقة الاستضافة ذاتها.** Serverless (Vercel) مناسب تماماً لمرحلة التحقق من الفكرة (MVP) بسبب تكلفته شبه الصفرية وسهولة النشر، لكنه **يحتاج ترقية لخطة مدفوعة قبل أي حمل حقيقي** — بالضبط ما أوصت به المرحلة 6.

## 4) ابتكارات EduQuest التي لا تملكها المنصات التقليدية (نقطة قوة حقيقية، لا تفريط بها)

> **⚠️ تصحيح (2026-09-13):** الفقرة أدناه تصف المراقبة بأنها "Gemini Vision". هذا **لم يعد صحيحاً** (ولم يكن مفعَّلاً فعلياً وقتها): طبقة Gemini كانت معطَّلة، ثم حُذفت نهائياً، والمراقبة الآن **بالكامل على جهاز الطالب** (MediaPipe + TensorFlow.js) بتكلفة AI صفرية — انظر [fixes/08-proctoring-FIXES.md](fixes/08-proctoring-FIXES.md). التمايز التسويقي باقٍ بل أقوى (لا تكلفة لكل طالب)، لكن الوصف التقني أدناه قديم.
المراقبة الذكية بالذكاء الاصطناعي (Gemini Vision) المدمجة أصلاً في المنصة **ليست ميزة قياسية** في Canvas/Moodle/Open edX — هذه المنصات تعتمد أدوات مراقبة خارجية مدفوعة (Examity، Proctorio، Respondus) تُدمَج كطرف ثالث بتكلفة إضافية للجامعة. **كون EduQuest بنى هذا داخلياً ومجاناً (بالطبقة المجانية من Gemini) هو تمايز تسويقي حقيقي**، بشرط إصلاح مشكلة معدل الاستهلاك الموثّقة في المرحلة 8 (التصعيد عند الاشتباه بدل الاستطلاع الدوري).

## 5) حلول مبتكرة موصى بها (مبنية على بحث، كلها مجانية أو شبه مجانية)

### أ) طابور مهام خلفي بلا بنية تحتية جديدة: `pgmq`
البحث يؤكد: *"With self-hosted Supabase, you can handle background jobs directly in Postgres using pgmq... The most reliable pattern for background jobs is a database table that acts as a queue."* — `pgmq` امتداد Postgres مجاني بالكامل، متاح غالباً كـ extension جاهز في Supabase، **لا يحتاج خدمة خارجية جديدة ولا تكلفة إضافية.** هذا يحل مباشرة:
- حلقة `admin/delete-tenant` التسلسلية المكتشَفة في المرحلة 3 (حذف آلاف المستخدمين داخل طلب HTTP واحد).
- أي عملية دفعية مستقبلية (استيراد طلاب بالجملة، إرسال إشعارات جماعية).

**البديل المُدار (Inngest/Trigger.dev)** أفضل من ناحية تجربة المطوّر لكنه **مدفوع عند الحجم** (تكلفة تبدأ من $75-150/شهر عند 500 ألف مهمة/شهر حسب المصادر) — **لا يتوافق مع قيد "الذكاء الاصطناعي يبقى مجانياً" الموسَّع هنا ليشمل البنية التحتية عموماً في هذه المرحلة**؛ `pgmq` هو الخيار الصحيح الآن.

### ب) LTI 1.3 كبوابة مبيعات B2B حقيقية
أي جامعة حقيقية تدير أنظمة LMS قائمة (غالباً Moodle أو Blackboard محلياً) **لن تنتقل بالكامل لمنصة جديدة بسهولة**، لكنها قد تقبل EduQuest **كأداة مراقبة/تصحيح تُستدعى كأداة LTI من داخل نظامها الحالي**. هذا يحوّل نقطة ضعف ("لسنا LMS كاملاً بعد") لفرصة دخول سوقية أسرع من منافسة المنصات الكبرى مباشرة.

### ج) كاش خفيف بلا Redis
بما أن إضافة Redis كاملة تتعارض مع البساطة/التكلفة الحالية، ابدأ بـ:
- `fetch()` caching المدمج في Next.js لأي قراءة عامة غير حساسة لكل مستخدم (مثل صفحات `/pricing`, `/demo`).
- ISR (Incremental Static Regeneration) للصفحات التسويقية العامة بدل تحميلها ديناميكياً في كل مرة — يخفّف مباشرة الحمل الذي كشفته المرحلة 6 على الصفحة الرئيسية تحديداً (كانت أول ما ينهار).

## الخلاصة العملية لهذه المرحلة
لا حاجة لإعادة تصميم معماري جذري. **3 إجراءات محددة، غير مكلفة، تُغلق الفجوة الحقيقية بين EduQuest والمنصات العالمية دون التخلي عن بساطة المكدس الحالي:** (1) ترقية استضافة Vercel/Supabase (مرحلة 6)، (2) `pgmq` للمهام الخلفية، (3) ISR/caching للصفحات العامة. أما LTI فهو استثمار متوسط المدى يفتح باب مبيعات B2B حقيقي حين تصبح المنصة جاهزة تجارياً.

---
**المصادر:**
- [Canvas LMS Backend Infrastructure — DeepWiki](https://deepwiki.com/instructure/canvas-lms/2-backend-infrastructure)
- [Open edX Platform Architecture](https://docs.openedx.org/en/latest/developers/references/developer_guide/architecture.html)
- [Open edX Multi-Tenancy — eduNEXT](https://www.edunext.co/articles/open-edx-multi-tenancy-enhanced-features/)
- [Multi-Tenant SaaS Architecture with Postgres RLS](https://makerkit.dev/blog/tutorials/multi-tenant-saas-architecture)
- [Multitenant SaaS Patterns — Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-sql/database/saas-tenancy-app-design-patterns?view=azuresql)
- [Background Jobs and Queues for Supabase with pgmq](https://www.supascale.app/blog/background-jobs-and-queues-for-selfhosted-supabase-with-pgmq)
- [Inngest vs Trigger.dev vs BullMQ for Next.js 2026](https://www.buildmvpfast.com/blog/inngest-vs-trigger-dev-vs-bullmq-background-jobs-nextjs-2026)
- [Moodle Server Architecture: Scaling 100–10,000 Users](https://edzlms.com/moodle-hosting-server-architecture-scaling-2026/)
- [Moodle's performance at scale](https://moodle.com/news/moodle-scalability/)
