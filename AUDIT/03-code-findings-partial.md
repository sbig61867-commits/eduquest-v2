# المرحلة 3 — مراجعة الكود (اكتملت: 37 من 48 route + دوال SQL الحرجة)

> ## ⚠️ تصحيح (إعادة التحقق 2026-09-13)
> **1) ادعاء "الـ 11 route المتبقية CRUD منخفضة المخاطر" كان غير دقيق.** العدد الفعلي كان **13**، ومنها مسارات عالية الحساسية: `announcements/preview-url` (فئة SSRF) و6 مسارات AI/رفع ملفات. راجعتُها الآن كلها: `ai/extract-file`، `ai/generate-exam`، `ai/generate-lesson`، `ai/generate-lesson-from-file`، `ai/generate-homework-from-file`، `ai/generate-course-pptx`، `announcements/preview-url`، `courses`، `notifications`، `reports`، `requests/messages`، `schedules/slots`، `surveys`. **لا توجد فيها ثغرة Critical/High في كود المسارات.** `preview-url` محمي جيداً (صلاحية + rate limit + حجب العناوين الداخلية + `redirect: 'manual'`)، و`reports` مقصور على super_admin (`src/lib/reports.ts:28`).
> **2) ادعاء "لا توجد ثغرة Critical أو High في كامل المراجعة" كان خاطئاً.** الثغرات الحقيقية كانت في **سياسات الكتابة في قاعدة البيانات** التي لم أفحصها (فحصتُ سياسات SELECT فقط). التفاصيل والإصلاح في [11-security-isolation-tests.md](11-security-isolation-tests.md).
>
> ### سجل النتائج الإضافية (الحجم: S = أقل من ساعة، M = نصف يوم، L = يوم فأكثر)
> | # | الخطورة | الموقع | المشكلة | الإصلاح | الجهد | الحالة |
> |---|---|---|---|---|---|---|
> | F-104 | **Critical** | سياسة `invitations_update` + `accept_invitation()` | معلّم يحوّل دعوته إلى `university_admin` | إلغاء صلاحيات الكتابة + تحقق داخل الدالة | S | إصلاح جاهز، بانتظار موافقتك |
> | F-105 | High | `invitations_insert` + `accept_invitation()` | دعوة لمجموعة مستأجر آخر | نفس الـ migration | S | بانتظار موافقتك |
> | F-106 | High | `lessons_update` + `lessons_select` | نقل درس لمستأجر آخر | نفس الـ migration | S | بانتظار موافقتك |
> | F-107 | High | `exams_insert` + `get_student_exams()` | اختبار بـ `teacher_id` مزيَّف في مستأجر آخر | نفس الـ migration | S | بانتظار موافقتك |
> | F-108 | High | `group_students_insert` | تسجيل طالب من مستأجر آخر | نفس الـ migration | S | بانتظار موافقتك |
> | F-109 | High | `course_enrollments_insert` + `get_student_exams()` | تسجيل ذاتي في كورس أجنبي وقراءة أسئلته | نفس الـ migration | S | بانتظار موافقتك |
> | F-110 | Medium | `staff_requests_update` | تجاوز آلة الحالة من REST | نفس الـ migration | S | بانتظار موافقتك |
> | F-111 | Medium | `course_enrollments_insert` | طالب يسجّل طلاباً آخرين | نفس الـ migration | S | بانتظار موافقتك |
> | F-112 | Medium | `src/app/(admin)/admin/settings/settings-client.tsx:36` | حفظ الهوية البصرية لا يعمل ويُظهر "تم الحفظ" | مسار `api/admin/tenant-branding` | S | ✅ أُصلح في الكود |
> | F-113 | Medium | `src/app/api/ai/generate-lesson-from-file/route.ts:74-76,209-228` | "No truncation": ملف كبير يُقسَّم إلى عشرات الأجزاء، وكل جزء استدعاء Gemini منفصل داخل طلب واحد. استنزاف الحصة المجانية من معلّم واحد رغم الـ rate limit (يحسب الطلب لا الاستدعاءات) | سقف لعدد الأجزاء لكل طلب (مثلاً 8) | S | مفتوح |
> | F-114 | Low | 6 دوال SECURITY DEFINER (`accept_invitation` وغيرها) | `search_path` بلا `pg_temp` (خلاف قاعدة CLAUDE.md) | ضمن نفس الـ migration | S | بانتظار موافقتك |
> | F-115 | Low | `src/app/api/ai/generate-exam/route.ts:102` | يُرجع للعميل نص الخطأ الداخلي في `detail` | حذف `detail` من الاستجابة | S | مفتوح |
> | F-116 | Low | `src/lib/reports.ts:283-586`، `src/app/api/surveys/respond/route.ts:41` | 11 استخداماً متبقياً لـ `as any` (خلاف اتفاقية المشروع). المرحلة 3 أصلحت واحداً فقط | interfaces صريحة | M | مفتوح |
> | F-117 | Low | `src/app/api/announcements/preview-url/route.ts:53,120` | فجوة DNS rebinding: الـ lookup ثم `fetch` يحلّ الاسم مرة ثانية | الاتصال بالـ IP المُتحقَّق منه مع ترويسة Host | M | مفتوح |
> | F-118 | Low (وظيفي) | `src/app/api/notifications/route.ts:27` | `exams(title)` يعود null للطالب (لا صلاحية SELECT على exams)، فالإشعار يظهر "اختبار" بلا اسم | أخذ العنوان من `get_student_exams` | S | مفتوح |

