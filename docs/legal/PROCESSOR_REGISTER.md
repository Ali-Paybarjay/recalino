# دفتر پردازشگران و انتقال دادهٔ پایلوت

بررسی 2026-10-05؛ مسئول: Ali Paybarjay. سند مبتنی بر قراردادهای عمومی جاری، metadata خواندنی حساب و کد اپ است. نمونهٔ قرارداد عمومی با رسید توافق خصوصی یا تأیید قانونی نهایی اشتباه گرفته نمی‌شود.

## وضعیت حساب‌ها

Vercel: پروژهٔ `recalino` با شناسهٔ ثابت موجود، پلن Pro، `billing.trial:null` در metadata، صفر drain. Supabase: سازمان موجود با پلن Free، پروژهٔ `twowhuzhvyuzjrpraikm` در `eu-west-2` و وضعیت سالم. OpenRouter: API فعلی و دو تنظیم خاموش طبق پاسخ مالک؛ پلن خرید/طرف قرارداد از آن پاسخ استنتاج نشده است.

نام مسئول مشخص است؛ اینکه مالک حساب‌های موجود همین شخص و شرایط فعلی پذیرفته‌شده‌اند، باید با مسئول تطبیق یابد. ثبت عمومی یک توافق امضاشدهٔ اختصاصی برای این پروژه مشاهده نشده و الزام خودکار به دریافت PDF امضاشده برای تمام سرویس‌ها فرض نمی‌شود.

## دفتر مسیرها و قراردادها

| سرویس | نقش و دادهٔ مربوط | قرارداد/انتقال عمومی | محدودیت و اقدام باز |
|---|---|---|---|
| Vercel Inc. | Functions و Blob خصوصی: مواد/خروجی کلاس، نسخهٔ موقت صوت، درخواست و telemetry عملیاتی؛ دادهٔ تماس/سرویس نقش مستقل دارد | DPA فعلی مخصوص Pro/Enterprise و شامل SCC و UK Addendum؛ `lhr1` محدودیت همهٔ عملیات به UK نیست | Schedule 1 §6 دادهٔ حساس/special category را برای Customer Data منع می‌کند؛ فهرست subprocessor و ترجیح دادهٔ واقعی تیم بررسی شود |
| Supabase Pte. Ltd. | DB، Auth، ایمیل/شناسه و metadata Google، پروفایل، محتوای مشتق و ledger/receipt | Terms، DPA را جزء توافق می‌کند؛ DPA عمومی محدودیت پلن ندارد؛ SCC/UK Addendum دارد؛ نگهداری و پردازش عمده در منطقهٔ منتخب همراه استثناست | شرایط خصوصی متفاوت اگر وجود داشته باشند مقدم‌اند؛ تنظیم Auth audit DB و طرف واقعی توافق هنوز تطبیق داده شود |
| OpenRouter Inc. | routing متن/تصویر، bytes صوت STT و متن TTS؛ API payload و metadata/security/billing باید جدا دیده شوند | ToS §10.2 برای نمایندگی سازمان یا استفادهٔ commercial for-profit، DPA را incorporation می‌کند؛ DPA SCC Module 2 و UK Addendum دارد؛ Standard از طریق ToS و خرید Enterprise شرط ذاتی نیست | شخصی/غیرتجاری‌بودن واقعی پایلوت می‌تواند applicability را نیازمند روشن‌سازی کند؛ §2.6 دامنهٔ Sensitive Data را محدود می‌کند؛ providerهای متغیر بررسی شوند |
| Google | ارائه‌دهندهٔ هویت با scopeهای پایهٔ openid/email/profile؛ metadata در Supabase Auth هم ذخیره می‌شود | API User Data Policy شامل Google Sign-In است؛ privacy/transfer framework سرویس حساب مستقل دارد | OAuth پایه با قرارداد processor مربوط به Google Cloud یکی فرض نشود؛ Privacy منتشرشده باید مطابق فیلدهای واقعی باشد |
| providerهای مدل از مسیر OpenRouter | Haiku: routes ممکن Amazon Bedrock/Google Vertex؛ Whisper: DeepInfra/Groq؛ Kokoro: DeepInfra/Together، بر اساس snapshot ZDR 2026-10-04 | قرارداد OpenRouter برای subprocessors حفاظت و مسئولیت را توضیح می‌دهد؛ نام سازندهٔ مدل به‌تنهایی اجرای واقعی را مشخص نمی‌کند | snapshot فهرست احتمالی است و رسید واقعی نیست؛ tagهای global/بدون منطقه کشور قطعی را ثابت نمی‌کنند؛ مسیرهای audio `only/order/ignore` را اعمال نمی‌کنند |
| Google Vertex از مسیر OpenRouter برای `google/gemini-3.8-flash` | تولید جزوه و کارت از متن منتخب کلاس، transcript و دستور پردازش؛ در تنظیم فعلی تصویر و صوت به این مدل نمی‌رود. تأیید مالک به‌عنوان پردازشگر: D56، 2026-10-10 | درخواست با `zdr:true` و `data_collection:"deny"`؛ endpointهای ZDR در snapshot 2026-10-09: `google-vertex/global`، `google-vertex/global/priority`، `google-vertex/global/flex`؛ قرارداد subprocessors همان قرارداد OpenRouter در ردیف بالاست | snapshot فهرست احتمالی است و رسید واقعی نیست؛ tagهای global کشور قطعی را ثابت نمی‌کنند؛ انتقال خارج UK مانند سایر providerها هنوز ارزیابی نشده است؛ registry با هر تغییر مدل/route دوباره بررسی شود |

## نگهداری، آموزش و استثناها

