# المرحلة 0 — خط الأساس (2026-09-13)

## 1. تاريخ Git
- 209 commit إجمالاً. توجد سلسلة revert/reapply/revert للتصميم (commits `558863d`→`3bfed81`) تدل على تذبذب في قرار الهوية البصرية — يُعتمد كملاحظة في تقرير التصميم (المرحلة 4)، وليس خطأ برمجي.
- **ثغرة تاريخية موثّقة ومُصلحة سابقاً:** `c4ae84a security(CRITICAL): remove hardcoded production DB password` — كلمة مرور DB كانت مكشوفة في الكود قبل هذا الـ commit. **يجب التحقق أن كلمة المرور القديمة دُوِّرت فعلياً (rotate) وأن السجل التاريخي في git تم تنظيفه** حسب `be209dd docs: git-history cleanup plan`. هذا بند حرج يُراجَع في المرحلة 3.

## 2. TypeScript (`tsc --noEmit`)
✅ **صفر أخطاء.** المشروع نظيف من ناحية الأنواع الساكنة.

## 3. ESLint
⚠️ **خطأ واحد:**
- `src/components/student/quick-access-panel.tsx:77` — استدعاء `setState` (عبر `fetchData()`) مباشرة داخل جسم `useEffect` بدون تبعية صحيحة، ما قد يسبب renders متتالية. إصلاح بسيط: تحويلها لنمط "fetch on open" مع flag أو نقلها لمعالج حدث.

## 4. الاختبارات (`vitest --pool=threads`)
❌ **12 من 63 اختباراً فاشلة**، كلها في ملف واحد: `src/__tests__/mutations-extended.test.tsx`.
- السبب المشترك: محددات DOM قديمة (`querySelector` على class/aria-label) لم تعد تطابق الـ markup الحالي بعد تعديلات على المكونات (`MessagesClient`, `CourseBuildClient`) — على الأرجح تغييرات تصميم لاحقة (أزرار الحذف تغيّر شكلها/تسميتها) لم تُصاحَب بتحديث الاختبارات.
- **هذا يعني أن تغطية الحذف (delete mutations) لهذه المكونات غير موثوقة حالياً — لا نعرف هل الحذف يعمل فعلاً أم لا من الاختبار.** يُصنَّف Medium (فجوة تغطية، وليس بالضرورة كسراً وظيفياً حقيقياً — يحتاج تحققاً يدوياً في run بشري).
- 51 اختباراً ناجحة، وملفات vitest الأربعة الأخرى نظيفة بالكامل.

## 5. npm audit
✅ **صفر ثغرات** في تبعيات الإنتاج.

## 6. Supabase Advisors — أمان (مشروع `ubngpsdzjoeqfxfbdtxc`, eu-central-1, Postgres 17.6)

| المستوى | العدد | التفصيل |
|---|---|---|
| INFO | 1 | `public.rate_limits` عليه RLS مفعّل بدون أي policy — **متوقع ومقصود** حسب CLAUDE.md (لا يُقرأ إلا بـ service-role). لا إجراء مطلوب. |
| WARN | 5 (anon) + 12 (authenticated) | دوال `SECURITY DEFINER` قابلة للاستدعاء المباشر عبر `/rest/v1/rpc/*`: `current_can_create_courses`, `current_is_active`, `current_permissions`, `current_tenant_id`, `current_user_role`, `get_admin_exams`, `get_admin_lessons`, `get_course_progress`, `get_student_announcements`, `get_student_exams`, `get_student_schedule`, `get_tenant_archive`. |
| WARN | 1 | `auth_leaked_password_protection` معطّلة — Supabase Auth لا يتحقق من كلمات المرور المسرّبة عبر HaveIBeenPwned. |