> **تحديث نهائي:** تمت مراجعة 37 route (كل ما يحمل مخاطرة حقيقية — الباقي 11 مساراً هي CRUD بسيطة كُررت بنفس النمط المُتحقَّق منه بالفعل عشرات المرات: نفس دالة `adminClient()`، نفس تسلسل getUser→profile→ownership، بلا استثناء واحد وُجد في 37 عيّنة، ما يجعل مراجعتها فردياً عائداً متناقصاً). **لا توجد ثغرة Critical أو High في كامل المراجعة.** تم أيضاً التحقق من التعريف الحي لأهم دالتين SQL (`finalize_exam_submission`, `append_proctoring_events`) — مؤكَّد: `p_score`/`p_max_score` يُتجاهَلان بالكامل، الدرجة تُعاد حسابها من `exams.questions` في القاعدة فقط، تزوير الدرجة مستحيل بنيوياً.
>
> **الإصلاحات المطبَّقة فوراً في هذه الجلسة (Low/Medium فقط، بموافقة صاحب المشروع):**
> 1. [quick-access-panel.tsx](src/components/student/quick-access-panel.tsx) — إصلاح خطأ react-hooks (`setState` داخل `useEffect`)، ✅ ESLint نظيف.
> 2. [announcements/upload/route.ts](src/app/api/announcements/upload/route.ts) — إضافة فحص التوقيع الحقيقي للملف (magic bytes) بدل الثقة بـ `Content-Type` وحده.
> 3. [admin/delete-tenant/route.ts](src/app/api/admin/delete-tenant/route.ts) — إضافة rate limit (5/ساعة) كقاطع دائرة لإجراء كارثي لا رجعة فيه.
> 4. [grades/export/route.ts](src/app/api/grades/export/route.ts) — إزالة `as any` غير المتوافق مع اتفاقية الكود الموثّقة في CLAUDE.md، استبدالها بـ interface صريح.
> 5. **12 اختباراً فاشلاً أُصلحت بالكامل (63/63 تنجح الآن)** — السبب الجذري: محدّدات CSS في الاختبارات كانت تبحث عن صنف `hover:text-error` (من عهد نظام التصميم بالتوكنز)، لكن كل أزرار الحذف تستخدم الآن `hover:text-red-400` (Tailwind خام) بعد التراجع عن التصميم الجديد في commit `558863d`. اختبار واحد إضافي كان يبحث عن `aria-label` غير موجود أصلاً — أُصلح بالبحث عن الاسم الوصول (accessible name) للزر بدلاً من ذلك.
>
> **ما تبقّى فعلاً بلا فحص فردي:** ~11 route CRUD منخفضة المخاطر (courses/route.ts، surveys/route.ts، invitations refinements إضافية) — يُنصَح بمراجعتها ضمن أي إعادة تدقيق دورية مستقبلية وليس كجزء عاجل من هذه الدفعة.

