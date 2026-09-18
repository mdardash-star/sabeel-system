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

**خطة العمل الموصى بها:**
1. اختبر COD أولًا بنفس السلة → إذا أعاد 409 أيضًا، فبوابات الدفع بريئة تمامًا.
2. التقط stack trace / hook trace عند `Store API checkout` / `check_cart_items` بدل الاعتماد على رسالة REST فقط.
3. ابحث عن مصدر رمي `'Api error, please try again later.'` أو `WP_Error` أثناء cart validation.
4. اعزل الإضافات المتداخلة مع Cart/Checkout على staging (خصوصًا SUBIL Commerce، وإضافات cart/product-options/direct-checkout/side-cart والبوابات غير المستخدمة). استخدم Health Check troubleshooting mode.
5. لا تعطّل إضافات على Production بلا خطة rollback.
6. إن أمكن: staging clone من subil.store مع WooCommerce + بوابة واحدة + Astra فقط، ثم أعد الإضافات تدريجيًا.
7. بعد نجاح COD: اختبر Amwal → Tap → Tamara → Tabby → Amwal installments، بالترتيب.
8. أضف E2E test آلي لمسار: GET cart → add-item → update-customer → shipping → checkout COD.

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
