# ۰۵ — پرسش‌های باز (Open Questions)

- **تاریخ:** 2026-10-21
- **مبنای کد:** commit `924735b` روی شاخهٔ `ccr-6c21ad01-nlxr08`
- **دامنه:** هر چه در این بررسی **UNKNOWN** ماند. این بررسی فقط به مخزن نگاه کرد و هیچ سرویس ابری، لاگ یا مقدار production خوانده نشد.
- **شناسه:** `AQ-NN`، که تازه است. ستون «ریسک» به [04](04-risk-register.md) ارجاع می‌دهد.

---

## ۱. پیکربندی production

| شناسه | پرسش | چرا مهم است | شاهد فعلی در مخزن | منبع پاسخ | ریسک |
|---|---|---|---|---|---|
| AQ-01 | مقدار واقعی `OPENROUTER_SETTINGS_JSON` در production چیست؟ این موارد مهم‌اند: مدل‌ها، `timeoutMs` هر مدل، `maxInputCharacters`، و در `lessonQuality` کلیدهای `classPartMinutes`، `learnerMarks` و `boardVisionModel` | زمان پردازش، احتمال timeout، سقف کلاس طولانی و کیفیت عکس به همین مقدارها بسته‌اند | فقط پیش‌فرض‌های `config/openrouter-defaults.json` (بدون `classPartMinutes`). عنوان Merge #61 می‌گوید «D78 … production setting on» | متغیرهای محیطی Vercel، توسط مالک یا اپراتور | AR-05، AR-07، AR-08، AR-09 |
| AQ-02 | `RECALINO_CAPTURE_EARLY_UPLOAD` و `RECALINO_CAPTURE_EARLY_TRANSCRIPTION` در production روشن‌اند؟ | پوشش «آپلود حین ضبط» (D60) و «رونویسی پس‌زمینه» (D61) و فاصلهٔ Stop تا جزوه | در کد پیش‌فرض روشن‌اند (`apps/web/src/server/capture-flags.ts:10`، `:13`) | متغیرهای محیطی Vercel | AR-01، AR-04 |
| AQ-03 | مقدارهای `src.input_contract` چیست؟ یعنی حداکثر حجم و مدت صوت، تعداد صفحهٔ PDF، اندازهٔ part و مهلت آپلود | فشار حافظهٔ Function، انقضای آپلود و رد شدن فایل به همین‌ها بسته است | جدول فقط ساختار دارد و مقدار پیش‌فرضی در migration یا `seed.sql` نیست (`supabase/migrations/20261004055403_src_operator_configuration.sql`) | دیتابیس ابری، با `select` فقط‌خواندنی و اجازهٔ مالک | AR-02، AR-03 |
| AQ-05 | تنظیم Functionها در Vercel چیست؟ حافظه، CPU، Fluid compute، region، فضای `/tmp`، و اینکه `maxDuration = 800` واقعاً اعمال می‌شود یا نه | سقف پردازش هم‌زمان صدا، ffmpeg و فایل بزرگ | فقط `apps/web/vercel.json` (cron) و `maxDuration` در route | داشبورد Vercel | AR-03، AR-15 |
| AQ-07 | مقدارهای `VOICE_SETTINGS_JSON` چیست (مثلاً `diarizationConcurrency` و آستانه‌ها)؟ مدل‌های صدا در production provision شده‌اند (`RECALINO_PROVISION_VOICE_MODELS`)؟ | اگر مدل نباشد، بررسی صدا با `voice_models_not_configured` شکست می‌خورد. پوشش و زمان هم به همین مقدارها بسته است | `apps/web/src/server/voice-engine.ts:187`–`:210` | متغیرهای محیطی Vercel و لاگ build | AR-11، AR-12، AR-15 |

## ۲. رفتار واقعی و داده‌های عملیاتی