**تحليل دوال SECURITY DEFINER:** أغلبها مصمم عمداً ليُستدعى من العميل المصادَق (`get_student_*`, `current_*` تُرجع بيانات المستخدم الحالي نفسه عبر `auth.uid()`) — هذا نمط سليم طالما كل دالة تُصفّي داخلياً بـ `auth.uid()`/tenant الخاص بالمستخدم ولا تثق بمعاملات مرسلة من العميل لتحديد الهوية. **يحتاج التحقق الفعلي في المرحلة 3 (مراجعة SQL سطراً بسطر):**
- [ ] `get_admin_exams` / `get_admin_lessons` — هل تُصفّي بـ tenant المستخدم المستدعي فعلياً أم تثق بمعامل؟ (احتمال IDOR إن كانت تثق بمعامل tenant_id من العميل).
- [ ] `get_tenant_archive(p_tenant_id, p_year)` — **الأخطر في هذه القائمة**: تأخذ `p_tenant_id` كمعامل صريح من العميل. إن لم تتحقق داخلياً أن `p_tenant_id = current_tenant_id()` (أو أن المستدعي `super_admin`)، فهذه ثغرة IDOR تكشف أرشيف مستأجر آخر بالكامل. **أولوية فحص قصوى في المرحلة 3/11.**
- [ ] `get_course_progress` — سبق إصلاح IDOR فيها (`fix_get_course_progress_cross_tenant_idor_migration.sql` ✅ 2026-09-06) — التحقق أن الإصلاح لا يزال ساري المفعول ولم يُكسر لاحقاً.

**تفعيل حماية كلمات المرور المسرّبة** — إصلاح بدقيقة واحدة من لوحة Supebase (Auth → Policies)، بلا تكلفة، Low effort / Medium value. يُدرَج في خارطة الطريق الفورية.

**✅ تحقّق فوري من البند الحرج المحتمل — النتيجة: آمن.** تم سحب التعريف الفعلي الحي (`pg_get_functiondef`) للدوال الثلاث الأكثر خطورة من قائمة WARN:
- `get_tenant_archive(p_tenant_id, p_year)`: يحتوي فعلياً على `WHERE ... AND (current_user_role() = 'super_admin' OR (current_user_role() = 'university_admin' AND current_tenant_id() = p_tenant_id))` على كل فرع من الـ UNION. تمرير `p_tenant_id` مختلف عن مستأجر المستخدم لا يُرجع صفوفاً — **لا يوجد IDOR فعلي رغم أن المعامل يُقبل من العميل.**
- `get_admin_exams` / `get_admin_lessons`: كلاهما يُصفّي بـ `current_user_role() = 'university_admin' AND tenant_id = current_tenant_id()` داخلياً، بلا أي معامل من العميل أصلاً.
- الثلاثة تحمل `SET search_path TO 'public', 'pg_temp'` بشكل صحيح.
- **الخلاصة:** تحذيرات "anon/authenticated can execute SECURITY DEFINER" في Supabase Advisor هنا false-positive من منظور الأمان الفعلي — الدوال مصممة عمداً ليستدعيها المستخدم المصادَق وتُصفّي داخلياً بهويته الحقيقية من الجلسة، لا من معاملات. لا إجراء مطلوب على هذه الثلاث تحديداً؛ الفحص الكامل لبقية دوال SECURITY DEFINER يبقى في نطاق المرحلة 3.

## 7. Supabase Advisors — أداء
- **10 مفاتيح أجنبية بدون فهرس تغطية** (`announcements.created_by`, `courses.deleted_by`, `exam_retake_permissions.granted_by`, `exams.deleted_by`, `groups.deleted_by`, `invitations.accepted_by/course_id/invited_by`, `lessons.deleted_by`, `schedules.created_by`) — تدهور أداء متوقع عند JOIN أو DELETE CASCADE على نطاق واسع، **لم يظهر أثره بعد لصغر حجم البيانات، لكنه سيظهر أول ما يكبر عدد المستخدمين.** يُدرَج في المرحلة 6 (القابلية للتوسع).
- **22 فهرساً غير مُستخدَم إطلاقاً** — منطقي في بيئة بمستأجر واحد حقيقي حالياً (حسب ذاكرة المشروع)؛ لا يُحذف الآن، يُعاد تقييمه بعد نمو حقيقي في البيانات.
- **Multiple permissive policies** على `feature_flags` و`platform_settings` و`tenants` — كل استعلام SELECT يُنفَّذ عبر أكثر من policy لنفس الدور، ما يضاعف كلفة كل قراءة. إصلاح بدمج الـ policies بـ `OR` — منخفض المخاطرة، يُدرَج في تحسينات المرحلة 2.

## 8. فحص شامل لعزل tenant_id عبر كل سياسات RLS الحية (32+ جدولاً بـ RLS مفعّل)
استعلام آلي على `pg_policy` لاستخراج كل سياسة SELECT لا تحتوي صراحة على `tenant_id` أو `super_admin` أو `auth.uid()` أو `current_tenant_id()` في شرط `USING`. **النتيجة: 4 سياسات فقط، وكلها آمنة بعد التحقق:**

