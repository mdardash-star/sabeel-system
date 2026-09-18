# SUBIL System — سياق المشروع لـ Claude Code

> هذا الملف على فرع `develop` — الفرع الذي يحوي الكود الفعلي للمشروع (المونوريبو الكامل). نسخة موازية أبسط موجودة على `main` لكنها فرع شبه فارغ (توثيق فقط)، **الكود الحقيقي دائمًا هنا على `develop`**.

## نظرة عامة
مشروع سبيل: منظومة تشغيل وتجارة إلكترونية لمؤسسة سبيل المتحدة للتجارة، ليست مجرد متجر WooCommerce. تشمل: موقع subil.store، تطبيق العميل، تطبيق الفني، لوحة الإدارة، Core API، قاعدة بيانات، WooCommerce، بوابات دفع، وحدات طلبات/صيانة/أجهزة/عملاء/مخزون/مالية/تقارير. راجع `docs/ARCHITECTURE.md` و`docs/DOMAIN-MODEL.md` و`docs/CORE-MVP.md` و`docs/ROADMAP.md` لتفاصيل الرؤية والنطاق الكامل — هذا الملف يركّز على الحالة التشغيلية الحالية وما اكتُشف/أُصلح مؤخرًا.

**الحالة الحالية (بعد جلسة 2026-09-18):** خطأ Checkout 409 **محلول ومؤكد end-to-end في الإنتاج**. تم اكتشاف وإصلاح خللين إضافيين مهمين (تفصيل أدناه). OTP الإنتاجي لا يزال معلّقًا بانتظار تفعيل حساب Unifonic.

## المستودع
- GitHub: `mdardash-star/sabeel-system`
- الفرع الأساسي للتطوير والنشر: **`develop`**
- Monorepo Node.js / Next.js (npm workspaces):
  - `apps/api` — Core API (Node.js .mjs، PostgreSQL، بدون framework — HTTP خام موجّه عبر عدة راوترات)
  - `apps/admin` — لوحة الإدارة (Next.js)
  - `apps/technician` — تطبيق الفني (Next.js PWA)
  - `apps/mobile` — تطبيق العميل/PWA والمتجر والدفع (Next.js)
  - `packages/contracts` — عقود JSON مشتركة
  - `native/` — جسر دفع أصلي (Android Kotlin, iOS Swift, JS bridge) لمسار دفع مستقبلي منفصل عن WooCommerce
- قاعدة البيانات: 31 migration في `apps/api/db/migrations/`.
- المتجر/المنتجات/الدفع الأساسي عبر WooCommerce في subil.store.
- تطبيق العميل يتصل بـ WooCommerce Store API عبر proxy داخلي: `apps/mobile/app/api/store/[...path]/route.ts`
- **⚠️ يوجد نظام دفع ثانٍ منفصل تمامًا:** `apps/api/src/payments/provider-registry.mjs` (Tap, Amwal, Tabby, Tamara, Apple Pay, mada, cards, STC Pay عبر Native SDK) — لا تخلطه مع بوابات WooCommerce Store API (`amwalcheckout`, `tabby_installments`, إلخ). هذا الثاني يبدو موجّهًا لمسار دفع أصلي مستقبلي داخل التطبيقات، غير مفعّل بالضرورة بنفس درجة نضج مسار WooCommerce.

## الخدمات المنشورة (Render، تُنشر تلقائيًا من فرع `develop`)
| الخدمة | الرابط |
|---|---|
| Core API | https://subil-api.onrender.com |
| Admin | https://subil-admin.onrender.com |
| Technician | https://subil-technician.onrender.com |
| Customer/Mobile | https://subil-mobile.onrender.com |
| WooCommerce Store | https://subil.store |

## ✅ خطأ Checkout 409 — محلول (2026-09-18)

**السبب الجذري (مؤكد بقراءة الكود + استبدال حقيقي):**
في `apps/mobile/app/api/store/[...path]/route.ts` كان الشرط:
```js
if(!cartToken&&nonce)headers.set("Nonce",nonce);
```
يُرسل هيدر `Nonce` لـ WooCommerce **فقط إذا لم يوجد Cart-Token بعد**. بما أن أول `GET /cart` يُرجع Cart-Token دائمًا، فكل طلب لاحق (`add-item`, `update-customer`, `checkout`) كان يفقد الـ Nonce تمامًا — بغض النظر عن المنتج أو بوابة الدفع، وهو ما يطابق تمامًا النمط المُبلَّغ عنه سابقًا ("يحدث مع أكثر من منتج وأكثر من بوابة"). لوج `hasNonce=true` كان مضلِّلًا لأنه يقرأ من الكوكي مباشرة، لا من الهيدر الفعلي المُرسَل.