| شناسه | پرسش | چرا مهم است | شاهد فعلی در مخزن | منبع پاسخ | ریسک |
|---|---|---|---|---|---|
| AQ-04 | اکنون چند جلسه Run کلاسی با تلاش `started` یا `uncertain` دارند؟ این حالت تا امروز چطور رفع شده است؟ SQL دستی بوده یا هرگز رفع نشده؟ | مسیر خروج در کد نیست. پاسخ نشان می‌دهد AR-05 در عمل چقدر رخ داده است | `packages/core/src/proc/runs.ts:416`، `:766`؛ پنل: `packages/core/src/ops/admin-read.ts:689` | شمارش فقط‌خواندنی روی `proc.provider_attempt` و `proc.processing_run`، با اجازهٔ مالک و بدون محتوا | AR-05 |
| AQ-06 | آیا OpenRouter هدر `Idempotency-Key` را برای `audio/transcriptions` و `chat/completions` رعایت می‌کند؟ آیا نتیجه یا هزینهٔ یک درخواست را می‌شود با `X-Generation-Id` بعداً استعلام کرد؟ | انتخاب بین گزینه‌های P-01 و P-02، یعنی retry امن در برابر خطر پرداخت دوباره | هدر فرستاده می‌شود (`packages/core/src/aip/openrouter.ts:114`) و شناسه ذخیره می‌شود (`provider_request_id`) | مستندات provider. خارج از دامنهٔ «فقط مخزن» این بررسی بود | AR-05، AR-06 |
| AQ-08 | آیا بیرون از اپ هشداری وجود دارد، مثل log drain در Vercel، ایمیل یا اعلان به اپراتور؟ | شکست Run امروز فقط در پنل دیده می‌شود | `packages/core/src/ops/health.ts:1`. در کد ارسال بیرونی نیست | تنظیمات Vercel و روال اپراتور | AR-19 |
| AQ-12 | پس از D104 تا D109، نرخ شکست آپلود و ضبط چقدر است؟ (NFR-07 stage times و `foreground_gap`) | بدون داده نمی‌شود اثر اصلاح‌های اخیر را سنجید | سنجه‌ها ثبت می‌شوند (`supabase/migrations/20261013120000_nfr07_stage_times.sql`)، ولی گزارشی پس از 2026-10-20 در مخزن نیست | شمارش فقط‌خواندنی، با اجازهٔ مالک | AR-01، AR-02 |
| AQ-15 | حجم فعلی دیتابیس و مصرف egress نسبت به سقف پلن رایگان چقدر است؟ | در ۵۰۰ مگابایت پروژه فقط‌خواندنی می‌شود | آستانهٔ ۴۰۰ مگابایت (`packages/core/src/ops/health.ts:32`) و D73 | کارت System health در پنل یا داشبورد Supabase | AR-21 |
| AQ-19 | ورود با Google در Supabase ابری اکنون فعال است؟ | مسیر ورود در system context به آن بستگی دارد | `CLAUDE.md` در 2026-10-04 آن را غیرفعال گزارش کرده است | داشبورد Supabase و [CLOUD_AUTH_CONFIG](../runbooks/CLOUD_AUTH_CONFIG.md) | — |

## ۳. دامنه و تصمیم محصول

| شناسه | پرسش | چرا مهم است | شاهد فعلی در مخزن | منبع پاسخ | ریسک |
|---|---|---|---|---|---|
| AQ-09 | منظور از «streaming transcription» در workflow مورد انتظار چیست؟ متن زنده که PRD بخش ۴.۲ آن را خارج از دامنه گذاشته، یا فقط رونویسی پس‌زمینه حین ضبط که D61 است و متنی نمایش نمی‌دهد؟ | جلوگیری از ساختن جزء خارج از MVP (PRD-CORE-06) | `PRD_Recalino_FA_v0.3.md:164`، D61 | مالک محصول | AR-04 |
| AQ-10 | آیا PRD-SPK-01 (برچسب Speaker 1/2/Unknown و انتخاب اختیاری مدرس) هنوز الزام است، یا D54 و D64 آن را با «تشخیص صدای خود زبان‌آموز» جایگزین کرده‌اند؟ | امروز در مسیر واقعی نقش مدرس وجود ندارد | `PRD_Recalino_FA_v0.3.md:295`، `packages/core/src/proc/steps/audio-source.ts:135` | مالک محصول، و ثبت نسخه‌دار در صورت تغییر | AR-13 |
| AQ-11 | آیا «فهم تصویر» در MVP درک نمودار، فلش و چیدمان تخته را هم می‌خواهد، یا استخراج متن با نوع بلوک کافی است؟ | دامنهٔ P-07 و هزینهٔ vision | `packages/core/src/src/service.ts:851` | مالک محصول | AR-09، AR-10 |
| AQ-13 | برای کلاس بلندتر از ۹۰ دقیقه چه رفتاری انتظار می‌رود؟ جزوهٔ بخش‌بخش (D63)، جزوهٔ ناقص (`partial_ready`)، یا شکست با پیام روشن؟ D63 در production فعال است؟ | AR-08 فقط با این پاسخ قطعی می‌شود | `packages/core/src/proc/steps/lesson.ts:34`، D63، D71 | مالک محصول و پیکربندی production (AQ-01) | AR-08 |
| AQ-18 | منظور از «teacher agent» چیست؟ تولید درس در Class Notes که امروز یک فراخوانی structured است، یا برنامهٔ جداگانهٔ «معلم تطبیقی و حافظهٔ آموزشی» که حافظه‌اش طبق D49 در تولید خاموش است؟ | معیار «خروجی ضعیف» و دامنهٔ P-06 به آن بستگی دارد | `packages/core/src/proc/steps/lesson.ts:22`، `apps/web/src/server/teaching-memory.ts:18`، [برنامهٔ معلم تطبیقی](../plans/CLAUDE_CODE_ADAPTIVE_TEACHER_AND_LEARNER_MEMORY_FA.md) | مالک محصول | AR-07 |

