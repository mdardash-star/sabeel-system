# SUBIL System — سياق المشروع لـ Claude Code

> ضع هذا الملف في جذر المستودع (`mdardash-star/sabeel-system`) باسم `CLAUDE.md`. يقرؤه Claude Code تلقائيًا في بداية كل جلسة عمل على هذا المستودع.

## نظرة عامة
مشروع سبيل: منظومة تشغيل وتجارة إلكترونية لمؤسسة سبيل المتحدة للتجارة، ليست مجرد متجر WooCommerce. تشمل: موقع subil.store، تطبيق العميل، تطبيق الفني، لوحة الإدارة، Core API، قاعدة بيانات، WooCommerce، بوابات دفع، وحدات طلبات/صيانة/أجهزة/عملاء/مخزون/مالية/تقارير.

**الحالة الحالية:** البنية والتطبيقات الرئيسية مبنية ومنشورة على Render، وCI ناجح. العائق الحرج: Checkout عبر WooCommerce Store API يعيد HTTP 409 (`woocommerce_rest_cart_item_error`) قبل تشغيل بعض بوابات الدفع. OTP الإنتاجي معلّق بانتظار تفعيل Unifonic.

## المستودع
- GitHub: `mdardash-star/sabeel-system`
- الفرع الأساسي: `develop`
- آخر دمج مهم: `codex/customer-app-finish` → `develop` عبر PR #46
- Monorepo Node.js / Next.js:
  - `apps/api` — Core API
  - `apps/admin` — لوحة الإدارة
  - `apps/technician` — تطبيق الفني
  - `apps/mobile` — تطبيق العميل/PWA والمتجر والدفع
- قاعدة البيانات: 31 migration مطبّقة في الإنتاج.
- المتجر/المنتجات/الدفع الأساسي عبر WooCommerce في subil.store.
- تطبيق العميل يتصل بـ WooCommerce Store API عبر proxy داخلي: `apps/mobile/app/api/store/[...path]/route.ts`

## الخدمات المنشورة (Render)
| الخدمة | الرابط |
|---|---|
| Core API | https://subil-api.onrender.com |
| Admin | https://subil-admin.onrender.com |
| Technician | https://subil-technician.onrender.com |
| Customer/Mobile | https://subil-mobile.onrender.com |
| Customer Demo | https://subil-mobile-demo.onrender.com |
| WooCommerce Store | https://subil.store |

## الأولوية القصوى: حل خطأ Checkout 409
**النمط المرصود:**
```
event=subil.checkout_error; status=409; method=amwalcheckout;
hasCartToken=true; hasNonce=true; code=woocommerce_rest_cart_item_error;
message="Api error, please try again later."
```
- يحدث مع أكثر من منتج وأكثر من بوابة — ليس مشكلة منتج واحد أو بوابة واحدة.
- بوابات الدفع الظاهرة: `amwalcheckout, cod, tabby_installments, tap, amwalcheckout_installments, tamara-gateway`.
- Tabby/Tamara/Amwal/Tap تفتح Hosted Checkout مباشرة (بدل iframe)؛ COD يبقى داخل Checkout.

**⚠️ لا تكرر هذه المحاولات — تمت وفشلت في حل الجذر:**
- Clear WooCommerce/Product transients (بما فيها 100 عنصر منتهي)
- Regenerate product lookup tables / product attributes lookup table
- Clear template cache
- إعادة حفظ SKU للباقات الست عبر WooCommerce REST
- فحص purchasable/in stock
- تعديل `Product::get_sku()` عبر Angie snippet #9048 (نسختين) — لم يحل 409
- **(جديد 2026-09-18) إعادة تشغيل مسار GET cart → add-item → update-customer → select-shipping-rate → checkout عبر استدعاء مباشر ونظيف لـ Store API (بدون كود العميل)، لكل من COD وAmwal — لم يُعِد 409 في أي منهما. راجع سجل التشخيص أدناه قبل إعادة هذه الخطوة.**

**سجل تشخيص 2026-09-18 — استدعاء مباشر لـ Store API (خارج كود العميل):**
تم تشغيل سكربت Python يكرر تمامًا التسلسل الموصى به في نقطة 8 (GET cart → add-item ×2 → update-customer → select-shipping-rate → checkout) ضد `https://subil.store/wp-json/wc/store/v1/*` مباشرة، بسلة تحوي منتجين من الباقات الست (8955, 8946)، وعنوان شحن/فوترة كامل يتضمن الهاتف.

