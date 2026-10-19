# شواهد فنی برای تکمیل اطلاعیهٔ پایلوت

بررسی اولیه در 2026-10-04؛ به‌روزرسانی G11 در 2026-10-05. این سند نسخهٔ منتشرشدهٔ اطلاعیه نیست؛ [پروندهٔ جاری](G11_REVIEW.md) واقعیت‌های تکمیل‌شده و تصمیم‌های باقی‌مانده را ثبت می‌کند.

## هویت Google

در پروژهٔ موجود، فقط نام فیلدهای metadata حساب Auth خوانده شد؛ هیچ ایمیل، نام، تصویر یا مقدار هویتی در گزارش ثبت نشد. Supabase Auth این فیلدها را نگه می‌دارد: `avatar_url`، `email`، `email_verified`، `full_name`، `iss`، `name`، `phone_verified`، `picture`، `provider_id` و `sub`.

بنابراین متن نهایی باید تفاوت میان استفادهٔ اپ از ایمیل/شناسه و ذخیرهٔ نام و نشانی تصویر در سرویس ورود را توضیح دهد. جملهٔ «فقط ایمیل و شناسه ذخیره می‌شود» پشتوانه ندارد. اپ نام و تصویر Google را برای جزوه، کارت یا نمای پروفایل استفاده نمی‌کند. حذف این metadata بدون بررسی ورود بعدی Google راه‌حل پایدار فرض نشده است. [ورود Google در Supabase](https://supabase.com/docs/guides/auth/social-login/auth-google)

## محل پردازش و قرارداد سرویس‌ها

پایگاه دادهٔ پروژه در لندن است و Functions نسخهٔ بررسی‌شده در `lhr1` اجرا می‌شوند. این محل، عملیات ورود Google، مدیریت سرویس‌ها یا AI را به لندن محدود نمی‌کند. جزئیات درخواست و ارائه‌دهندگان ممکن AI در [شاهد OpenRouter](../runbooks/OPENROUTER_DATA_HANDLING.md) ثبت شده‌اند؛ دادهٔ AI می‌تواند خارج از بریتانیا پردازش شود.

قراردادهای عمومی فعلی Vercel و Supabase، DPA را به قرارداد سرویس ارجاع می‌دهند و سازوکارهای انتقال، شامل بخش بریتانیا، دارند. متن عمومی قرارداد به‌تنهایی اثبات نمی‌کند چه شخص یا سازمانی طرف حساب این پایلوت است. نام مسئول داده، مالکیت حساب و شرایط قابل‌اعمال باید با اطلاعات واقعی مالک کامل شوند. [Vercel Terms](https://vercel.com/legal/terms)، [Vercel DPA](https://vercel.com/legal/dpa)، [Supabase Terms](https://supabase.com/terms)، [Supabase DPA](https://supabase.com/legal/customer-resources/data-processing-addendum)

## نگهداری رکوردها

کد فعلی PLT، jobهای تمام‌شده را پس از ۳۰ روز، کلیدهای idempotency منقضی را با کار ساعتی و bucketهای rate limit را پس از پایان بازهٔ لازم پاک می‌کند. رکوردهای audit و security اپ در جدول‌های جدا هستند؛ مدت نگهداری نهایی آن‌ها از این مدت jobها نتیجه نمی‌شود و نباید وعدهٔ یکسان داده شود.

Vercel برای دسترسی به Runtime Logs، مدت وابسته به پلن اعلام می‌کند: Hobby یک ساعت، Pro یک روز و Pro همراه Observability Plus سی روز. این عدد تضمین حذف تمام رکوردهای امنیتی شرکت نیست. در 2026-10-05 متادیتای واقعی پلن Pro و صفر drain تأیید شد؛ مالک در تصویر تنظیمات نشان داد گزینهٔ `Improve models with my data` خاموش است. [Runtime Logs](https://vercel.com/docs/logs/runtime)، [شاهد متادیتا](../../artifacts/verification/g11-cloud-metadata-2026-10-05.json)

Supabase دو محل برای Auth audit معرفی می‌کند: سرویس logs و، در صورت فعال‌بودن، جدول `auth.audit_log_entries`. مدت دسترسی داشبورد نباید با نگهداری جدول دیتابیس برابر فرض شود. [Auth Audit Logs](https://supabase.com/docs/guides/auth/audit-logs)، [محدودیت دسترسی logs در پلن‌ها](https://supabase.com/docs/guides/troubleshooting/check-usage-for-monthly-active-users-mau-MwZaBs)

پشتیبان‌های رمزگذاری‌شدهٔ اپ سیاست نگهداری ۳۰روزه دارند، به‌جز سه پشتیبان کامل (`ready`) آخر که حتی پس از ۳۰ روز نگه داشته می‌شوند تا همیشه نسخه‌ای قابل بازیابی باشد؛ با هر پشتیبان کامل تازه، قدیمی‌ترینِ آن سه اگر از ۳۰ روز گذشته باشد حذف می‌شود ([D85](../PRODUCT_DECISIONS_LOG.md)، `RECALINO_BACKUP_RETENTION_JSON`). وضعیت زمان‌بندی ساخت، جدا در [راهنمای بکاپ](../runbooks/BACKUP_RESTORE.md) ثبت می‌شود؛ سیاست نگهداری با موفقیت روزانهٔ ساخت برابر نیست.

## اطلاعاتی که از مالک لازم است

- طرف واقعی حساب‌های سرویس و شرایط commercial/organizational برای applicability DPA؛ نام مسئول Ali Paybarjay و نشانی تماس معلوم‌اند. نام برای deployment بعدی نیز در env محلی و production ثبت شد.
- وضعیت Data Preferences واقعی Vercel با تصویر مالک ثبت شد: `Improve models with my data` خاموش است. تأییدهای قبلی مالک دربارهٔ دو گزینهٔ OpenRouter جداست و دوباره درخواست نمی‌شود.
- قواعد واقعی کالج و اجازهٔ ضبط اشخاص حاضر؛ ارزیابی ضرورت DPIA و مبنای قانونی با شرایط واقعی پایلوت انجام می‌شود. [راهنمای ICO درباره ارزیابی AI](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/artificial-intelligence/guidance-on-ai-and-data-protection/what-are-the-accountability-and-governance-implications-of-ai/)
- مالک در 2026-10-05 اعلام کرد کلاس ESOL است، همهٔ اشخاص قابل‌ضبط بالای ۱۸ سال‌اند و اجازهٔ ضبط و ارسال به AI گرفته شده است. نام کالج و شاهد/روش ثبت اجازه هنوز ارائه نشده است.
- مالک اعلام کرد نزد ICO ثبت نشده و معافیت را بررسی نکرده، اما قصد تجاری‌سازی Recalino را دارد. اجرای fee checker و تعیین تکلیف fee/معافیت پیش از عرضهٔ تجاری باز است.

تأیید مالک برای پیش‌نویس‌ها و خاموش‌بودن دو تنظیم حساب OpenRouter ثبت‌شده است؛ این شاهد فنی درخواست تأیید مجدد همان متن نیست. مسئول پایلوت Ali Paybarjay است و حساب مالک فعلاً برای آزمون استفاده می‌شود و می‌تواند یکی از هشت جایگاه پایلوت باشد. `dataContractApproved:true` اکنون فقط برای مسیرهای OpenRouter اعمال شده و سایر بررسی‌های G11 همچنان باید با اطلاعات واقعی کامل شوند.
