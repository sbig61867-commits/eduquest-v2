# خطة إصلاح مشاكل EduQuest — تعليمات لنموذج Sonnet

> **قبل أي شيء:** اقرأ `eduquest-v2/CLAUDE.md` (هو مصدر الحقيقة). **تجاهل** الملف القديم `C:\Users\Victus\Downloads\CLAUDE.md` — محتواه قديم ومضلل (يذكر Anthropic/Vercel بينما المشروع فعلياً على Groq + Gemini + Next 16).
>
> اعمل مشكلة واحدة في كل مرة. بعد كل إصلاح شغّل `npm run build` وتأكد أنه ينجح قبل الانتقال. لا تعطّل RLS. لا تحذف ملفات بدون إذن.

---

## المشكلة #1 (🔴 خطيرة — أمن العزل بين المستأجرين)

### الشرح
عزل الجامعات (tenants) مصمَّم ليُفرض عبر **Row Level Security في Postgres** وليس في كود التطبيق (انظر `CLAUDE.md` → "tenant isolation is enforced by Postgres RLS, not application code").

لكن الواقع: **صفحات القراءة** تستخدم الـ **admin client (`SERVICE_ROLE_KEY`) الذي يتجاوز RLS بالكامل**، ثم تعتمد على فلاتر يدوية `.eq('tenant_id', ...)` للعزل. السبب المكتوب في التعليقات: دوال RLS المساعِدة كانت تُرجع NULL بسبب مشكلة `search_path` (المشكلة #2).

الخطر: أي استعلام واحد ينسى `.eq('tenant_id', ...)` = **تسريب بيانات بين الجامعات**. هذا يكسر النموذج الأمني الأساسي للمنصة.

### التمييز المهم — لا تلمس كل الملفات الـ35
استخدام الـ admin client **مشروع ومقصود** في **route handlers للكتابة المميّزة** (نمط: تحقق من الهوية بجلسة المستخدم ← تحقق أن الهدف ضمن نفس الـ tenant ← نفّذ الكتابة بالـ admin client). هذه **اترُكها كما هي**:
- كل ما في `src/app/api/admin/*`
- `api/auth/accept-invitation/route.ts`
- `src/lib/rate-limit.ts`
- `api/exam/start`, `api/exam/submit`, `api/proctor/analyze` (server-authoritative عمداً)

**الملفات التي يجب إصلاحها = صفحات القراءة (RSC) التي تستخدم admin client فقط بسبب مشكلة RLS:**
- `src/app/(admin)/admin/dashboard/page.tsx`
- `src/app/(admin)/admin/invitations/page.tsx`
- `src/app/(super-admin)/super-admin/reports/page.tsx`
- `src/app/(teacher)/teacher/courses/page.tsx`
- `src/app/(teacher)/teacher/dashboard/page.tsx`
- `src/app/(teacher)/teacher/exams/page.tsx`
- `src/app/(teacher)/teacher/groups/page.tsx`
- `src/app/(teacher)/teacher/invitations/page.tsx`
- `src/app/(teacher)/teacher/lessons/page.tsx`
- `src/app/(teacher)/teacher/lessons/[id]/page.tsx`
- `src/app/(auth)/join/[token]/page.tsx` (راجعه بحذر — قد يحتاج admin لأن المستخدم قد لا يكون عضو tenant بعد)

كذلك راجع route handlers للقراءة (GET) التي تستخدم admin: `api/groups`, `api/exams`, `api/lessons`, `api/homework`, `api/courses`, `api/group-students`, `api/invitations` — إن كانت تقرأ فقط، يجب أن تعتمد على RLS بدل admin.

### طريقة الحل (بعد تطبيق المشكلة #2 أولاً)
1. **طبّق إصلاح RLS أولاً** (المشكلة #2). بدونه سيرجع كل استعلام 403/فارغ.
2. في كل صفحة قراءة من القائمة أعلاه، استبدل:
   ```ts
   import { createClient as createAdminClient } from '@supabase/supabase-js'
   const admin = createAdminClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!)
   // ... admin.from('groups').select(...).eq('tenant_id', profile.tenant_id)
   ```
   بـ **الـ user session client الذي يخضع لـ RLS**:
   ```ts
   import { createClient } from '@/lib/supabase/server'
   const supabase = await createClient()
   // RLS تفرض العزل تلقائياً — احتفظ بـ .eq('tenant_id') كطبقة دفاع إضافية (defense in depth)
   const { data } = await supabase.from('groups').select(...)
   ```
3. احتفظ بالفلاتر اليدوية `.eq('tenant_id', ...)` و `.eq('teacher_id', ...)` كـ **defense-in-depth** — لا تحذفها، فقط لم تعد الحاجز الوحيد.
4. تحقّق أن كل صفحة ما زالت تعرض بياناتها الصحيحة بعد التحويل (RLS يجب أن تسمح للمعلم برؤية مجموعاته، وللـ admin برؤية جامعته).

### التحقق
- `npm run build` ينجح.
- سجّل دخول كمعلم واحد وتأكد أنه يرى مجموعاته فقط (لا يرى مجموعات جامعة أخرى).
- لم يبقَ أي `SERVICE_ROLE` في ملفات `page.tsx` (تحقق: `grep -rln SERVICE_ROLE src/app/**/page.tsx`).

---

## المشكلة #2 (🔴 السبب الجذري — search_path في دوال RLS)

### الشرح
الدالتان `current_user_role()` و `current_tenant_id()` هما `SECURITY DEFINER` لكنهما (تاريخياً) لم تثبّتا `search_path`. تحت PostgREST يعمل الدور `authenticated` بـ `search_path` مقيّد، فيفشل `FROM users` (خطأ 42P01)، فترجع الدالة NULL، فترفض **كل** سياسة RLS تستدعيها الكتابة بـ **403 Forbidden**. هذا هو السبب الأصلي الذي دفع المطور لاستخدام admin client (المشكلة #1).

### طريقة الحل
الإصلاح جاهز في الملف `supabase/fix_helper_search_path.sql`. **يجب تطبيقه يدوياً في Supabase SQL Editor** (المشروع لا يستخدم migration CLI):
```sql
CREATE OR REPLACE FUNCTION public.current_user_role() ... SET search_path = public, pg_temp ...
CREATE OR REPLACE FUNCTION public.current_tenant_id() ... SET search_path = public, pg_temp ...
```
خطوات إضافية على Sonnet:
1. **دقّق كل دالة `SECURITY DEFINER` أخرى** في `supabase/*.sql` وتأكد أن كلاً منها: (أ) يستعمل أسماء مؤهّلة بالschema (`public.users` لا `users`)، و(ب) فيها `SET search_path = public, pg_temp`. أصلح أي دالة تنقص ذلك في ملف migration جديد قابل لإعادة التشغيل.
2. حدّث `schema.sql` ليعكس الحالة الجديدة (القاعدة في `CLAUDE.md`: عدّل `schema.sql` + أضف ملف migration مستقل).
3. اكتب تعليمة واضحة للمستخدم بتشغيل الـ SQL في المحرر (لا يمكنك تطبيقه أنت على القاعدة الحيّة).

### التحقق
- بعد التطبيق: معلم يستطيع إنشاء group/lesson/exam بدون 403.
- استعلام تحقق في SQL Editor: `SELECT public.current_tenant_id();` يجب ألا يرجع NULL لمستخدم مسجّل.

---

## المشكلة #3 (🟡 توثيق متناقض ومضلل)

### الشرح
- الملف `C:\Users\Victus\Downloads\CLAUDE.md` (خارج المستودع) قديم: يذكر `claude-sonnet-4-6` وAnthropic SDK وVercel وNext 14، بينما المشروع فعلياً: **Groq (`llama-3.3-70b-versatile`) + Gemini (`gemini-2.0-flash`) + Next 16 + React 19**.
- "سجل الإنجازات" في CLAUDE.md فارغ رغم إنجاز ميزات كثيرة (courses, exams, proctoring, reports...).

### طريقة الحل
1. لا تعدّل الملف خارج المستودع إلا بإذن؛ بدلاً منه اعتمد فقط على `eduquest-v2/CLAUDE.md`.
2. حدّث "سجل الإنجازات"/الحالة في `eduquest-v2/CLAUDE.md` ليعكس الميزات المكتملة فعلياً (استنتجها من `git log` و`src/app`).
3. لا تكرر ذكر Anthropic/Vercel في أي توثيق جديد — استعمل Groq/Gemini/Vercel-or-actual.

### التحقق
مراجعة بشرية — تأكد أن التوثيق يطابق `package.json` و`src/lib/ai/*`.

---

## المشكلة #4 (🟢 تحذيرات lint بسيطة)

### الشرح
`npx eslint .` يعطي 4 تحذيرات (0 أخطاء): imports/متغيرات غير مستخدمة.

### طريقة الحل
- `src/app/(teacher)/teacher/lessons/[id]/lesson-detail-client.tsx`: احذف `Eye`, `EyeOff` من الـ import (سطر 10) والمتغير `groups` غير المستخدم (سطر 38) — أو استخدمها إن كانت مقصودة.
- `src/lib/reports.ts` سطر 27: المعامل `_scope` غير مستخدم — احذفه أو استعمله (البادئة `_` قد تكون مقصودة؛ إن كان كذلك اتركه).

### التحقق
`npx eslint .` بلا تحذيرات (أو تحذيرات مقصودة موثّقة).

---

## ترتيب التنفيذ الموصى به
1. **المشكلة #2** (search_path) — السبب الجذري، تُطبَّق في SQL Editor.
2. **المشكلة #1** (إزالة admin client من صفحات القراءة) — تعتمد على #2.
3. **المشكلة #3** (توثيق).
4. **المشكلة #4** (lint).

بعد كل خطوة: `npm run build` + اختبار يدوي بحساب معلم/أدمن. لا تجمع أكثر من مشكلة في commit واحد.