النتائج:
- **COD:** نجح بالكامل، 200 OK، أُنشئ طلب حقيقي **#9050** (status: processing).
- **Amwal (`amwalcheckout`):** نجح أيضًا عبر Store API، 200 OK، أُنشئ طلب حقيقي **#9052** (status: pending) — **لم يظهر 409 هنا أيضًا**.
  - ⚠️ ملاحظة جانبية مهمة: `redirect_url` المُعاد من `payment_result` أشار إلى صفحة WooCommerce الداخلية `checkout/order-pay/9052/...` **وليس** صفحة الدفع المستضافة الخاصة بـ Amwal. أي أن بوابة Amwal قد لا تُنفّذ `process_payment` بشكل يوجّه فعليًا لصفحتها المستضافة عند الاستدعاء المباشر لـ Store API. يستحق تتبعًا منفصلًا عن الـ 409 (قد يفسر لاحقًا لماذا الواجهة "تفتح Hosted Checkout مباشرة" كما هو موصوف أعلاه — تأكد من أن العميل لا يعتمد فقط على `redirect_url` من هذا الاستدعاء دون معالجة إضافية).
  - ⚠️ **الطلبان #9050 و#9052 حقيقيان في الإنتاج ولم يُلغَيا بعد.** لا توجد وسيلة لإلغائهما عبر Store API العام أو صفحة `order-pay` (لا رابط "إلغاء الطلب" ظاهر لعميل غير مسجل، وحالة #9050 "processing" لا تسمح بالإلغاء الذاتي أصلًا). الإلغاء يتطلب إما مفاتيح WooCommerce REST API (Consumer Key/Secret كـ Render secret — لا تُكتب بالمحادثة) أو دخول wp-admin مباشرة. **إجراء مطلوب: ألغِهما يدويًا من WooCommerce → Orders.**
- **خلل حقيقي مؤكد (100% قابل للتكرار):** استجابة `POST /cart/add-item` ليست JSON صالحًا رغم `Content-Type: application/json` — تحتوي على سكربت خام مُطبوع قبل جسم الـ JSON مباشرة:
  ```
  <!-- ADD_CART Snap Pixel Event -->
  <script>...snaptr('track', 'ADD_CART', {...});</script>
  <!-- /ADD_CART Snap Pixel Event -->
  {"items":[...]}
  ```
  يتكرر في كل استدعاء `add-item` (تأكد بمنتجين مختلفين، مرتين). أي عميل يستخدم `response.json()` بشكل صارم (متوقع في `apps/mobile/app/api/store/[...path]/route.ts`) سيفشل بتحليل هذه الاستجابة تحديدًا. **هذا أقوى مرشّح جديد لمصدر خطأ "Api error, please try again later."** — ابحث عن مصدر حقن Snap Pixel (على الأرجح WPCode snippet أو SUBIL Commerce) وتأكد إن كان يحقن أيضًا في استجابة `checkout` أو `update-customer` (لم يظهر في اختبار اليوم، لكن لم يُختبر بشكل شامل).
- **خلاصة:** بما أن الاستدعاء المباشر النظيف (nonce وcart-token صحيحين، عنوان كامل بالهاتف) لا يُعيد 409 لا في COD ولا Amwal، فالمشكلة على الأرجح **ليست في WooCommerce/Store API نفسه** بل في كيفية تعامل **كود العميل** مع الاستجابات (خصوصًا حقن Snap Pixel المكسِّر لـ JSON) أو في حالة السباق (race condition) بين cart-token/nonce عبر الطلبات المتتالية في الواجهة الفعلية.
- **⛔ محظور تشخيصي حالي:** ملف `apps/mobile/app/api/store/[...path]/route.ts` وبقية كود `apps/mobile` **غير موجودين في هذا المستودع** (`mdardash-star/sabeel-system` يحوي حاليًا فقط `CLAUDE.md`, `README.md1`, ملف docx قديم). لا يمكن متابعة التشخيص من جهة كود العميل دون أحد الأمرين:
  1. الوصول لموقع الكود الفعلي لـ `apps/mobile` (مستودع/فرع آخر لم يُدفع هنا)، أو
  2. التقاط طلب فاشل حقيقي (409) من DevTools Network في متصفح حقيقي أو من لوج Render، لمقارنته header-by-header مع الاستدعاء النظيف الناجح أعلاه.

