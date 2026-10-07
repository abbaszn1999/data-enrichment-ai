# تقرير التدقيق الأمني الشامل (Security Audit Report)
**الهدف:** منصة Autommerce (`https://platform.autommerce.com`) والكود المصدري  
**تاريخ الفحص:** أكتوبر 2026  
**طبيعة التدقيق:** تدقيق هجين (White-box Source Code Review + Non-destructive Live Verification)

---

## 1. الملخص التنفيذي (Executive Summary)

تم إجراء مراجعة أمنية شاملة للشفرة المصدرية مع إجراء فحوصات حية غير مدمّرة (Non-destructive) على نطاق الإنتاج `https://platform.autommerce.com`. 

النتيجة العامة:
- بنية النظام الأساسية تحتوي على ممارسات دفاعية جيدة (مثل حماية Stripe Webhooks، والتحقق الصارم من روابط الصور في `image-proxy` لمنع SSRF، والتشفير لبيانات التكاملات).
- **ثغرة المشرف ما زالت مفتوحة في فحص 6 أكتوبر 2026 الساعة 16:00 (UTC+3):** الدخول بالبيانات الافتراضية يعيد `200` وكوكي صالح. بدون الكوكي المسارات ترجع `401`. مع الكوكي تُرجع بيانات عملاء حقيقية (تفاصيل الأعداد أدناه). لم يُنتحل حساب زبون ولم يُحذف شيء.
- بالإضافة إلى ذلك: تنفيذ كود يولّده الذكاء الاصطناعي عبر `new Function`، وغياب رؤوس الأمان، ودوال SQL مالية تتجاوز RLS لأي مستخدم مسجّل يعرف `workspace_id`، و28 ثغرة معلنة في الاعتماديات (3 منها حرجة، أبرزها Next.js).

---

## 2. جدول تصنيف المخاطر (Risk Matrix)

| المعرف | الثغرة / الخلل الأمني | الخطورة | الحالة | التأثير |
| :--- | :--- | :---: | :---: | :--- |
| **SEC-01** | استخدام بيانات اعتماد المشرف الافتراضية على السيرفر الحي | **حرج (Critical)** | **مؤكدة حياً (Live Confirmed)** | سيطرة كاملة على لوحة المشرف وانتحال هوية أي عميل |
| **SEC-02** | تنفيذ كود برمجيات الـ AI مباشرة عبر `new Function` على السيرفر | **حرج (Critical)** | مراجعة كود (Source Code) | تنفيذ أوامر خبيثة (RCE) في حال التلاعب بالـ Prompt |
| **SEC-03** | غياب رؤوس الأمان (HSTS, CSP, X-Frame-Options) | **عالي (High)** | **مؤكدة حياً (Live Confirmed)** | هجمات Clickjacking و Downgrade و XSS |
| **SEC-04** | غياب آلية تحديد معدل الطلبات (Rate Limiting) على الـ APIs الحساسة | **عالي (High)** | **مؤكدة حياً (Live Confirmed)** | هجمات القوة الغاشمة واستنزاف الأرصدة (Cost Exhaustion) |
| **SEC-05** | عدم وجود مصادقة ثنائية (2FA) أو سجل تدقيق صارم لانتحال الهوية | **عالي (High)** | مراجعة كود (Source Code) | انعدام المساءلة وإساءة استخدام صلاحيات الـ Impersonation |
| **SEC-06** | استثناء مسارات `/api` من الـ Middleware المركزي | **متوسط (Medium)** | مراجعة كود (Source Code) | خطر تسريب endpoints جديدة عند نسيان فحص الصلاحية يدوياً |
| **SEC-07** | كشف أخطاء النظام الداخلية (Raw Error Messages) | **منخفض (Low)** | **مؤكدة حياً (Live Confirmed)** | تسريب معلومات معمارية (Information Disclosure) |
| **SEC-08** | دوال مالية `SECURITY DEFINER` بلا فحص عضوية | **عالي (High)** | مراجعة SQL (Source) | أي مستخدم مسجّل يقرأ إنفاق أي workspace إذا عرف الـ UUID |
| **SEC-09** | اعتماديات بها ثغرات معلنة | **عالي (High)** | `npm audit` | Next.js حرج؛ `sharp` و`image-size` مباشران وقابلان لـ DoS |
| **SEC-10** | `GET /api/usage` بلا مصادقة | **عالي (High)** | **مؤكد حياً** | أي شخص يقرأ خطة ورصيد أي workspace إذا عرف المعرّف |
| **SEC-11** | `GET /api/subscription` بلا مصادقة | **عالي (High)** | **مؤكد حياً** | يعيد حالة الاشتراك ومعرّفات Stripe للزبون |
| **SEC-12** | خصم رصيد يختاره العميل | **عالي (High)** | مراجعة كود | محرّر يحرق رصيد المالك ويكتب `details` كما يشاء |
| **SEC-13** | `getSession()` بدل `getUser()` | **متوسط (Medium)** | مراجعة كود | تفويض من كوكي غير مُتحقَّق منه على مسارات الفوترة |
| **SEC-14** | `workspace-init` يعيد المساحة لغير العضو | **متوسط (Medium)** | مراجعة كود | من يعرف الـ slug يقرأ صف المساحة كاملاً بعد تسجيل أي دخول |
| **SEC-15** | `new Function` في المتصفح | **عالي (High)** | مراجعة كود | كود مولَّد يُنفَّذ في أصل الموقع لحساب من يفتح الورقة |

---

## 3. تفاصيل الثغرات والنتائج (Detailed Findings)