## ۴. حاکمیت و استقرار

| شناسه | پرسش | چرا مهم است | شاهد فعلی در مخزن | منبع پاسخ | ریسک |
|---|---|---|---|---|---|
| AQ-14 | ترتیب استقرار و migration در عمل چیست؟ آیا routeهای زبان‌آموز باید با schema عقب‌مانده سازگار باشند؟ دروازهٔ CI پیش از production (D83) در Vercel اعمال شده است؟ | route handlerها guard نسخهٔ schema ندارند | `apps/web/src/server/jobs.ts:195`، ممیزی OPS-04 و OPS-05، D83 | تنظیمات Vercel و GitHub، [RELEASE_RUNBOOK](../plans/RELEASE_RUNBOOK_2026-10-12.md) | AR-22 |
| AQ-16 | ADR-0004 (روش ادغام قطعه و مسیر ffmpeg) نوشته شده و جای دیگری است، یا هرگز نوشته نشد؟ | کد به آن ارجاع می‌دهد. تصمیم `stream` ثبت رسمی ندارد | `packages/core/src/plt/storage-vercel-blob.ts:185`، `docs/plans/M4_QUEUE_STORAGE.md:261` | مالک محصول، مدیر کار | AR-23 |
| AQ-17 | `pg-boss` در devDependencies ریشه هنوز لازم است؟ | وابستگی بی‌استفاده سطح زنجیرهٔ تأمین را بیشتر می‌کند | هیچ import در `apps`، `packages` و `tools` نیست | مدیر کار | — |

---

## ۵. چه پرسش‌هایی بدون تغییر کد پاسخ‌پذیرند

- **با خواندن فقط‌خواندنی و اجازهٔ صریح مالک:**
  - AQ-03، AQ-04، AQ-12 و AQ-15 با `select` شمارشی روی پروژهٔ `twowhuzhvyuzjrpraikm` پاسخ داده می‌شوند، بدون خواندن متن کلاس یا دادهٔ شخصی (قاعدهٔ CLAUDE.md).
  - AQ-01، AQ-02، AQ-05، AQ-07، AQ-08 و AQ-14 با دیدن **نام** و ساختار تنظیمات در Vercel پاسخ داده می‌شوند. مقدار secret لازم نیست.
- **با تصمیم مالک محصول:** AQ-09، AQ-10، AQ-11، AQ-13 و AQ-18. هر تغییری باید در [PRODUCT_DECISIONS_LOG](../PRODUCT_DECISIONS_LOG.md) نسخه‌دار ثبت شود.
- **با منبع بیرونی:** AQ-06، یعنی مستندات OpenRouter. این بررسی طبق دامنهٔ تأییدشده سراغ آن نرفت.
- **محدودیت این بررسی:** هیچ آزمونی اجرا نشد (`node_modules` نصب نبود و نصب ممنوع بود). همهٔ یافته‌ها از خواندن کد آمده‌اند. هر پیشنهاد [04](04-risk-register.md) پیش از اجرا گام اعتبارسنجی خودش را لازم دارد.