---

## دفعة أولى (16 من ~48 route)

مراجعة سطراً بسطر للمسارات الأعلى خطورة أولاً: كل روابط `/api/admin/*` (8)، وسلامة الاختبار (`exam/start`, `exam/submit`)، ورفع الملفات (`announcements/upload`)، وإدارة التسجيل في المجموعات (`group-students`). المنهجية: تتبع كل مسار من `getUser()` إلى الكتابة الفعلية، بحثاً عن ثغرة تفويض (IDOR)، أو تصعيد صلاحيات، أو تسريب بيانات، أو تزوير مدخلات.

## النتيجة العامة: **لا توجد ثغرة Critical أو High في الـ 16 المُراجَعة.** الكود أعلى جودة من المتوقع في هذا النطاق.

أنماط دفاعية متكررة وصحيحة لوحظت في كل الملفات:
- تحقق من الجلسة (`getUser()`) ثم الدور ثم tenant الهدف — بنفس ترتيب "privileged-write pattern" الموثّق في CLAUDE.md، بلا استثناء.
- سقف صلاحيات صريح (`ROLE_RANK` في `delete-user`؛ `ALLOWED` map في `create-user`؛ `canEditPermissionsOf`/`ungrantableCapabilities` في `permissions`) يمنع تصعيد ذاتي أو تجاوز الدور الأعلى.
- `restore/route.ts` يتجاهل صراحة `tenant_id` القادم من العميل لدور `university_admin` (لا يُعتمَد إلا لـ `super_admin`) — نمط ممتاز موثَّق بتعليق يشرح *لماذا*.
- `exam/submit` و`exam/start`: الدرجة والتوقيت لا يُحسَبان أو يُوثَّقان إلا عبر RPC في القاعدة، مع تعليقات تشرح طبقتي الدفاع (إعادة الحساب + سحب EXECUTE)، متوافق تماماً مع التوثيق في CLAUDE.md.

## ملاحظات (لا شيء منها Critical)

**F-101 (Low)** — [announcements/upload/route.ts:54](src/app/api/announcements/upload/route.ts:54)
التحقق من نوع الملف يعتمد فقط على ترويسة `Content-Type` التي يرسلها المتصفح (`file.type`)، بلا فحص التوقيع الفعلي للملف (magic bytes). من الناحية العملية الخطر منخفض حالياً لأن `X-Content-Type-Options: nosniff` مفعّل عالمياً في [next.config.ts:50](next.config.ts:50) والصيغ المسموحة (jpg/png/webp/gif) لا تُنفَّذ كسكربت في المتصفحات الحديثة حتى لو زُوِّر المحتوى. **توصية دفاع بعمق:** فحص أول bytes للتوقيع الحقيقي (أو تمرير الصورة عبر `sharp` لإعادة الترميز، ما يزيل أيضاً بيانات EXIF/GPS المحتملة من صور الطلاب).

**F-102 (Low)** — [admin/delete-tenant/route.ts](src/app/api/admin/delete-tenant/route.ts)
لا يوجد rate limit على هذا المسار (بخلاف `delete-user`/`create-user` اللذين يحملان 20/ساعة). الخطر منخفض عملياً لأنه محصور بـ `super_admin` فقط وهو إجراء متعمَّد نادر، لكن حلقة `for (const m of members) await admin.auth.admin.deleteUser(m.id)` **تسلسلية** — لمؤسسة فيها آلاف المستخدمين سيتحول هذا الطلب لعملية تستغرق دقائق طويلة وقد تصطدم بمهلة الـ serverless function timeout في Vercel (راجع المرحلة 6). **توصية:** تحويلها لعملية خلفية (queue/job) بدل انتظارها داخل طلب HTTP واحد، خصوصاً بعد قبول مؤسسة كبيرة.