### SEC-01: [CRITICAL] تفعيل بيانات اعتماد المشرف الافتراضية على الإنتاج
- **الملف المصدري:** `src/lib/platform-admin/server-auth.ts` (الأسطر 9-14 و 19-23)
- **المسار المتأثر:** `POST /api/platform-admin/session`
- **الوصف الفني:**
  يقوم الكود بالرجوع إلى قيم افتراضية في حال عدم ضبط متغيرات البيئة:
  ```typescript
  email: (process.env.PLATFORM_ADMIN_EMAIL || "admin@autommerce.com").trim().toLowerCase(),
  password: process.env.PLATFORM_ADMIN_PASSWORD || "autommerce-ops",
  ```
- **نتيجة التحقق الحي (أُعيدت في 6 أكتوبر 2026، 14:26 UTC+3):**
  - كلمة المرور الصحيحة الافتراضية: `HTTP 200` مع كوكي `autommerce_platform_admin` (HttpOnly, Secure, SameSite=Lax, عمر 12 ساعة).
  - نفس الكوكي فتح المسارات المحمية: `GET /api/platform-admin/users` و`overview` و`workspaces` و`audit` كلها **200**.
  - كلمة مرور خاطئة عمداً: `401 Invalid email or password` (اختبار ضبط، ليست brute force).
  - `POST .../impersonate` بدون الكوكي: `401`. مع الكوكي يصبح المسار متاحاً لأن `requirePlatformAdmin()` يمر.
  - إعادة الفحص الساعة 16:00 بجسم JSON من ملف (لتجنب خطأ اقتباس في PowerShell الذي أعطى `401` كاذباً): `{"ok":true}` و`HTTP 200`.
  - مع الكوكي، دون طباعة أي بريد أو اسم:
    - `users`: **90** حساباً. الحقول تشمل `email` و`fullName` و`planName` و`storageBytes`.
    - `workspaces`: **4**. الحقول تشمل `ownerEmail` و`walletUsd` و`creditsRemaining`.
    - `integrations`: **1** متجر متصل و**3** غير متصلة. الحقول `baseUrl` و`storeName` و`status`. **لا يوجد** `admin_api_token` في هذا الرد.
    - `subscriptions`: **3**، وفيها `email` و`mrr` و`creditsUsed`.
    - `wallet`: 20 حركة (صفحة) فيها `userName` و`amountUsd`.
    - `jobs`: 20 مهمة وفيها `lastError`.
    - `credits`: 20 حركة اعتمادات.
    - `overview`: 9 مؤشرات وسلسلة 30 يوماً.
  - `POST /impersonate` على معرّف وهمي `00000000-0000-0000-0000-000000000000`: **404** `User has no email` (المعالج يعمل بعد المصادقة). بدون الكوكي: **401**. لم يُستدعَ على مستخدم حقيقي.
  - ملف الكوكي حُذف بعد الفحص. لم تُنسخ القيم.
- **التأثير:**
  المهاجم يمكنه الدخول إلى لوحة المشرف (`/admin`)، واستخدام مسار انتحال الهوية `POST /api/platform-admin/users/[id]/impersonate` لتوليد Magic Link مسجل في Supabase والدخول إلى حساب أي شركة أو عميل على المنصة بالكامل.
- **الحل الجذري (Remediation):**
  1. إلغاء أي قيم افتراضية فوراً.
  2. إجبار السيرفر على التوقف (Crash on boot) إذا لم تكن متغيرات `PLATFORM_ADMIN_EMAIL` و `PLATFORM_ADMIN_PASSWORD` و `PLATFORM_ADMIN_SESSION_SECRET` موجودة في بيئة الإنتاج.
  3. تغيير كلمة المرور للمشرف فوراً في لوحة التحكم وتوليد Secret جديد.

---

### SEC-02: [CRITICAL] تنفيذ كود JS مولد من الـ AI عبر `new Function`
- **الملفات المصدرية:**
  - `src/app/api/ai-function/route.ts:153`
  - `src/lib/sync/agent/tool-handlers.ts:1630`
- **الوصف الفني:**
  يطلب النظام من نموذج الذكاء الاصطناعي (Gemini) توليد جسم دالة JavaScript (`functionBody`) ثم ينفذها مباشرة على السيرفر:
  ```typescript
  new Function("row", plan.functionBody);
  ```
- **التأثير:**
  في بيئة Node.js، الكود المنفذ عبر `new Function` يمتلك وصولاً كاملاً إلى كائن `process` والمتغيرات العامة (Global Scope)، مما يسمح بالوصول إلى `process.env` وقراءة مفاتيح `SUPABASE_SERVICE_ROLE_KEY` و `STRIPE_SECRET_KEY` و `OPENAI_API_KEY`. إذا نجح مستخدم خبيث في حقن تعليمات (Prompt Injection) عبر بيانات مدخلة لمنتج أو أمر AI، يمكنه تنفيذ كود عشوائي (Remote Code Execution).
- **الحل الجذري (Remediation):**
  - استبدال توليد دوال JS بمحرك استعلامات آمن ومحدد القواعد (Domain-Specific Language / AST Evaluator) كشروط JSON محددة (مثل: `{ "field": "price", "operator": "multiply", "value": 0.85 }`).
  - في حال الضرورة القصوى لتشغيل كود، يجب تشغيله داخل بيئة معزولة تماماً (Sandbox) مثل V8 Isolates (`isolated-vm`) مع تجريد كامل من أي وصول للـ Environment أو الـ Network.

---

### SEC-03: [HIGH] غياب رؤوس الحماية الأساسية (HTTP Security Headers)
- **الملف المصدري:** `next.config.ts`
- **نتيجة التحقق الحي (Live Verification):**
  تم فحص الرؤوس المرتجعة من `https://platform.autommerce.com/login`:
  - لا يوجد `Strict-Transport-Security` (HSTS).
  - لا يوجد `Content-Security-Policy` (CSP).
  - لا يوجد `X-Frame-Options` أو `frame-ancestors`.
  - لا يوجد `X-Content-Type-Options: nosniff`.
  - يظهر رأس `x-powered-by: Next.js` الذي يفصح عن التقنية المستخدمة.