**خطة العمل الموصى بها (محدّثة):**
1. ~~اختبر COD أولًا بنفس السلة~~ **تم** — نجح COD وAmwal معًا عبر استدعاء مباشر، لم يتكرر 409. بوابات الدفع وWooCommerce الأساسي بريئان في هذا الاختبار.
2. أوجد مصدر حقن Snap Pixel في استجابة `add-item` (أولوية عالية جديدة) — افحص WPCode snippets وSUBIL Commerce بحثًا عن أي `echo`/`print` مباشر داخل hook مرتبط بـ `woocommerce_store_api_cart_item_added` أو مشابه.
3. احصل على كود `apps/mobile/app/api/store/[...path]/route.ts` الفعلي وراجع كيف يتعامل مع استجابة `add-item` غير الصالحة كـ JSON، وكيف يمرر Cart-Token/Nonce بين الطلبات.
4. التقط طلب 409 حقيقي فعلي (DevTools أو لوج Render) وقارنه بالاستدعاء الناجح الموثّق أعلاه.
5. التقط stack trace / hook trace عند `Store API checkout` / `check_cart_items` إن تكرر 409 من جهة السيرفر فعلاً (لم يتكرر في اختبار اليوم).
6. تتبّع خلل Amwal `redirect_url` (يشير لصفحة WooCommerce الداخلية بدل صفحة Amwal المستضافة) بشكل منفصل عن الـ 409.
7. اعزل الإضافات المتداخلة مع Cart/Checkout على staging فقط إذا استمر 409 بعد استبعاد كود العميل (خصوصًا SUBIL Commerce، وإضافات cart/product-options/direct-checkout/side-cart والبوابات غير المستخدمة). استخدم Health Check troubleshooting mode.
8. لا تعطّل إضافات على Production بلا خطة rollback.
9. سكربت الاستدعاء المباشر (GET cart → add-item → update-customer → select-shipping-rate → checkout) صالح الآن كأساس لـ E2E test آلي — وسّعه ليغطي بقية البوابات بعد حل نقطة 2 و3.

**بيئة WordPress وقت التشخيص:** WooCommerce 11.1.0، SUBIL Commerce 13.0.0-dev (مشتبه به)، Tabby Checkout 5.9.2 (لم يُحدَّث أثناء التشخيص لتجنب متغير جديد)، Tamara/Tap/Amwal Checkout موجودة. WPCode Lite 2.3.9 مفعل. المسار الناجح لنشر التعديلات: Angie (create/update/validate/publish snippets).

## OTP
- Core API جاهز، لكن مزود إرسال OTP غير مهيأ (Unifonic).
- تم إنشاء حساب Unifonic؛ التفعيل التجاري بانتظار تواصلهم.
- **لا تضع مفاتيح API في الكود أو المحادثات** — تُحفظ فقط كـ Render secrets/environment variables.
- Demo mode لا يُستخدم في Production.

## تتبّع الأحداث (Logging) — لا تسجل الأسرار
- `subil.cart_session_created` عند أول GET cart
- `subil.cart_item_added` مع status ووجود Cart-Token (بدون تسجيل قيمته)
- `subil.checkout_error` مع status, method, hasCartToken, hasNonce, وجزء من body
- ممنوع تسجيل: Cart-Token، Nonce، مفاتيح بوابات الدفع

## Smoke Test
`scripts/smoke-check.mjs` يغطي: Admin/Technician/Mobile URLs، API `/health` و`/ready`، حماية `/api/v1/users` (401 متوقع)، WooCommerce Store API products endpoint.

## بقية النظام
- لوحة الإدارة وتطبيق الفني مبنيان ومنشوران.
- Backend يشمل وحدات: عملاء، طلبات، فنيين، مهام، صيانة، أجهزة، مالية، مخزون، مشتريات، تقارير، صلاحيات.
- **لا تعيد بناء الموجود.** المطلوب بعد حل الدفع: QA وظيفي شامل، تأكيد أن كل شاشة في Admin/Technician مرتبطة ببيانات Production API الفعلية (لا placeholders)، مراجعة Roles & Permissions وidempotency وwebhook validation وbackup/monitoring قبل الإطلاق التجاري.

## متطلبات الإطلاق المتبقية
- [ ] حل WooCommerce Checkout 409 نهائيًا (من الجذر، لا ترقيع)
- [ ] نجاح COD end-to-end
- [ ] نجاح redirect وإنشاء الطلب لكل بوابة دفع
- [ ] التحقق من callbacks/webhooks وحالة order بعد الدفع/الإلغاء/الفشل
- [ ] ربط Unifonic OTP بعد تفعيل الحساب
- [ ] اختبار iPhone وAndroid/PWA
- [ ] منع إنشاء طلب مكرر عند الضغط المتكرر أو إعادة callback
- [ ] اختبار refunds/cancellations حسب البوابات
- [ ] Production smoke + E2E بعد آخر نشر
- [ ] نسخة احتياطية من WordPress/DB قبل أي عزل إضافات واسع

## قواعد العمل
- الأولوية: **Stabilization وإطلاق Production**، لا إضافة مزايا جديدة.
- Commits صغيرة قابلة للرجوع (revertable).
- لا تُعلن نجاح أي بوابة دفع إلا بعد إثبات end-to-end حقيقي (لوج + طلب فعلي في WooCommerce).
- استخدم staging لعزل إضافات WordPress، وحافظ على Production آمنًا دائمًا.

## روابط
- GitHub: https://github.com/mdardash-star/sabeel-system
- Store: https://subil.store
