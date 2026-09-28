-- ════════════════════════════════════════════════════════════════════════
-- Demo data  (2026-09-28)
-- ════════════════════════════════════════════════════════════════════════
-- Two clearly-labelled demo institutions for trying the platform end to end:
--
--   1. «مركز النور للتدريب (تجريبي)»  — an INDEPENDENT training centre
--      institution_type = training_center, has_center = false
--      admin (university_admin, shown as «مدير مركز التدريب»), 2 trainers,
--      5 trainees, 2 cohorts (دفعات), a lesson + a published exam per cohort,
--      1 announcement.
--   2. «جامعة الأمل (تجريبية)»  — a UNIVERSITY with its continuing-education centre
--      institution_type = university, has_center = true
--      admin, 1 centre manager (some capabilities ON), 2 teachers,
--      4 university students + 2 centre-only trainees, 2 groups,
--      a lesson + a published exam per group, 1 announcement.
--
-- Every id starts with dd000000-, every email ends in @demo.eduquest.test and
-- every tenant slug starts with demo-, so supabase/demo_cleanup.sql removes
-- exactly this and nothing else.
--
-- The password is NOT stored here: replace __DEMO_PASSWORD__ at run time.
-- Idempotent: re-running skips rows that already exist.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- Creates (or reuses) an email/password login and shapes its profile row.
-- handle_new_user makes the placeholder profile; sync_user_claims mirrors
-- role / tenant / is_active into the JWT claims when we update it.
CREATE OR REPLACE FUNCTION pg_temp.demo_user(
  p_id uuid, p_email text, p_name text, p_role text, p_tenant uuid, p_pw text,
  p_permissions jsonb DEFAULT '{}'::jsonb, p_university_student boolean DEFAULT true
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
    extensions.crypt(p_pw, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_name), now(), now(),
    '', '', '', '', '', '', '', ''
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), p_id, p_id::text, 'email',
          jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true, 'phone_verified', false),
          now(), now(), now())
  ON CONFLICT (provider_id, provider) DO NOTHING;

  -- Profile row (created by handle_new_user; upsert in case it was not).
  INSERT INTO public.users (id, email, full_name, role, tenant_id, is_active)
  VALUES (p_id, p_email, p_name, p_role, p_tenant, true)
  ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name, role = EXCLUDED.role,
        tenant_id = EXCLUDED.tenant_id, is_active = true;
  UPDATE public.users
     SET permissions = p_permissions, is_university_student = p_university_student
   WHERE id = p_id;
END $$;

DO $$
DECLARE
  v_pw text := '__DEMO_PASSWORD__';
  -- tenants
  t1 uuid := 'dd000000-0000-0000-0000-000000000001';
  t2 uuid := 'dd000000-0000-0000-0000-000000000002';
  q_basic jsonb := '[
    {"id":"1","type":"mcq","text":"ما ناتج 5 × 6 ؟","options":["11","30","56","25"],"correct_answer":"30","points":5},
    {"id":"2","type":"true_false","text":"الماء يغلي عند 100 درجة مئوية عند مستوى سطح البحر.","options":["صح","خطأ"],"correct_answer":"صح","points":5},
    {"id":"3","type":"mcq","text":"أيّ مما يلي لغة برمجة؟","options":["HTML","Python","CSS","JSON"],"correct_answer":"Python","points":5}
  ]';