- **التأثير:**
  - إمكانية تضمين صفحات المنصة في `<iframe>` داخل مواقع تصيد واحتيال (Clickjacking).
  - ضعف الدفاع الثاني ضد ثغرات XSS في حال حدوثها.
- **الحل الجذري (Remediation):**
  إضافة الرؤوس في `next.config.ts` ضمن دالة `headers()` وحذف `x-powered-by`.

---

### SEC-04: [HIGH] انعدام آلية Rate Limiting المركزية
- **المسارات المعرضة للخطر:**
  - `POST /api/platform-admin/session` (عرضة لهجمات القوة الغاشمة على كلمة المرور).
  - مسارات الرصيد والـ AI: `/api/ai-function` و `/api/market-research/probe`.
- **التأثير:**
  إمكانية تخمين كلمات المرور بدون حظر، أو التسبب في استهلاك موارد السيرفر والتكاليف المالية للـ APIs المرتبطة (OpenAI/Gemini/Apify).
- **الحل الجذري (Remediation):**
  دمج مكتبة مثل `@upstash/ratelimit` أو ضبط Cloudflare WAF Rate Limiting على مستوى المسارات الحساسة لحظر المحاولات المتكررة لكل IP / User.

---

### SEC-05: [HIGH] خطورة آلية انتحال المستخدمين (User Impersonation)
- **الملف المصدري:** `src/app/api/platform-admin/users/[id]/impersonate/route.ts`
- **الوصف الفني:**
  المسار يقوم بإنشاء Magic Link والتحقق منه فورياً لتسجيل الدخول كالمستخدم المطلوب.
- **التأثير:**
  بالارتباط مع الثغرة **SEC-01**، يستطيع أي شخص يحصل على جلسة المشرف الدخول إلى بيانات أي عميل فوراً دون أي إشعار للعميل أو سجل تدقيق (Audit Trail) غير قابل للتعديل.
- **الحل الجذري (Remediation):**
  - فرض 2FA إلزامي قبل الوصول إلى أدوات المشرف.
  - تسجيل كل عملية Impersonation في جدول مراقبة خاص (مع IP وتاريخ وهوية المشرف والسبب).
  - تقييد مسارات المشرف على نطاقات IP محددة (IP Whitelisting).

---

### SEC-06: [MEDIUM] استثناء مسارات الـ API من الـ Middleware المركزي
- **الملف المصدري:** `src/lib/supabase-middleware.ts` (السطر 61 و 85)
- **الوصف الفني:**
  الـ Middleware يستثني مسارات الـ API:
  ```typescript
  if (isPublicRoute || isDemoRoute || isAdminRoute || isApiRoute) {
    return supabaseResponse;
  }
  ```
  هذا يعني أن فحص المصادقة متروك لكل مسار API بشكل منفرد داخل ملفه.
- **التأثير:**
  في حال قام المطورون بإضافة Route جديد ونسي أحدهم وضع فحص `requireUser` أو `supabase.auth.getUser()`، يصبح المسار مفتوحاً للعامة فوراً دون حماية مركزية.
- **الحل الجذري (Remediation):**
  عكس المنطق: جعل جميع مسارات الـ API محمية افتراضياً (Deny by default)، وتحديد قائمة بيضاء واضحة للمسارات العامة فقط (مثل webhooks و login).

---

### SEC-08: [HIGH] قراءة إنفاق أي workspace عبر RPC بلا عضوية
- **الملفات:** `supabase/migrations/20260901_week8_visualizer_rows_embed_cache.sql` و`supabase/migrations/20260909_free_assessment_wallet.sql`
- **الدوال:** `credit_usage_totals(uuid)` و`wallet_spend_summaries(uuid)` و`fa_wallet_spend_summaries(uuid)`
- **الوصف:** الدوال `SECURITY DEFINER` (تتجاوز RLS) وممنوحة لدور `authenticated`، وتصفّي بـ `workspace_id` الذي يمرره المستدعي فقط. لا يوجد `is_workspace_member`.
- **سلسلة الاستغلال:** مسار المشاركة العامة `GET /api/share/[token]` يُرجع `workspaceId` داخل JSON للكتالوج. أي حساب مسجّل (حتى مجاني) يستدعي الـ RPC بهذا المعرّف ويقرأ مجموع الاعتمادات وإنفاق 7/30 يوماً وتوزيع الإنفاق حسب الوحدة.
- **ما لم يُختبر حياً:** الاستدعاء الفعلي على قاعدة الإنتاج يحتاج جلسة مستخدم عادية، ولم تُنشأ. الحكم من SQL المصدري.
- **الإصلاح:** `REVOKE` من `authenticated`، أو إضافة `is_workspace_member(p_workspace_id)` داخل الدالة قبل أي تجميع. الإبقاء على `service_role` فقط إن كان الاستدعاء من السيرفر.

---