**الإصلاح:** `if(nonce)headers.set("Nonce",nonce);` — إرسال Nonce كلما توفّر. تم في PR #48، مدموج ومؤكد بطلبين حقيقيين ناجحين (COD وAmwal) عبر `subil-mobile.onrender.com` الحي بعد النشر.

**⚠️ لا تكرر هذه المحاولات لو ظهر 409 مشابه مستقبلًا — جُرِّبت وفشلت في حل الجذر الأصلي (كانت كلها من جهة WordPress، والسبب الفعلي كان بالعميل):**
- Clear WooCommerce/Product transients، Regenerate product lookup tables، Clear template cache
- إعادة حفظ SKU للباقات الست عبر WooCommerce REST، فحص purchasable/in stock
- تعديل `Product::get_sku()` عبر Angie snippet
- عزل إضافات WordPress (SUBIL Commerce، إلخ) — **الخلل لم يكن في WordPress إطلاقًا**، بل في كود العميل (`apps/mobile`)

**الدرس المستفاد لأي 409/خطأ checkout مشابه مستقبلًا:** ابدأ دائمًا باستدعاء مباشر ونظيف لـ Store API (`GET cart → add-item → update-customer → select-shipping-rate → checkout`) بمعزل عن كود العميل، بإرسال Cart-Token وNonce معًا في كل طلب يدويًا. إذا نجح الاستدعاء النظيف ولم يتكرر الخطأ، فالمشكلة في كود العميل وليس WooCommerce/WordPress.

## ✅ خلل صامت في "إضافة للسلة" — محلول (2026-09-18، PR #50)
استجابة `POST /cart/add-item` من subil.store **ليست JSON صالحًا** رغم `Content-Type: application/json` — سكربت تتبّع Snap Pixel يُطبع خام قبل جسم الـ JSON:
```
<!-- ADD_CART Snap Pixel Event -->
<script>...snaptr('track','ADD_CART',...)...</script>
{"items":[...]}
```
هذا خلل حقيقي **من جهة WordPress** (على الأرجح WPCode snippet أو SUBIL Commerce) **لم يُحل بعد من الجذر**. لكن أثره على العميل كان أخطر مما بدا: `jsonFetch` في `apps/mobile/app/store/page.tsx` كان يبتلع فشل تحليل الـ JSON بصمت (`.catch(()=>({}))`) ويُرجع `{}`، فتُنفَّذ `setCart({})` رغم نجاح الإضافة فعليًا على الخادم — فيختفي شريط السلة والعميل لا يقدر يكمل للدفع بعد أول "إضافة للسلة".

**الإصلاح المطبّق (دفاعي، بمعزل عن مصدر الحقن):** دالة `mutateCart()` تتحقق أن استجابة أي عملية تعديل سلة (`add-item`, `update-item`, `remove-item`, `update-customer`, `select-shipping-rate`) تحوي مصفوفة `items` فعلية؛ إن لم تحوِ، يُعاد جلب `GET /cart` نظيفة بدل الوثوق بالاستجابة المشوّهة.

**متبقٍ (خارج نطاق الكود):** إيجاد وإزالة مصدر حقن Snap Pixel من WordPress نفسه (Angie/WPCode) — الإصلاح الحالي تحايل على العرض، لا الجذر.

## ✅ WooCommerce Order Webhook — موصول الآن (2026-09-18، PR #49)
اكتُشف أن كود استقبال webhook الطلبات (`apps/api/src/integrations/woocommerce-{webhook,ingress,order,persistence}.mjs`) كان **مبنيًا ومُختبرًا بالكامل لكن غير موصول بأي مسار HTTP فعلي** — لا `server.mjs` ولا أي راوتر يستدعيه. عمليًا، لا طلب WooCommerce وصل قط لقاعدة بيانات SUBIL.

تم ربطه بمسار `POST /api/v1/integrations/woocommerce/orders` في `server.mjs` (قبل مسار مصادقة Bearer، لأن webhook يُصادَق بـ HMAC signature `x-wc-webhook-signature` لا Bearer token).