BEGIN
  IF v_pw = '__DEMO_PASSWORD__' OR length(v_pw) < 10 THEN
    RAISE EXCEPTION 'Set a real demo password (>= 10 chars) in place of __DEMO_PASSWORD__';
  END IF;

  -- ── Institutions ──────────────────────────────────────────────────────
  INSERT INTO public.tenants (id, name, slug, is_active, institution_type, has_center, default_locale)
  VALUES (t1, 'مركز النور للتدريب (تجريبي)', 'demo-alnoor-training', true, 'training_center', false, 'ar'),
         (t2, 'جامعة الأمل (تجريبية)',        'demo-alamal-university', true, 'university',      true,  'ar')
  ON CONFLICT (id) DO NOTHING;

  -- ── 1. Independent training centre ────────────────────────────────────
  PERFORM pg_temp.demo_user('dd000000-0000-0000-0001-000000000001','nour.admin@demo.eduquest.test','أحمد النور (مدير مركز التدريب)','university_admin',t1,v_pw);
  PERFORM pg_temp.demo_user('dd000000-0000-0000-0001-000000000011','nour.trainer1@demo.eduquest.test','م. سارة القحطاني','teacher',t1,v_pw);
  PERFORM pg_temp.demo_user('dd000000-0000-0000-0001-000000000012','nour.trainer2@demo.eduquest.test','م. خالد العتيبي','teacher',t1,v_pw);
  PERFORM pg_temp.demo_user('dd000000-0000-0000-0001-000000000021','nour.trainee1@demo.eduquest.test','ريم الشهري','student',t1,v_pw);
  PERFORM pg_temp.demo_user('dd000000-0000-0000-0001-000000000022','nour.trainee2@demo.eduquest.test','فهد الدوسري','student',t1,v_pw);
  PERFORM pg_temp.demo_user('dd000000-0000-0000-0001-000000000023','nour.trainee3@demo.eduquest.test','نورة الزهراني','student',t1,v_pw);
  PERFORM pg_temp.demo_user('dd000000-0000-0000-0001-000000000024','nour.trainee4@demo.eduquest.test','عبدالله الحربي','student',t1,v_pw);
  PERFORM pg_temp.demo_user('dd000000-0000-0000-0001-000000000025','nour.trainee5@demo.eduquest.test','لمى المطيري','student',t1,v_pw);

  INSERT INTO public.groups (id, tenant_id, teacher_id, name, description) VALUES
    ('dd000000-0000-0000-0001-0000000000a1', t1, 'dd000000-0000-0000-0001-000000000011', 'دفعة البرمجة للمبتدئين', 'أساسيات البرمجة بلغة Python'),
    ('dd000000-0000-0000-0001-0000000000a2', t1, 'dd000000-0000-0000-0001-000000000012', 'دفعة التسويق الرقمي', 'مقدمة في التسويق عبر وسائل التواصل')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.group_students (group_id, student_id) VALUES
    ('dd000000-0000-0000-0001-0000000000a1','dd000000-0000-0000-0001-000000000021'),
    ('dd000000-0000-0000-0001-0000000000a1','dd000000-0000-0000-0001-000000000022'),
    ('dd000000-0000-0000-0001-0000000000a1','dd000000-0000-0000-0001-000000000023'),
    ('dd000000-0000-0000-0001-0000000000a2','dd000000-0000-0000-0001-000000000024'),
    ('dd000000-0000-0000-0001-0000000000a2','dd000000-0000-0000-0001-000000000025'),
    ('dd000000-0000-0000-0001-0000000000a2','dd000000-0000-0000-0001-000000000023')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.lessons (id, tenant_id, group_id, teacher_id, title, content, is_published) VALUES
    ('dd000000-0000-0000-0001-0000000000b1', t1, 'dd000000-0000-0000-0001-0000000000a1', 'dd000000-0000-0000-0001-000000000011',
     'الدرس الأول: المتغيرات في Python', E'## ما هو المتغير؟\n\nالمتغير اسم يشير إلى قيمة محفوظة في الذاكرة.\n\n```python\nname = "ريم"\nage = 21\n```', true),
    ('dd000000-0000-0000-0001-0000000000b2', t1, 'dd000000-0000-0000-0001-0000000000a2', 'dd000000-0000-0000-0001-000000000012',
     'الدرس الأول: الجمهور المستهدف', E'## تحديد الجمهور\n\nابدأ بتحديد عمر الجمهور واهتماماته والمنصات التي يستخدمها.', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.exams (id, tenant_id, group_id, teacher_id, title, duration_minutes, questions, is_published, proctoring_enabled, type) VALUES
    ('dd000000-0000-0000-0001-0000000000c1', t1, 'dd000000-0000-0000-0001-0000000000a1', 'dd000000-0000-0000-0001-000000000011',
     'اختبار قصير — الأسبوع الأول', 20, q_basic, true, false, 'exam'),
    ('dd000000-0000-0000-0001-0000000000c2', t1, 'dd000000-0000-0000-0001-0000000000a2', 'dd000000-0000-0000-0001-000000000012',
     'اختبار تجريبي مع المراقبة', 15, q_basic, true, true, 'exam')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.announcements (id, tenant_id, created_by, title, body, audience, is_published) VALUES
    ('dd000000-0000-0000-0001-0000000000d1', t1, 'dd000000-0000-0000-0001-000000000001',
     'مرحباً بكم في مركز النور', 'تبدأ الدفعات الجديدة الأسبوع القادم. نتمنى لكم رحلة تعلم ممتعة!', 'all', true)
  ON CONFLICT (id) DO NOTHING;

  -- ── 2. University with its continuing-education centre ────────────────
  PERFORM pg_temp.demo_user('dd000000-0000-0000-0002-000000000001','amal.admin@demo.eduquest.test','د. منصور الأمل (مدير الجامعة)','university_admin',t2,v_pw);
  PERFORM pg_temp.demo_user('dd000000-0000-0000-0002-000000000002','amal.center@demo.eduquest.test','هند السبيعي (مديرة المركز)','center_manager',t2,v_pw,
    '{"manage_teachers":true,"manage_students":true,"manage_groups":true,"manage_announcements":true,"view_reports":true}'::jsonb);
  PERFORM pg_temp.demo_user('dd000000-0000-0000-0002-000000000011','amal.teacher1@demo.eduquest.test','د. عمر الشمري','teacher',t2,v_pw);
  PERFORM pg_temp.demo_user('dd000000-0000-0000-0002-000000000012','amal.teacher2@demo.eduquest.test','أ. مها الغامدي','teacher',t2,v_pw);
  PERFORM pg_temp.demo_user('dd000000-0000-0000-0002-000000000021','amal.student1@demo.eduquest.test','يوسف القرني','student',t2,v_pw);
  PERFORM pg_temp.demo_user('dd000000-0000-0000-0002-000000000022','amal.student2@demo.eduquest.test','جود العمري','student',t2,v_pw);
  PERFORM pg_temp.demo_user('dd000000-0000-0000-0002-000000000023','amal.student3@demo.eduquest.test','تركي البقمي','student',t2,v_pw);
  PERFORM pg_temp.demo_user('dd000000-0000-0000-0002-000000000024','amal.student4@demo.eduquest.test','شهد الأحمدي','student',t2,v_pw);
  -- Centre-only trainees (not university students).
  PERFORM pg_temp.demo_user('dd000000-0000-0000-0002-000000000031','amal.trainee1@demo.eduquest.test','سلمان الرشيدي','student',t2,v_pw,'{}'::jsonb,false);
  PERFORM pg_temp.demo_user('dd000000-0000-0000-0002-000000000032','amal.trainee2@demo.eduquest.test','أروى الجهني','student',t2,v_pw,'{}'::jsonb,false);

  INSERT INTO public.groups (id, tenant_id, teacher_id, name, description) VALUES
    ('dd000000-0000-0000-0002-0000000000a1', t2, 'dd000000-0000-0000-0002-000000000011', 'مقدمة في علوم الحاسب — شعبة 1', 'مقرر جامعي'),
    ('dd000000-0000-0000-0002-0000000000a2', t2, 'dd000000-0000-0000-0002-000000000012', 'دورة اللغة الإنجليزية المكثفة', 'دورة في مركز التعليم المستمر')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.group_students (group_id, student_id) VALUES
    ('dd000000-0000-0000-0002-0000000000a1','dd000000-0000-0000-0002-000000000021'),
    ('dd000000-0000-0000-0002-0000000000a1','dd000000-0000-0000-0002-000000000022'),
    ('dd000000-0000-0000-0002-0000000000a1','dd000000-0000-0000-0002-000000000023'),
    ('dd000000-0000-0000-0002-0000000000a1','dd000000-0000-0000-0002-000000000024'),
    ('dd000000-0000-0000-0002-0000000000a2','dd000000-0000-0000-0002-000000000031'),
    ('dd000000-0000-0000-0002-0000000000a2','dd000000-0000-0000-0002-000000000032'),
    ('dd000000-0000-0000-0002-0000000000a2','dd000000-0000-0000-0002-000000000024')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.lessons (id, tenant_id, group_id, teacher_id, title, content, is_published) VALUES
    ('dd000000-0000-0000-0002-0000000000b1', t2, 'dd000000-0000-0000-0002-0000000000a1', 'dd000000-0000-0000-0002-000000000011',
     'المحاضرة 1: ما هي الخوارزمية؟', E'## الخوارزمية\n\nمجموعة خطوات محددة ومرتبة لحل مشكلة.', true),
    ('dd000000-0000-0000-0002-0000000000b2', t2, 'dd000000-0000-0000-0002-0000000000a2', 'dd000000-0000-0000-0002-000000000012',
     'Lesson 1: Greetings', E'## Greetings\n\n- Hello — مرحباً\n- Good morning — صباح الخير', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.exams (id, tenant_id, group_id, teacher_id, title, duration_minutes, questions, is_published, proctoring_enabled, type) VALUES
    ('dd000000-0000-0000-0002-0000000000c1', t2, 'dd000000-0000-0000-0002-0000000000a1', 'dd000000-0000-0000-0002-000000000011',
     'الاختبار الفصلي الأول (مراقَب)', 30, q_basic, true, true, 'exam'),
    ('dd000000-0000-0000-0002-0000000000c2', t2, 'dd000000-0000-0000-0002-0000000000a2', 'dd000000-0000-0000-0002-000000000012',
     'Placement quiz', 15, q_basic, true, false, 'exam')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.announcements (id, tenant_id, created_by, title, body, audience, is_published) VALUES
    ('dd000000-0000-0000-0002-0000000000d1', t2, 'dd000000-0000-0000-0002-000000000001',
     'بدء التسجيل في دورات المركز', 'فُتح التسجيل في دورات مركز التعليم المستمر للفصل القادم.', 'all', true)
  ON CONFLICT (id) DO NOTHING;
END $$;

COMMIT;