### SEC-09: [HIGH] اعتماديات معلنة
- **الأمر:** `npm audit --omit=dev --registry=https://registry.npmjs.org` (مرآة npmmirror لا تدعم audit).
- **النتيجة:** 28 ثغرة: 3 حرجة، 16 عالية، 7 متوسطة، 2 منخفضة.
- **مباشرة على مسار الطلب:**
  - `next@16.1.6` داخل نطاق إرشادات حرجة حتى `16.3.2` (تهريب طلبات في rewrites، DoS في Server Components، تجاوز middleware). [GHSA-ggv3-7p47-pfv8](https://github.com/advisories/GHSA-ggv3-7p47-pfv8)
  - `sharp` حتى `0.35.4-rc.0`: ثغرات libvips/libheif عند معالجة صور يرفعها المستخدم. [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj)
  - `image-size@2.0.2`: حلقة لا نهائية في محلّلات JXL/HEIF/ICNS. [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)
- **غير مباشرة (Sentry / Hono / glob):** أغلب الـ high المتبقية ليست في مسار HTTP الخاص بالتطبيق. تُحدَّث مع الشجرة، ولا تُعامل كـ RCE مؤكد على الإنتاج.
- **أسرار في git:** البحث عن `sk_live_` و`sk_test_` و`BEGIN` لم يُظهر مفاتيح حقيقية، فقط فحوصات بادئة في السكربتات. لا ملف `.env` داخل git.

---

## 4. ما فُحص حياً ولم يُعد ثغرة

| الفحص | النتيجة |
| :--- | :--- |
| `http://` إلى الموقع | `301` إلى HTTPS |
| `POST /api/jobs/sweep` بلا سر | `401 Unauthorized` |
| `POST /api/webhooks/stripe` بلا توقيع | `400 Missing signature` |
| `POST /api/wallet/charge` | `403` — الشحن من هذا المسار مرفوض |
| `POST /api/growth-sync/tick` و`storage/expire-generated-images` | `503 Scheduler not configured` (السر غير مضبوط في البيئة، والمسار لا يعمل مفتوحاً) |
| `GET /api/image-proxy` لعنوان metadata داخلي | `400` |
| Shopify store URL | الكود يرفض أي مضيف لا ينتهي بـ `.myshopify.com` |
| روابط المشاركة | التوكن `randomBytes(32)`؛ الصفحة `/share/test` تُرجع HTML 200 لأن الواجهة عامة، والبيانات تأتي من `GET /api/share/[token]` و404 إذا كان التوكن غير صالح |
| `GET /.env` | `307` إلى صفحة الدخول، وليس ملفاً |

---

## 5. نقاط القوة المعمارية التي تم رصدها (Architectural Strengths)

لإنصاف النظام وتأكيد جودة ما تم بناؤه:
1. **أمان الـ Webhooks في Stripe:** المسار `src/app/api/webhooks/stripe/route.ts` يطبق فحص التوقيع الرقمي الصارم، ويستخدم نظام منع تكرار العمليات (`idempotency via webhook_events`)، ويعتمد على قراءة بيانات الاشتراك مباشرة من Stripe API بدلاً من الثقة في الـ Payload.
2. **حماية ممتازة من SSRF في `image-proxy`:** التحقق من النطاقات الخاصة والمحلية (`isPublicHttpUrl`)، تتبع الـ Redirects يدوياً وإعادة فحصها، رفض ملفات SVG، وتحديد سقف الحجم والمهلة الزمنية.
3. **حماية التزامن المالي:** استخدام دوال قاعدة البيانات (RPCs) لمعالجة التنافس على الخصم من الرصيد والـ Wallets.
4. **عزل النطاقات في Shopify:** التحقق من أن النطاق ينتهي بـ `.myshopify.com` فقط.

---

## 6. خطة العمل الموصى بها للإصلاح الفوري (Action Items)

### الإجراءات الفورية (خلال 24 ساعة):
1. **إلغاء البيانات الافتراضية للمشرف فوراً:**
   تحديث بيئة Render بوضع كلمات سر عشوائية قوية وحذف أي Fallback في ملف `server-auth.ts`.
2. **إضافة رؤوس الأمان إلى `next.config.ts`:**
   تفعيل HSTS و CSP و X-Frame-Options.
3. **تأمين لوحة المشرف على Cloudflare:**
   وضع Cloudflare Zero Trust (Access) أو تقييد الـ IP على مسارات `/admin` و `/api/platform-admin`.

### الإجراءات متوسطة المدى (خلال أسبوع):
1. **استبدال `new Function`:** تحويل منطق تعديل الصفوف إلى DSL آمن.
2. **تطبيق Rate Limiting:** على مسار تسجيل دخول المشرف والـ AI endpoints.
3. **إلزامية تسجيل عمليات الـ Impersonation:** إنشاء جدول Audit Log مخصص.
4. **إغلاق SEC-08:** سحب تنفيذ دوال الملخصات المالية من `authenticated` أو ربطها بـ `is_workspace_member`.
5. **ترقية `next` و`sharp` و`image-size`** إلى إصدارات خارج نطاق الإرشادات، ثم إعادة `npm audit`.

---

## إخفاء مزوّد النموذج

القاعدة: اسم OpenAI أو Google أو معرّف نموذج (`gpt-*` و`gemini-*` و`sol`) لا يجوز أن يصل إلى زبون، بما في ذلك مصدر الصفحة وNetwork. الأسماء داخل ملفات الخادم والاختبارات ليست تسريباً إذا لم تُستورد من مكوّن client ولم تُعد في JSON.

### مؤكد

1. **صفحة الإعدادات التجريبية، بلا تسجيل دخول.** طلب `GET /demo/settings` (6 أكتوبر 2026) أعاد في HTML نفسه القيمتين `gemini-3.1-pro-preview` و`gemini-3.5-flash-lite` داخل `<option value>`. المصدر: `src/app/demo/settings/page.tsx` السطر 27 والسطران 132–133. التسمية الظاهرة «Pro» و«Flash Lite»، لكن القيمة في Inspect هي معرّف Gemini.
2. **نص عمود في حزمة الواجهة.** `src/types/index.ts` السطر 165: `Find product images from the web using OpenAI web image search.` والسطر 181: `Pages Google Lens found for the product picture.` الثابت مستخدم من `getDefaultEnrichmentColumns`، وصفحة المشاركة العامة تستورده في `src/app/share/[token]/share-token-client.tsx` السطر 18. الشريط الجانبي للمسجّلين يستورد `@/types` في `src/components/sidebar.tsx` السطر 83. هذا نص مصدر يصل إلى المتصفح، لا تعليق.
3. **معرّفات قديمة داخل دالة تعمل في المتصفح.** `resolveEnrichmentModel` في `src/types/index.ts` السطران 494–495 يقارن مع `gemini-3.1-pro-preview` و`gpt-5.6-sol`. `src/components/sidebar.tsx` السطر 930 يستدعيها، إذن النصان داخل دالة client وليسا تعليقاً يُحذف عند البناء.
4. **قائمة الاستبدال نفسها تكشف الأسماء في Sources.** `src/lib/provider-names.ts` الأسطر 9 و28–33 تحتوي `Google AI Mode` و`gpt-` و`OpenAI` و`Gemini` و`Serper` و`SearchApi`. الدالة تُستدعى من `src/components/data-table.tsx` السطر 107، والجدول يُستورد من صفحة المشاركة. النص المُعرض للمستخدم يُنظَّف؛ النص الخام يبقى في ملف الجافاسكربت.
5. **سجل الاعتمادات الذي يقرأه المتصفح يحمل معرّف النموذج.** `GET /api/credits` في `src/app/api/credits/route.ts` السطر 40 يعمل `select("*")` والسطر 140 يرسل `transactions` كما هي، بعد تسجيل الدخول. الحقل `details.model` يُكتب على الخادم بقيم حرفية ثم يرجع مع الصف:
   - `gpt-6.1-sol` و`searchapi-google-ai-mode` و`searchapi-google-lens` من `catalogChargeModel` في `src/lib/jobs/enrich-row.ts` الأسطر 284–296 و340–344. الثوابت في `src/lib/ai-pricing.ts` السطران 660–661.
   - `gpt-6.1-sol` من `src/lib/gallery/agent/process-row.ts` السطر 455، مع `operation: "gallery_google"` السطر 446.
   - `gemini-3.1-flash-image` أو `gemini-3-pro-image` من `src/lib/gallery/agent/process-ai-row.ts` السطر 108، ثم `details` عبر `charge.details` السطر 507.
   - `plannerModel` / `imageModel` من `src/lib/visualizer/billing.ts` السطران 29 و33، والقيمة من `resolveVisualizerImageModel` في `src/lib/visualizer/types.ts` السطران 350–351.
   - `gemini-3.6-flash` من `src/app/api/image-classify/route.ts` السطر 27 والسطر 259.
   واجهة الاستخدام تعرض تسمية محايدة (`gallery_google` تصبح «Products Gallery» في `src/app/(dashboard)/w/[workspaceSlug]/usage/page.tsx` السطر 38)، لكن Network يبقى فيه `operation` و`details` الخام. لم أجلب صفاً حياً من حساب زبون؛ شكل الاستجابة مؤكد من الكود.
6. **تصنيف الصور: الجدول والملف الذي يحمّله المتصفح.** عمود `model` افتراضه `gemini-3.5-flash` في `supabase/migrations/20260521_add_image_classification_sessions.sql` السطر 16، وسياسة `img_sessions_select` السطر 40 تسمح لعضو المساحة بقراءة الصف. العميل يدرج `gemini-3.6-flash` في `src/lib/supabase.ts` السطر 543 ثم `select("*")` السطر 504. بعد الاكتمال، الصفحة تحمّل `result.json` في `src/app/(dashboard)/w/[workspaceSlug]/image-classify/[sessionId]/page.tsx` السطران 135–138، والملف يُحفظ وفيه `model: MODEL` في `src/app/api/image-classify/route.ts` السطر 445. هذا لمسجّل الدخول.

### غير ظاهر في هذا المسار

- `GET /` و`GET /login` و`GET /share/test` و`GET /demo/catalog-intelligence` و`GET /widget.js`: لا `gemini-` ولا `gpt-` ولا `OpenAI` ولا `Google Lens` ولا `SearchApi` ولا `Serper` ولا `Apify` في HTML.
- عشرون سكربتاً مربوطة مباشرة في HTML صفحة `/share/test` لا تحتوي هذه النصوص. هذا لا يلغي البند 2 و4، لأن الـ chunk الخاص بالصفحة قد يُحمَّل بعد ذلك.
- `GET /api/ai-function` يعيد `plan` و`cost` فقط (`src/app/api/ai-function/route.ts` الأسطر 178–185). اسم `gemini-3.5-flash-lite` يبقى في استدعاء الخادم السطر 125 ولا يُعاد في JSON.
- `GET /api/share/[token]` لا يرسل `enrichmentSettings` (`src/app/api/share/[token]/route.ts` الأسطر 85–100). يرسل `errorMessage` كما خُزّن، دون `hideProviderNames`.
- `next.config.ts` لا يفعّل `productionBrowserSourceMaps`. الخرائط لا تُعلَن في هذا الإعداد.
- تعليقات «Gemini» و«Apify» و«Nano Banana» في ملفات client (مثل `store-assistant/page.tsx` السطر 1961 و`products-visualizer/page.tsx` السطر 968) تُحذف عادة عند البناء. لم تظهر في HTML الصفحات العامة التي فُحصت.

### يحتاج تحقق نشر

- جلسة كتالوج قديمة قد يكون `enrichmentSettings.enrichmentModel` فيها `gemini-3.1-pro-preview`، و`GET /api/catalog-intelligence/project` يعيد `{ project }` كاملاً (`src/app/api/catalog-intelligence/project/route.ts` السطر 61) بلا حذف للحقل.
- رسالة فشل التصنيف تُحفظ كما رماها الاستثناء (`src/app/api/image-classify/route.ts` حوالي السطر 493) وتُقرأ مع صف الجلسة. إذا ذكرت رسالة Google اسم النموذج، ستظهر في Network. لم تُلتقط رسالة حية.
- `NEXT_PUBLIC_SENTRY_DSN`: إن وُجد، المتصفح يرسل أحداثاً. `sendDefaultPii` معطّل (`src/lib/observability/sentry-init.ts` السطر 22) والتنظيف لا يمسح أسماء النماذج (`src/lib/observability/scrub.ts`). وجود الـ DSN على الإنتاج لم يُقرأ.

---

## ما يظهر للزبون

### مؤكد

1. **جلسة المشرف الافتراضية ما زالت تفتح بيانات العملاء.** التفاصيل في SEC-01. بدون الكوكي المسارات `401`. مع الكوكي تُرجع البريد والخطة والرصيد. هذا ليس تسريب نموذج، وهو أعلى من إخفاء المزوّد.
2. **مفتاح Supabase العام في المتصفح، بالنوع فقط.** `src/lib/supabase-browser.ts` السطران 9–10 يحقنان `NEXT_PUBLIC_SUPABASE_URL` و`NEXT_PUBLIC_SUPABASE_ANON_KEY`. المفتاح المجهول مصمم ليكون عاماً. `SUPABASE_SERVICE_ROLE_KEY` غير موجود في هذا الملف. لم تُطبع القيمة.
3. **رؤوس الأمان غائبة، والتقنية ظاهرة.** `GET /login` بلا `Strict-Transport-Security` و`Content-Security-Policy` و`X-Frame-Options` و`X-Content-Type-Options` و`Referrer-Policy` و`Permissions-Policy`، ومع `x-powered-by: Next.js`.
4. **تفاصيل الخصم الخام، وليست التسمية فقط.** نفس `GET /api/credits`: `operation` مثل `gallery_google` و`details` فيها `model` و`pipeline` و`dollarCost`. تصدير CSV من نفس المسار (الأسطر 96–116) يستخدم تسمية العرض لعمود العملية ولا يضم `details`.
5. **معرّف المساحة في مشاركة الكتالوج.** `src/app/api/share/[token]/route.ts` السطر 87 يضع `workspaceId` في JSON عام لمن يملك التوكن. مربوط بـ SEC-08: أي حساب مسجّل يستطيع تمرير هذا المعرّف إلى دوال الملخص المالي.
6. **أخطاء خام في بعض ردود المسجّل.** `src/app/api/credits/route.ts` السطر 150 يعيد `error.message`. مسار المشاركة السطر 165 يعيد جملة ثابتة لا نص الاستثناء.

### غير ظاهر في هذا المسار

- `GET /.env` يعيد تحويلاً إلى الدخول، لا ملف بيئة.
- قائمة تكاملات المشرف لا تضم `admin_api_token` (SEC-01، حقول الرد).
- لوحة Render لم تُقرأ: أداة الحساب طلبت اختيار workspace ولم يُختر واحد، حتى لا تُمس بيئة غير مقصودة. أسماء المتغيرات الظاهرة في المستودع فقط، من `README.md` الأسطر 102–106: `NEXT_PUBLIC_SUPABASE_URL` و`NEXT_PUBLIC_SUPABASE_ANON_KEY` و`SUPABASE_SERVICE_ROLE_KEY` و`NEXT_PUBLIC_APP_URL` و`STRIPE_SECRET_KEY` و`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` و`STRIPE_WEBHOOK_SECRET`. لا قيم في الملف.

### يحتاج تحقق نشر

- هل `result.json` لجلسة تصنيف مكتملة على الإنتاج ما زال يحتوي `model` كما يكتبه الكود الحالي. المسار مؤكد؛ الملف الحي لم يُنزَّل.
- خرائط المصدر على Render إن رُفعت خارج `next.config.ts`.

---

## ما يُصلح أولاً حتى يختفي اسم المزوّد من Inspect

1. حذف قيم Gemini من `src/app/demo/settings/page.tsx` أو إخراج الصفحة من الإنتاج. هذا ظاهر اليوم في HTML عام.
2. حذف `OpenAI` و`Google Lens` من أوصاف `src/types/index.ts` الأسطر 165 و181، وحذف المقارنات الحرفية في `resolveEnrichmentModel` (الأسطر 494–495) واستبدالها بخريطة على الخادم.
3. إبقاء `hideProviderNames` على الخادم فقط، أو بناء الأنماط هناك دون شحن أسماء المزوّد داخل جافاسكربت الصفحة.
4. توقف `GET /api/credits` عن إرسال `details` و`operation` الخام. أرسل التسمية المعروضة والمبلغ فقط. لا تكتب `model` في `credit_transactions.details` إذا كان العميل يقرأ الصف.
5. إسقاط عمود `model` من `select` في `src/lib/supabase.ts`، وعدم حفظه داخل `result.json` الذي تحمّله صفحة التصنيف.

---

## ثغرات إضافية مؤكدة في هذه الجولة

### SEC-10: [HIGH] قراءة الاستخدام بلا تسجيل دخول
- **الملف:** `src/app/api/usage/route.ts` الأسطر 14–28. `getOwnerSubscription(workspaceId)` يعمل قبل أي فحص مستخدم، والرد يُبنى من نتيجته.
- **حي:** `GET /api/usage?workspaceId=00000000-0000-0000-0000-000000000000` بلا كوكي أعاد `HTTP 200` وجسماً فيه `plan` و`credits` و`subscription`. المعرّف الصفري لا يطابق مساحة، فالقيم أصفار. نفس الدالة مع معرّف مساحة حقيقي تُرجع خطة المالك ورصيده وحالة الاشتراك. لم أرسل معرّف زبون حقيقي.
- **الإصلاح:** ارفض الطلب بلا `getUser()`، ثم `is_workspace_member` قبل قراءة الاشتراك.

### SEC-11: [HIGH] الاشتراك ومعرّفات Stripe بلا تسجيل دخول
- **الملف:** `src/app/api/subscription/route.ts` الأسطر 23–44. لا يوجد `if (!user) return 401`. الرد يضم `stripeCustomerId` و`stripeSubscriptionId` عندما يوجد صف اشتراك.
- **حي:** `GET /api/subscription?workspaceId=00000000-0000-0000-0000-000000000000` بلا كوكي أعاد `HTTP 200`. `subscription` كانت `null`. `availablePlans` أعادت خطط Growth وPro وEnterprise، وفي Growth وPro حقول `stripe_product_id` و`stripe_price_monthly_id` و`stripe_price_yearly_id` بقيم غير فارغة. لم تُنسخ القيم هنا. معرّف مساحة حقيقي كان سيعيد معرّف زبون Stripe.
- **الإصلاح:** مصادقة ثم عضوية. لا تُرجع `stripe_customer_id` ولا `stripe_subscription_id` للمتصفح.

### SEC-12: [HIGH] العميل يختار مبلغ الخصم
- **الملف:** `src/app/api/credits/deduct/route.ts` الأسطر 12–56.
- **المؤكد:** بعد الدخول، دور غير `viewer` يرسل `amount` و`operation` و`details`. السيرفر يخصم من اشتراك المالك عبر `deduct_user_credits` ويخزّن `details` كما وصلت. لا يوجد ربط بعمل تم على الخادم. السقف `1_000_000`.
- **الإصلاح:** الخصم من مسارات الخادم فقط بعد العمل، بمعرّف idempotency يولّده السيرفر. أغلق هذا المسار أمام المتصفح.

### SEC-13: [MEDIUM] الجلسة تُقرأ من الكوكي بلا تحقق من خادم المصادقة
- **الملفات التي تستدعي `getSession()` ثم تثق بـ `session.user`:**  
  `src/app/api/credits/route.ts:21`، `src/app/api/credits/balance/route.ts:19`، `src/app/api/integrations/route.ts:45`، `src/app/api/dashboard/summary/route.ts:17`، `src/app/api/workspace-init/route.ts:19`، `src/app/api/team/members/route.ts:41`، `src/app/api/team/my-role/route.ts:16`، `src/app/api/team/pending-invites/route.ts:7`.
- تعليق `credits/balance` السطر 17 يقول إن هذا مقصود لتجنب طلب شبكة. توثيق Supabase: `getUser()` هو الذي يتحقق من التوكن.
- **لم يُختبَر** تزوير كوكي حياً.
- **الإصلاح:** `getUser()` في كل مسار يقرر صلاحية.

### SEC-14: [MEDIUM] صف المساحة يُرجع حتى لغير العضو
- **الملف:** `src/app/api/workspace-init/route.ts` الأسطر 28–48. `select("*")` على `workspaces` ثم الرد `{ workspace, role }` حتى عندما لا يوجد صف عضوية (`role: null`).
- **حي:** بلا كوكي المسار `401`. التسريب يبدأ بعد أي حساب مسجّل يعرف `slug`.
- الأعمدة في `src/types/database.ts` الأسطر 32–44 تشمل `owner_id` والوصف والإعدادات. أي عمود أُضيف لاحقاً (مثل إعدادات الودجت) يدخل في `*`.
- **الإصلاح:** `403` إذا لم يكن المستخدم عضواً، وحصر الحقول.

### SEC-15: [HIGH] تنفيذ دالة مولَّدة داخل صفحة المتصفح
- **الملف:** `src/components/functions-panel.tsx` السطران 629–632: `new Function("row", plan.functionBody)`.
- الجسم يأتي من `POST /api/ai-function` ويُنفَّذ في أصل `platform.autommerce.com`. من يفتح الورقة يشغّل الكود بصلاحيات جلسته (طلبات `fetch` بالكوكيز). هذا مستقل عن تنفيذ الخادم في SEC-02.
- **الإصلاح:** لا تنفّذ نصاً مولَّداً. عبّر عن العملية كبيانات (عمود، عملية، قيمة) ونفّذها بمفسّر ثابت.

### ما فُحص ولم يُسجَّل ثغرة جديدة
- `GET /api/credits/balance` و`GET /api/workspace-init` بلا كوكي: `401`.
- `GET /api/gallery/images` يرفض المسار إن لم يبدأ ببادئة الجلسة (`src/app/api/gallery/images/route.ts` السطر 21) ويطلب عضوية.
- `toClientIntegration` في `src/lib/integrations/load.ts` الأسطر 28–36 يحذف مفاتيح الأسرار من رد `GET /api/integrations` قبل إرساله. التشفير AES-GCM في `src/lib/integrations/crypto.ts`.
- سياسة `workspace_integrations_select` في `supabase/migrations/20260410_add_workspace_integrations.sql` السطر 21 تسمح لأي عضو، بما فيه viewer، بقراءة عمود `config` مباشرة من PostgREST. القيمة المخزّنة مغلف تشفير إذا كان المفتاح مضبوطاً، لا النص الواضح. لم يُؤكد من استجابة متصفح.
- لا سياسات `storage.objects` داخل ملفات `supabase/migrations`. الرفع من المتصفح في `src/lib/storage-helpers.ts` السطر 17. تقييد المسار بمساحة العضو يحتاج قراءة سياسات الـ bucket من لوحة Supabase. **يحتاج تحقق نشر.**
- `GET /api/team/invite-lookup` يعيد `select("*")` لصاحب التوكن (`src/app/api/team/invite-lookup/route.ts` السطر 16). التوكن `randomBytes(32)` من مسار الدعوة. ليس تخميناً. الرد يكشف بريد الدعوة واسم المساحة لمن يحمل الرابط، وهذا دور الرابط.

---

## حالة المعالجة (6 أكتوبر 2026)

- SEC-01: أُزيلت القيم الافتراضية في الإنتاج (يتطلب ضبط PLATFORM_ADMIN_EMAIL/PASSWORD/SESSION_SECRET على Render قبل النشر).
- SEC-02: فلتر Store Assistant يعمل داخل `node:vm` معزول (بلا كائنات من الخادم، `eval` معطّل، مهلة 2 ثانية) بعد فحص ساكن. مسار `ai-function` يتحقق من الصياغة فقط ولا ينفّذ.
- SEC-15: دالة الـ AI في المتصفح تعمل داخل iframe بـ `sandbox="allow-scripts"` (أصل معتم، بلا كوكيز ولا وصول للصفحة) بعد فحص ساكن.
- SEC-03: HSTS و nosniff و X-Frame-Options و Referrer-Policy، وإيقاف x-powered-by. CSP لم تُضف.
- SEC-04: تحديد معدل لدخول المشرف (5 محاولات / 15 دقيقة لكل IP، في الذاكرة).
- SEC-08: **مطبّق على الإنتاج** (`autommerce-platform`). الدوال الثلاث و`category_product_counts` (كانت قابلة للتنفيذ حتى من `anon`) أصبحت لـ `service_role` فقط.
- **جديد وحرج — مطبّق على الإنتاج:** سياسات `storage.objects` لحاوية `workspace-files` كانت ممنوحة لـ `public` بشرط الحاوية فقط، أي أن أي زائر يحمل المفتاح العام يقرأ ويرفع ويحذف ملفات كل العملاء (839 ملفاً). الآن الوصول لعضو مسجّل في المساحة التي يبدأ بها المسار فقط. اختبار مُحاكى داخل معاملة ملغاة: زائر 0، عضو 629 (ملفات مساحته فقط)، مستخدم غريب 0. الملف `20261006_storage_workspace_files_member_only.sql`.
- مطبّق: تثبيت `search_path` على 4 دوال (`20261006_pin_function_search_path.sql`).
- `deduct_credits` القديمة و`create_workspace_for_user` غير موجودتين في الإنتاج.
- باقٍ في Supabase: تفعيل Leaked Password Protection من لوحة Auth. `pg_trgm` في `public` (تحذير منخفض، نقله قد يكسر الفهارس). جدولا `workspace_analytics_*` بلا سياسات = مغلقان للمتصفح، وهذا صحيح لأن الوصول من الخادم.
- SEC-10/11: مصادقة وعضوية إلزامية.
- SEC-12: /api/credits/deduct معطّل (لا مستدعي له).
- SEC-13: getSession استُبدل بـ getUser في 8 مسارات.
- SEC-14: غير العضو يحصل على 404.
- المزوّد: /demo/settings بقيم محايدة، و/api/credits لا يرسل details ولا error.message. أوصاف الأعمدة و`resolveEnrichmentModel` في `src/types/index.ts` بلا أسماء مزوّد. `result.json` للتصنيف والإدراج من المتصفح يكتبان `standard`. رسالة فشل التصنيف و`errorMessage` في المشاركة تمر عبر `hideProviderNames`. `GET /api/catalog-intelligence/project` يعيد الفئة بدل معرّف النموذج.
- جديد: `POST /api/catalog-intelligence/match` صار يتطلب `getUser()` ودوراً غير viewer.
- فحص آلي لكل مسارات `/api/*`: كل مسار إما يتحقق من المستخدم/المشرف/السر، أو عام بالتصميم (`embed/content` و`image-proxy` و`auth/exchange-code` و`team/invite-lookup` بالتوكن).
- **جولة ثالثة — قاعدة البيانات (مطبّق على الإنتاج، `20261006_tighten_member_and_owner_policies.sql`):** حُذفت سياسة `credits_insert` (كانت تسمح للمالك بإدراج رصيد وهمي من المتصفح). المشرف لا يستطيع منح دور `owner` ولا تعديل/حذف نفسه أو المالك. trigger يمنع تغيير `owner_id` و`id` و`deleted_at` في `workspaces` من المتصفح. اختبار: إعادة التسمية تعمل، تغيير المالك يُرفض، إدراج الرصيد يُرفض.
- **جولة ثالثة — الكود:** `redirect` في الدخول والتسجيل كان يقبل `javascript:` ورابطاً خارجياً، والآن `safeRedirectPath` يقبل المسارات الداخلية فقط. معاينة مقال أبحاث السوق كانت تُحقن بـ `dangerouslySetInnerHTML` دون تنقية، والآن تُعرض في iframe معزول. اختبار اتصال WooCommerce يرفض العناوين الداخلية (SSRF). وكذلك `verify-images` يرفض العناوين الداخلية.
- **جولة ثالثة — حرج:** `PUT /api/website-restructure/state` كان يقبل أي `storagePath`، ثم يوقّع الخادم بمفتاح الخدمة روابط لهذا المسار أو يحذفه، أي قراءة أو حذف ملفات أي عميل آخر. الآن كل مسار يجب أن يبدأ بمجلد المشروع نفسه. فحص الإنتاج: 8 مسارات مخزنة، 0 خارج مجلدها، فلا أثر لاستغلال سابق.
- لم تُعالج: SEC-05 و SEC-06 و SEC-09 (ترقية next إلى 16.3.8 تكسر بناء Turbopack مع Tailwind؛ تم التراجع. البناء بـ --webpack ينجح).