**⚠️ خطوات يدوية متبقية لتفعيله فعليًا (لم تُنفَّذ بعد):**
1. ضبط Webhook حقيقي من WooCommerce (subil.store → WooCommerce → Settings → Advanced → Webhooks) يشير لـ `https://subil-api.onrender.com/api/v1/integrations/woocommerce/orders`.
2. ضبط قيمة حقيقية لـ `WOOCOMMERCE_WEBHOOK_SECRET` في Render (لا تُكتب أبدًا بالكود أو المحادثات).
3. **فجوة معروفة غير محلولة:** الكود يتحقق من هيدر `x-subil-webhook-timestamp` لمنع الـ replay، لكن WooCommerce لا يرسل هذا الهيدر أصلًا (غير قياسي) — يحتاج قرار: إضافته عبر بروكسي/Cloudflare Worker أمام الـ webhook، أو قبول غياب حماية الـ replay حاليًا.
4. طلب لم يُدفع بعد (pending/on-hold/cancelled/failed) يُعامَل كـ no-op (200) لا خطأ — لأن `serviceJobFromPaidOrder` يرمي استثناء لأي حالة غير processing/completed عن قصد.
5. **ملاحظة نطاق:** `persistPaidServiceOrder` ينشئ سجلات (customer/order/order_items/service_job) **فقط** إذا كان أحد عناصر الطلب معلّمًا بـ `_subil_requires_service=yes`. طلبات لا تتطلب خدمة ميدانية **لا تُسجَّل حاليًا** في قاعدة بيانات SUBIL إطلاقًا — قد يكون هذا مقصودًا لنطاق MVP الحالي (تركيز على Field Service)، لكنه يعني عدم وجود سجل مالي/CRM لطلبات المنتجات البسيطة بعد.

## ملاحظة توضيحية: توجيه Amwal ليس خللًا
كان يبدو أن `redirect_url` من checkout لبوابة Amwal يشير لصفحة WooCommerce الداخلية (`checkout/order-pay/{id}`) بدل رابط Amwal المستضاف مباشرة — **تبيّن أن هذا سلوك صحيح ومقصود**: صفحة `order-pay` تحتوي فعليًا على ودجت Amwal الحقيقي (`<amwal-checkout-button>` + `amwal-checkout.js`)، وكود العميل (`apps/mobile/app/payment/page.tsx`) يعمل `window.location.replace` (تنقّل كامل، ليس iframe) لهذه الصفحة تحديدًا لبوابات `amwal/tabby/tamara/tap` — يطابق إصلاحًا سابقًا موثّقًا بتاريخ `develop`: `fix(amwal): open hosted checkout directly instead of iframe`. لا تُعد فتح هذا كـ"مشكلة" دون تأكيد بصري حي فعلي أولًا.

## OTP
- Core API جاهز، لكن مزود إرسال OTP غير مهيأ (Unifonic).
- تم إنشاء حساب Unifonic؛ التفعيل التجاري بانتظار تواصلهم.
- **لا تضع مفاتيح API في الكود أو المحادثات** — تُحفظ فقط كـ Render secrets/environment variables.
- Demo mode لا يُستخدم في Production (`SUBIL_OTP_TEST_MODE` يرفض العمل إن كان `NODE_ENV=production`).

## تتبّع الأحداث (Logging) — لا تسجل الأسرار
- `subil.cart_session_created` عند أول GET cart
- `subil.cart_item_added` مع status ووجود Cart-Token (بدون تسجيل قيمته)
- `subil.checkout_error` مع status, method, hasCartToken, hasNonce, وجزء من body
- ممنوع تسجيل: Cart-Token، Nonce، مفاتيح بوابات الدفع

## Smoke Test
`node scripts/smoke-check.mjs` يغطي: Admin/Technician/Mobile URLs، API `/health` و`/ready`، حماية `/api/v1/users` (401 متوقع)، WooCommerce Store API products endpoint. جميعها ✅ كما في آخر تشغيل (2026-09-18).