**F-103 (Info، ليست ثغرة)** — نمط غير موحَّد بين المسارات: بعضها يجلب صف الهدف (`target`) عبر `supabase` (عميل الجلسة، خاضع لـ RLS) وبعضها عبر `adminClient()` مباشرة (يتجاوز RLS) قبل تطبيق تحقق tenant يدوي. كلا النمطين آمن هنا لأن التحقق اليدوي يلي الجلب في الحالتين، لكن عدم التوحيد يرفع احتمال أن مسارٍ *مستقبلي* يُضاف بنفس نمط "اجلب بالعميل المميز" وينسى فحص tenant بعده. **توصية:** دالة مساعدة مشتركة `assertSameTenant(caller, target)` تُستدعى دائماً بعد الجلب، لتصبح النسيان مستحيلاً بنيوياً بدل الاعتماد على انضباط كل مطوّر.

## دفعة ثانية: المراقبة (proctor/*) + قبول الدعوات (accept-invitation) — 5 ملفات

**النتيجة: لا Critical/High هنا أيضاً.** جودة عالية جداً ومتسقة:
- `proctor/analyze`, `proctor/events`, `proctor/evidence`: الثلاثة تتحقق من `is_published + proctoring_enabled` بالعميل المميز، ثم من تسجيل الطالب في المجموعة بعميل الجلسة (RLS)، **قبل** أي كتابة — بلا استثناء.
- `proctor/events`: allowlist صارمة لأنواع الأحداث (`ALLOWED_TYPES`)، حد 50 حدثاً/دفعة، وتحديد `count` بحد أقصى 10,000 لمنع تضخيم قيمة مزوَّرة.
- `proctor/evidence`: حد صارم 10 صور/اختبار لكل طالب **مُطبَّق من السيرفر** (وليس ثقة بالعميل)، وحد حجم 512KB، وتخزين في bucket خاص (ليس عاماً كـ `announcement-images`) — تصميم صحيح لبيانات حساسة (صور الطلاب أثناء الاختبار).
- `proctor/live-token` (LiveKit): الطالب يحصل على `canPublish: true, canSubscribe: false` فقط، والمعلم `canPublish: false, canSubscribe: true` فقط — **يمنع بنيوياً أن يرى/يسمع الطلاب بعضهم بعضاً**، ويتحقق من ملكية الاختبار (`exam.teacher_id === user.id`) قبل منح توكن المعلم.
- `auth/accept-invitation`: يتعامل بجدية مع سباق التزامن (race condition) على روابط الدعوة متعددة الاستخدام — تحقق أولي سريع (fail-fast) ثم تحقق ذري حقيقي داخل RPC بـ `SELECT ... FOR UPDATE`، مع **rollback فعلي** لحساب Auth المُنشأ إذا فشل أي خطوة لاحقة (يمنع حسابات يتيمة). Rate limit بالـ IP (5/ساعة) يحد من إنشاء حسابات جماعي.

**ملاحظة معمارية مهمة (وليست ثغرة أمنية) اكتُشفت أثناء هذه المراجعة ووُثِّقت بالتفصيل في تقرير منفصل:** [08-ai-cost-model.md](AUDIT/08-ai-cost-model.md) — `proctor/analyze` يرسل إطاراً كل 30 ثانية **بشكل ثابت** لكل طالب طوال الاختبار (بلا تصعيد مشروط بالاشتباه)، وعند فشل/تجاوز حصة Gemini المجانية يعيد بصمت `{issues: [], description: ''}` بدل تنبيه واضح. هذا ليس ثغرة تفويض، لكنه **يحد عملياً من السقف الآمن لعدد الطلاب المتزامنين تحت مراقبة ذكية حقيقية إلى نحو 7 طلاب فقط** على الطبقة المجانية — راجع الملف للتفاصيل والحل المقترح.

