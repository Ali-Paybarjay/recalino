# پردازش داده در OpenRouter

شاهد فنی خواندنی · 2026-10-04 · پیکربندی `openrouter-2026-10-04-2`

این سند رفتار adapter و metadata عمومی را ثبت می‌کند. در 2026-10-05 مالک محصول تأیید کرد که Private Input & Output Logging و OpenRouter Use of Inputs/Outputs در workspace مربوط به کلید خاموش‌اند. `dataContractApproved:true` اکنون در تنظیم production ثبت می‌شود؛ این تأیید جای بررسی دوره‌ای تنظیمات حساب و سیاست‌های مسیرهای provider را نمی‌گیرد.

## داده‌ای که adapter می‌فرستد

| کاربرد | مسیر | دادهٔ ارسالی |
|---|---|---|
| جزوه و کارت | `/api/v1/chat/completions` | متن انتخاب‌شده و دستور پردازش، با schema ساختاری |
| خواندن عکس و صفحه PDF | همان مسیر chat | بایت تصویر به‌شکل base64؛ PDF رمزدار ابتدا در سرور باز و صفحهٔ انتخاب‌شده رندر می‌شود |
| رونویسی | `/api/v1/audio/transcriptions` | بایت قطعهٔ صوت به‌شکل base64، قالب و درخواست timestamp |
| TTS | `/api/v1/audio/speech` | متن، مدل، صدای ازپیش‌تعریف‌شده و قالب خروجی MP3 |

کارگر فعلی URL خصوصی Blob، کلید ذخیره‌سازی یا رمز PDF را به مدل نمی‌فرستد. تصویر اصلی در مسیر عکس از بایت فایل خوانده می‌شود؛ حذف متادیتای تصویر پیش از ارسال AI در این مسیر اثبات نشده است. Files API، ابزار وب و شبیه‌سازی صدای فرد در این درخواست‌ها استفاده نمی‌شوند. این توصیف کد اپ است؛ defaults و اتصال‌های observability حساب بررسی نشده‌اند.

## کنترل‌های درخواست