- OpenRouter: payload ZDR با خاموش‌بودن logging از metadata/account/security/billing جداست. پردازش موقت، الزامات قانونی و کاربرد مخرب استثنا دارند؛ registry بر سیاست اعلام‌شده متکی است. «هیچ داده‌ای هرگز نگهداری نمی‌شود» یا «همهٔ شرکت‌ها قطعاً آموزش نمی‌دهند» ادعا نشده است.
- Vercel: [سیاست Data Preferences](https://vercel.com/changelog/updates-to-terms-of-service-march-2026) برای استفاده/اشتراک اختیاری code، agent chat و deployment/build telemetry جداست. تصویر تنظیمات مالک در 2026-10-05 نشان می‌دهد `Improve models with my data` خاموش است؛ این تغییر برای داده‌های آینده است و دادهٔ قبلاً اشتراک‌یافته را بازنمی‌گرداند. سیاست code/telemetry به‌عنوان شاهد آموزش روی همهٔ فایل‌های صوتی کاربران معرفی نمی‌شود.
- Vercel Runtime Logs: پلن Pro معمولاً یک روز و Pro+Observability Plus سی روز دارد. Plus در شاهد فعلی تعیین نشده است؛ صفر drain به معنی صفر همهٔ لاگ‌های مستقل Vercel نیست. بازهٔ مشاهدهٔ runtime تضمین حذف تمام رکوردهای امنیتی شرکت نیست.
- Supabase Free: جدول قیمت فعلی یک روز log retention برای API/DB نشان می‌دهد؛ محدودیت ماهانهٔ ingest/query می‌تواند آن را کمتر کند. optional جدول `auth.audit_log_entries` مستقل است و از بازهٔ داشبورد مدت حذف خودکار نتیجه نمی‌شود. سیاست حذف جدول باید مستقل تعیین شود.
- در پایان قرارداد Supabase، دورهٔ سی‌روزهٔ return و سپس حذف طبق DPA آمده است؛ این دوره، وعدهٔ حذف هر رکورد حساب Recalino ظرف سی روز نیست. حذف فعال اپ، backup خود اپ و log سرویس سه موضوع جدا هستند.

## بررسی انتقال خارج UK

مسیر مشخص‌شده: اپ/DB/Blob در لندن، Google و OpenRouter و subprocessors ممکن در US/Europe/global. وجود متن UK Addendum راه حقوقی بالقوه است؛ بررسی شرایط واقعی طرف/مقصد و کنترل‌ها باقی می‌ماند. هنوز «transfer assessment پذیرفته شده» اعلام نمی‌شود.

کنترل‌های کم‌کننده: انتخاب حداقل بخش لازم، عدم ارسال credential/لینک storage/رمز PDF به AI، دادهٔ خصوصی، صوت موقت، ZDR/deny/cache-off، exclusion حساس/کیفری و اطلاع روشن. ریسکِ provider با منطقهٔ unknown و exception قانونی با این کنترل‌ها خودکار صفر نمی‌شود.

تکمیل لازم: ثبت applicability حساب، نسخه/تاریخ قرارداد، فهرست authorized subprocessors و کشور/کارکرد مربوط، شاهد transfer mechanism و ارزیابی ریسک؛ بازبینی با تغییر مدل/route. اگر مسیر مورد نیاز در سیاست تاییدشده نباشد، برای مادهٔ واقعی استفاده نشود. پیشنهاد upgrade منطقه‌ای یا هزینهٔ تازه در این بررسی اجرا نشده است.

## فهرست subprocessor و مدیریت تغییر

[فهرست Supabase 2026-06-01](https://supabase.com/legal/subprocessor-list/June-1-2026.pdf) نقش‌ها را فهرست می‌کند اما کشور همهٔ موارد را مشخص نمی‌کند. درج یک vendor اثبات نمی‌کند هر حساب همهٔ ابزارهای اختیاری آن را استفاده می‌کند. [Vercel Trust Center](https://security.vercel.com/) و [OpenRouter Trust Center](https://trust.openrouter.ai/) مرجع فهرست مربوط‌اند؛ خروجی خواندنی عمومیِ این بررسی ردیف‌های کامل را ارائه نکرد، بنابراین مشاهدهٔ کامل/کشورها هنوز باز است.

notice subscriptionهای تأمین‌کنندگان در این کار ایجاد نشده‌اند. مهلت اعتراض و مدلِ اعلان providerهای AI با subprocessors ثابت یکسان نیست؛ درخواست محدودسازی مدل/route در تنظیمات به جای امضای یک DPA مستقیم با نام مدل‌ساز فرض نمی‌شود.

## منابع اصلی

- [Vercel DPA](https://vercel.com/legal/dpa)، [Vercel Terms](https://vercel.com/legal/terms)، [Runtime Logs](https://vercel.com/docs/logs/runtime).
- [Supabase Terms](https://supabase.com/terms)، [DPA](https://supabase.com/legal/customer-resources/data-processing-addendum)، [Auth audit](https://supabase.com/docs/guides/auth/audit-logs)، [Pricing](https://supabase.com/pricing)، [Logs Query usage](https://supabase.com/docs/guides/platform/manage-your-usage/logs-query).
- [OpenRouter Terms](https://openrouter.ai/terms)، [DPA](https://openrouter.ai/data-processing-agreement)، [Business comparison](https://openrouter.ai/business)، [ZDR](https://openrouter.ai/docs/guides/features/zdr)، [processing evidence](../runbooks/OPENROUTER_DATA_HANDLING.md).
- [Google API User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)، [Google transfer framework](https://policies.google.com/privacy/frameworks).