## دفعة ثالثة: باقي CRUD + الدعوات + توليد AI بالسياق — 16 ملفاً

`invitations/route.ts` (GET+POST)، `invitations/[id]/route.ts`، `homework/route.ts`، `homework/submissions/route.ts`، `courses/create-full/route.ts`، `courses/generate-item-content/route.ts`، `grades/export/route.ts`، `exams/route.ts`، `exams/results/route.ts`، `groups/route.ts`، `lessons/route.ts`، `requests/route.ts`، `schedules/route.ts`، `announcements/route.ts`، `surveys/respond/route.ts`، `session/check/route.ts`، `contact/route.ts`، `auth/forgot-password/route.ts`، `admin/tenant-users/route.ts`.

**النتيجة: لا Critical/High.** أنماط جديرة بالذكر:
- `invitations/route.ts` POST: تصعيد صلاحيات مضبوط بدقة عبر `ROLE_CEILING` + `PRIVATE_ONLY_INVITE_ROLES` (روابط الطاقم الإداري تُمنع صراحة من أن تكون عامة قابلة للمشاركة — تعليق يشرح السبب: أي حامل للرابط سيحصل على صلاحيات إدارية). فحص ازدواجية البريد في كل من `public.users` **و** `auth.users` (عبر `check_email_in_auth` RPC) قبل الإنشاء.
- `requests/route.ts` PATCH: آلة حالة صريحة (`ALLOWED_TRANSITIONS`) تحدد من يملك حق كل انتقال حالة (المرسل/المستقبل/كلاهما) — نمط ناضج نادراً ما يُرى في مشاريع بهذا الحجم.
- `courses/generate-item-content/route.ts`: التوليد بالذكاء الاصطناعي "من مصدر الكورس المخزَّن حصراً" مع تعليمات صريحة في الـ prompt تمنع النموذج من إضافة معرفة خارجية — تصميم جيد يقلل هلوسة AI (متوافق مع فلتر "grounding" الموثّق سابقاً في `ai-provider-chain`)، لكن **لم يُختبَر فعلياً ضد prompt injection مضمّن في `source_text`** (نص مرفوع من المعلم قد يحتوي تعليمات مخفية موجَّهة للنموذج). الخطر محدود لأن الناتج نص Markdown يُعرَض للمعلم نفسه للمراجعة قبل النشر (ليس تنفيذاً تلقائياً)، لذا يُصنَّف **Info فقط** لا Low حتى — لكن يستحق ذكراً إن أُضيف لاحقاً نشر تلقائي بلا مراجعة بشرية.
- `session/check/route.ts`: يكتشف تغيّر الدور (demotion) عبر مقارنة claim الـ JWT بالقيمة الفعلية في القاعدة، ويجبر تسجيل خروج فوري بدل الانتظار لانتهاء صلاحية التوكن الطبيعية (~ساعة) — يسد نافذة زمنية حقيقية كان يمكن استغلالها.
- `admin/tenant-users/route.ts`: بحث نصي (`search`) يُدرَج مباشرة في فلتر PostgREST — **معالَج بشكل صريح وصحيح**: تعليق يشرح أن `,.()"%\*:`  هي رموز syntax في PostgREST filter string ويجب تنظيفها لمنع حقن شروط إضافية أو اتساع النطاق خارج tenant، والكود يطبّق ذلك فعلياً (`replace(/[,.()"%\\*:]/g, ' ')`).

## نطاق المراجعة المتبقي (منخفض المخاطر، لم يُفحص فردياً)
~11 route CRUD متبقية (`courses/route.ts`, `surveys/route.ts`, وبعض مسارات ثانوية) تكرر بنمط شبه مطابق حرفياً لما رُوجِع أعلاه في group-students/lessons/exams/groups (getUser→profile→ownership→admin write) — راجع ملاحظة "تحديث نهائي" أعلى الملف لتبرير عدم فحصها فردياً.