متن و تصویر، رونویسی و TTS همگی `provider.zdr:true` و `provider.data_collection:"deny"` دارند. متن و تصویر همچنین `require_parameters:true` دارند. مستندات فعلی audio هر دو کنترل داده را پشتیبانی می‌کنند، اما `only`، `order` و `ignore` را برای STT/TTS اعمال نمی‌کنند؛ نباید به آن‌ها برای محدودکردن پردازش‌کنندهٔ صوت تکیه کرد. [STT](https://openrouter.ai/docs/guides/overview/multimodal/stt)، [TTS](https://openrouter.ai/docs/guides/overview/multimodal/tts)، [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)

همهٔ تماس‌ها هدر `X-OpenRouter-Cache:false` دارند. این هدر cache پاسخ OpenRouter را، حتی در صورت فعال‌شدن در preset، غیرفعال می‌کند. پیش از این تغییر نیز header/preset فعال‌کننده در adapter نبود و طبق مستندات cache خاموش بود؛ تغییر برای صریح‌کردن کنترل است. ZDR در سطح درخواست به‌تنهایی cache پاسخ را خاموش نمی‌کند. این cache با cache داخلی ارائه‌دهنده تفاوت دارد. [response caching](https://openrouter.ai/docs/guides/features/response-caching)

## پردازش‌کنندگان ممکنِ پیش‌فرض‌ها

خواندن عمومی HTTP 200 در `2026-10-04T17:28:38.572Z` از registry رسمی ZDR و تطبیق `model_id` انجام شد:

| مدل | ارائه‌دهندگان واجد ZDR در آن لحظه | tagهای اعلام‌شده |
|---|---|---|
| `anthropic/claude-haiku-4.5` | Amazon Bedrock، Google Vertex | `amazon-bedrock/global`، `/us`، `/eu-west-1`؛ `google-vertex/global`، `/us-east5`، `/europe` |
| `openai/whisper-large-v3-turbo` | DeepInfra، Groq | `deepinfra/us`، `groq` |
| `hexgrad/kokoro-82m` | DeepInfra، Together | `deepinfra/us`، `together` |

منبع عمومی: [registry ZDR](https://openrouter.ai/api/v1/endpoints/zdr). منابع مدل: [Haiku](https://openrouter.ai/api/v1/models/anthropic/claude-haiku-4.5/endpoints)، [Whisper](https://openrouter.ai/api/v1/models/openai/whisper-large-v3-turbo/endpoints)، [Kokoro](https://openrouter.ai/api/v1/models/hexgrad/kokoro-82m/endpoints).

این‌ها مسیرهای ممکن هستند، نه رسید پردازش یک درخواست واقعی. `global` یا tag بدون region محل قطعی پردازش را ثابت نمی‌کند. نام `openai/...` یا `anthropic/...` سازندهٔ مدل را نشان می‌دهد و شرکت اجراکننده را به‌تنهایی مشخص نمی‌کند. Anthropic و Azure در فهرست عمومی endpoints مدل Haiku بودند، اما در خروجی ZDR این مدل نبودند. registry و availability ممکن است تغییر کنند.

اپ از میزبان عمومی `openrouter.ai` استفاده می‌کند؛ لندن‌بودن پایگاه داده و Blob به معنی لندن‌بودن AI نیست. مسیرهای ممکن شامل آمریکا و خارج از بریتانیا هستند. مستندات، routing منطقه‌ای EU/US را به میزبان‌های جدا و پلن Business/Enterprise وابسته می‌دانند؛ این پروژه در این بررسی چنین مسیری را فعال نکرده است. [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)

## نگهداری و تنظیمات حساب

ZDR درخواست، مسیر inference را به endpoints با سیاست واجد ZDR محدود می‌کند. OpenRouter cache موقت داخل حافظهٔ بعضی مدل‌ها را retention محسوب نمی‌کند. ZDR ابزارها یا plugins جدا را پوشش نمی‌دهد. [ZDR](https://openrouter.ai/docs/guides/features/zdr)

OpenRouter نگهداری محتوای ورودی/خروجی را در حالت عادی opt-in اعلام می‌کند، اما private I/O logging و استفادهٔ OpenRouter از ورودی/خروجی تنظیمات جدا دارند. metadata درخواست همچنان نگهداری می‌شود و دسته‌بندی ناشناس نمونه‌های ورودی نیز توضیح داده شده است. `provider.zdr` و `data_collection` وضعیت این opt-inها را اثبات نمی‌کنند. تأیید مالک این پروژه دربارهٔ خاموش‌بودن دو گزینه در 2026-10-05 ثبت شده است؛ private logging، استفادهٔ محتوایی، broadcast و plugins/defaults مرتبط باید برای حساب و workspace مورد استفاده دوره‌ای بررسی شوند. [data collection](https://openrouter.ai/docs/guides/privacy/data-collection)

نشانی‌های فعلی مستندات برای workspace پیش‌فرض: [Private I/O Logging در Observability](https://openrouter.ai/workspaces/default/observability) و [OpenRouter Use of Inputs/Outputs در Workspace Settings](https://openrouter.ai/workspaces/default/settings). کنترل ZDR جدا در [Privacy Settings](https://openrouter.ai/settings/privacy) است. اگر کلید به workspace دیگری تعلق دارد، تنظیمات همان workspace بررسی می‌شوند؛ این صفحه‌ها به ورود مالک حساب نیاز دارند. [data collection](https://openrouter.ai/docs/guides/privacy/data-collection)، [ZDR](https://openrouter.ai/docs/guides/features/zdr)

DPA عمومی فعلی، به‌روزشده در 2026-08-26، حذف prompt/output را مشروط به خاموش‌بودن logging و با استثناهای قانونی/کاربرد مخرب توصیف می‌کند. registry ZDR بازتاب سیاست اعلام‌شدهٔ مدل‌پروایدر است و تضمین مستقل رفتار آن شرکت نیست. این سند از عبارت «هیچ داده‌ای هرگز نگهداری نمی‌شود» یا مدت نگهداری قراردادیِ اثبات‌نشده استفاده نمی‌کند. [DPA، بندهای ۱٫۱۹ و ۲٫۴](https://openrouter.ai/data-processing-agreement)

## مرز فعال‌سازی

Terms بند ۱۰٫۲، DPA را برای نمایندگی سازمان یا استفادهٔ تجاریِ انتفاعی به قرارداد ارجاع می‌دهد؛ وجود DPA عمومی به معنی الزام خودکار خرید پلن Enterprise نیست. مشخص‌کردن هویت طرف حساب و انطباق شرایط آن با این پایلوت، بررسی انتقال و نهایی‌کردن اطلاعیهٔ اپ هنوز جدا از این شاهد فنی هستند. DPA بند ۲٫۶، دسترسی به Sensitive Data را بدون توافق مربوط محدود می‌کند؛ مواد آموزشی باید در این بررسی لحاظ شوند. این سند نظر حقوقی یا رسید انعقاد قرارداد نیست. [Terms](https://openrouter.ai/terms)، [DPA](https://openrouter.ai/data-processing-agreement)

هر تغییر مدل یا مسیر باید با registry جاری، سقف هزینه و شرایط داده دوباره بررسی شود. تأیید ورود Google یا بودجه جای این بررسی را نمی‌گیرد. فعال‌سازی امروز فقط پس از تأیید مالکِ دو تنظیم حساب انجام شد و تماس provider را ممکن می‌کند؛ پیش از پردازش دادهٔ واقعی، مسئول داده و قواعد واقعی پایلوت باید تکمیل شوند.

## آزمون فنی

آزمون واحد adapter با fetch ساختگی کنترل‌های حریم خصوصی و هدر cache را برای chat همراه تصویر، STT و TTS بررسی می‌کند. دادهٔ صوت داخل درخواست قرار دارد؛ نبود تأیید قرارداد پیش از dispatch خطا می‌دهد. این آزمون رفتار درخواست اپ را اثبات می‌کند، نه عملکرد قراردادی سرویس بیرونی را.

اعتبارسنجی همین تغییر: ۸ آزمون مرتبط پاس شدند (۵ آزمون adapter و ۳ آزمون پیش‌فرض‌ها)، typecheck بستهٔ core و Biome دو فایل AIP نیز پاس شدند. پیش از افزودن هدر، سه آزمون chat/STT/TTS به‌علت نبود کنترل صریح cache شکست خوردند.