## اختبار مباشر لـ Store API (مفيد لأي تشخيص مستقبلي)
Store API عام (بدون مصادقة) على `https://subil.store/wp-json/wc/store/v1/*`. التسلسل الكامل للاختبار: `GET cart → POST cart/add-item → POST cart/update-customer → GET cart (لقراءة shipping_rates) → POST cart/select-shipping-rate → POST checkout`. أرسل `Cart-Token` و`Nonce` (اسم الهيدر **`Nonce`** حرفيًا، ليس `X-WC-Store-API-Nonce`) من استجابة كل طلب في الطلب التالي. **⚠️ إتمام `checkout` بنجاح ينشئ طلبًا حقيقيًا في إنتاج WooCommerce** — لا تفعل هذا إلا بإذن صريح، وسجّل رقم الطلب للإلغاء اليدوي لاحقًا (لا توجد وسيلة برمجية للإلغاء بدون مفاتيح WooCommerce REST API أو دخول wp-admin).

## بقية النظام
- لوحة الإدارة وتطبيق الفني مبنيان ومنشوران، وتغطيتهما واسعة فعليًا (customers, jobs, technicians, finance, inventory, purchasing, maintenance, marketing, conversations, reports, users, system-status، وقسم AI كامل).
- Backend يشمل وحدات: عملاء، طلبات، فنيين، مهام، صيانة، أجهزة، مالية، مخزون، مشتريات، تقارير، صلاحيات، تسويق، محادثات، AI agents.
- **لا تعيد بناء الموجود.** المطلوب بعد استقرار الدفع: QA وظيفي شامل، تأكيد أن كل شاشة في Admin/Technician مرتبطة ببيانات Production API الفعلية (لا placeholders)، مراجعة Roles & Permissions وidempotency وwebhook validation وbackup/monitoring قبل الإطلاق التجاري.

## متطلبات الإطلاق المتبقية
- [x] حل WooCommerce Checkout 409 نهائيًا — تم (PR #48)
- [x] نجاح COD end-to-end — مؤكد
- [x] ربط WooCommerce webhook بمسار HTTP حي — تم (PR #49)، يحتاج ضبط يدوي من جهة WooCommerce/Render
- [x] إصلاح خلل "إضافة للسلة" الصامت — تم (PR #50)
- [ ] نجاح redirect وإنشاء الطلب لكل بوابة دفع — COD وAmwal مؤكدان، Tap/Tamara/Tabby لم تُختبر بعد
- [ ] إيجاد وإزالة مصدر حقن Snap Pixel من WordPress (السبب الجذري لخلل السلة، لا يزال قائمًا من جهة WordPress)
- [ ] ضبط Webhook فعلي من WooCommerce + `WOOCOMMERCE_WEBHOOK_SECRET` في Render
- [ ] قرار بخصوص حماية replay للـ webhook (`x-subil-webhook-timestamp` غير مُرسَل من WooCommerce أصلًا)
- [ ] تسجيل طلبات لا تتطلب خدمة ميدانية في قاعدة بيانات SUBIL (حاليًا غير مُسجَّلة إطلاقًا)
- [ ] ربط Unifonic OTP بعد تفعيل الحساب
- [ ] اختبار iPhone وAndroid/PWA على جهاز حقيقي
- [ ] منع إنشاء طلب مكرر عند الضغط المتكرر أو إعادة callback (الحماية الحالية: `disabled={busy}` على زر الدفع بالواجهة فقط — لم يُختبر السلوك تحت تزامن حقيقي على مستوى الخادم)
- [ ] اختبار refunds/cancellations حسب البوابات
- [ ] Production smoke + E2E بعد آخر نشر
- [ ] نسخة احتياطية من WordPress/DB قبل أي عزل إضافات واسع

## قواعد العمل
- الأولوية: **Stabilization وإطلاق Production**، لا إضافة مزايا جديدة.
- Commits صغيرة قابلة للرجوع (revertable). كل تغيير على `develop` عبر فرع + PR + CI أخضر قبل الدمج.
- لا تُعلن نجاح أي بوابة دفع إلا بعد إثبات end-to-end حقيقي (لوج + طلب فعلي في WooCommerce).
- أي اختبار يُنشئ طلبًا حقيقيًا في subil.store يحتاج إذنًا صريحًا مسبقًا، وتسجيل رقم الطلب للإلغاء اليدوي.
- استخدم staging لعزل إضافات WordPress، وحافظ على Production آمنًا دائمًا.

## روابط
- GitHub: https://github.com/mdardash-star/sabeel-system
- Store: https://subil.store