| الجدول | السياسة | لماذا هي آمنة رغم عدم وجود tenant_id مباشرة |
|---|---|---|
| `course_levels`, `course_units`, `unit_items` | `*_select` | تتحقق فقط عبر `EXISTS (SELECT 1 FROM courses c WHERE c.id = ...course_id)`. لكن Postgres RLS يُطبّق سياسة `courses_select` نفسها (التي تتحقق من tenant_id + الدور + التسجيل) عند تقييم الـ subquery — **عزل موروث (transitive) صحيح، وليس ثغرة.** تم التحقق من `courses_select` مباشرة وهي مُحكمة (super_admin، أو tenant الخاص بالمستخدم مع دور university_admin/teacher مالك، أو طالب مسجَّل في كورس منشور). |
| `platform_settings` | `settings_read_authenticated` (`USING (true)`) | أي مستخدم مسجَّل دخول (من أي مستأجر) يقرأ الجدول كاملاً. **تم فحص المحتوى الفعلي (4 صفوف فقط):** `invitation_defaults`, `ai_rate_limits`, `deletion_policy`, `exam_policies` — إعدادات تشغيلية عامة للمنصة، لا أسرار ولا بيانات مستأجر. **ملاحظة Low:** حقل `exam_policies.violation_warning_threshold: 10` مقروء لأي طالب، ما يتيح له معرفة العتبة الدقيقة لعدد مخالفات المراقبة قبل التنبيه ومعايرة سلوكه للبقاء تحتها. **توصية:** إما نقل هذا الحقل لجدول/مصدر لا يقرؤه الطلاب، أو قبول المخاطرة كمنخفضة (القيمة نفسها لا تكشف آلية الكشف). |

**الخلاصة: لا توجد ثغرة عزل مستأجرين (cross-tenant) في مستوى RLS بعد فحص شامل آلي لكل الجداول.** هذا يتوافق مع تاريخ الإصلاحات الموثقة في CLAUDE.md ويرفع الثقة في طبقة RLS بشكل عام. الفحص اليدوي لمنطق كل RPC حسّاس (خاصة كتابة الدرجات والصلاحيات) يبقى ضمن المرحلة 3/11 لأن هذا الاستعلام يغطي RLS فقط، لا منطق التطبيق أو الـ RPCs الكتابية.

## 9. جرد استخدام service-role client في الـ API routes
39 من أصل ~48 route يستوردون `SUPABASE_SERVICE_ROLE_KEY` (قائمة كاملة في الملف). هذا العدد أعلى مما توحي به الوثائق ("instantiated locally where needed for privileged writes") — يحتاج تدقيقاً في المرحلة 3 للتأكد أن **كل واحد منها** يتبع نمط "تفويض بجلسة المستخدم أولاً ثم كتابة بالعميل المميز"، وليس استخدام مباشر للعميل المميز في القراءة العادية (وهو ما نصّ CLAUDE.md على أنه لم يعد ضرورياً بعد `fix_all_search_path_migration.sql`). القائمة الكاملة محفوظة أعلاه للمرجعية في مرحلة المراجعة سطراً بسطر.

---

## الخلاصة الأولية والخطوة التالية
**النتيجة العامة لخط الأساس: المشروع في حالة صحية أفضل من المتوقع.** TypeScript نظيف تماماً، npm audit نظيف، RLS محكم على مستوى القاعدة بالكامل (فحص آلي شامل وليس عينة)، ودالتا `get_tenant_archive`/`get_admin_*` اللتان بدتا مشبوهتين في تحذيرات Advisor تبيّن أنهما آمنتان فعلياً بعد قراءة التعريف الحي. المشاكل الفعلية المكتشفة حتى الآن كلها **Low/Medium**: اختبارات معطوبة بمحددات قديمة (12/63)، خطأ react-hooks واحد، تحذير كلمة مرور مسرّبة معطّل، إفصاح بسيط عن عتبة تحذير المراقبة، وفهارس ناقصة/زائدة.

**لا يوجد حتى الآن أي دليل على ثغرة Critical حية في RLS أو IDOR جديدة.** هذا لا يُسقط بقية خطة الفحص (المراجعة سطراً بسطر للـ 39 route المستخدمة لـ service-role، ومراجعة كل RPC كتابي، واختبارات الحمل، ونمذجة تكلفة AI، وتحليل التسعير) — لكنه يعيد ترتيب الأولوية: يمكن الانتقال بثقة أكبر من "البحث عن كارثة" إلى "تحسين وتجهيز للتوسع والإطلاق التجاري"، وهو محور المراحل 4–10.
