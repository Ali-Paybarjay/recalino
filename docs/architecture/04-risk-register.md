# ۰۴ — ثبت ریسک‌های معماری (Risk Register)

- **تاریخ:** 2026-10-21
- **مبنای کد:** commit `924735b` روی شاخهٔ `ccr-6c21ad01-nlxr08`
- **برچسب‌ها:** CONFIRMED / INFERRED / UNKNOWN. تعریف آن‌ها در [01](01-system-inventory.md) آمده است. مسیرها نسبت به ریشهٔ مخزن‌اند.
- **شناسه‌ها:** `AR-NN` برای ریسک و `P-NN` برای پیشنهاد. هر دو تازه‌اند و با شناسه‌های [ممیزی 2026-10-18](../audit/2026-10-18-project-audit.md) (`SEC-`، `OPS-`، `PERF-`، `QUA-`، `UX-`) هم‌پوشانی ندارند.
- **بخش ۳ (پیشنهادها) فقط پیشنهاد است.** هیچ‌کدام اجرا نشده است. هر پیشنهادی که هزینه، سرویس تازه یا تغییر تصمیم قطعی لازم داشته باشد، تأیید مالک محصول را می‌خواهد.

---

## ۱. روش امتیازدهی

- **احتمال:** کم / متوسط / زیاد. یعنی اینکه در پایلوت فعلی رخ دهد.
- **اثر:** کم / متوسط / زیاد. یعنی اثر روی ارزش اصلی، یعنی رسیدن از کلاس به جزوه و مرور، روی داده یا روی هزینه.
- **شدت:** «زیاد × زیاد» بحرانی است. هر ترکیبی که یک «زیاد» و یک «متوسط» دارد، زیاد است. «متوسط × متوسط» متوسط است و بقیه کم.
- **برچسب ریسک** نشان می‌دهد سازوکار علت تا چه حد ثابت شده است. احتمال رخداد در production همیشه به دادهٔ بیرون از مخزن بستگی دارد.

---

## ۲. جدول خلاصه

| شناسه | حوزه | عنوان | احتمال | اثر | شدت | برچسب |
|---|---|---|---|---|---|---|
| AR-01 | آپلود | آپلود فقط با صفحهٔ باز پیش می‌رود | زیاد | متوسط | زیاد | CONFIRMED |
| AR-02 | آپلود | retry کوتاه در کلاینت و بازیابی دستی و مهلت‌دار | متوسط | متوسط | متوسط | CONFIRMED / UNKNOWN |
| AR-03 | آپلود و پردازش | خواندن کامل فایل در حافظهٔ Function، با سقف‌های نامعلوم | متوسط | زیاد | زیاد | INFERRED |
| AR-04 | رونویسی | رونویسی stream نیست و تا جزوه فاصله هست | زیاد | متوسط | زیاد | CONFIRMED |
| AR-05 | رونویسی و پردازش | **نتیجهٔ نامعلوم provider جلسه را قفل می‌کند** | متوسط→زیاد | زیاد | **بحرانی** | CONFIRMED |
| AR-06 | رونویسی و پردازش | وابستگی به یک provider، retry فقط برای 429، پیکربندی نامعتبرِ بی‌صدا | متوسط | زیاد | زیاد | CONFIRMED |
| AR-07 | teacher agent | کنترل کیفیت درس فقط ساختاری است | متوسط | زیاد | زیاد | CONFIRMED / INFERRED |
| AR-08 | teacher agent | کلاس طولانی و سقف ورودی LLM | متوسط | زیاد | زیاد | INFERRED / UNKNOWN |
| AR-09 | تصویر | خوانش عکس با LLM و بدون راستی‌آزمایی | متوسط | متوسط | متوسط | CONFIRMED / INFERRED |
| AR-10 | تصویر | افت وضوح و از دست رفتن ساختار نموداری تخته | متوسط | متوسط | متوسط | INFERRED |
| AR-11 | گوینده | پوشش نمونه‌ای ≤۸ دقیقه از هر انتخاب | زیاد | متوسط | زیاد | CONFIRMED |
| AR-12 | گوینده | پذیرش خودکار خاموش است و انتشار منتظر بررسی صدا می‌ماند | زیاد | متوسط | زیاد | CONFIRMED |
| AR-13 | گوینده | نقش مدرس هرگز به متن نسبت داده نمی‌شود (فاصله با PRD-SPK-01) | زیاد | متوسط | زیاد | CONFIRMED / INFERRED |
| AR-14 | گوینده | مدل embedding و شرایط آکوستیک کلاس | متوسط | متوسط | متوسط | INFERRED |
| AR-15 | گوینده و پردازش | ML و decoder بومی داخل Vercel Functions | متوسط | متوسط | متوسط | CONFIRMED / INFERRED |
| AR-16 | ناوبری | سطوح متعدد وضعیت و زیرصفحه‌های زیاد جلسه | متوسط | متوسط | متوسط | INFERRED |
| AR-17 | ناوبری | وضعیت با polling: تأخیر و egress | متوسط | کم | کم | CONFIRMED / INFERRED |
| AR-18 | امنیت | authorization تک‌لایه (BYPASSRLS، بدون policy) | کم | زیاد | متوسط | CONFIRMED |
| AR-19 | observability | شکست Run در سیگنال سلامت دیده نمی‌شود و هشدار بیرونی نیست | زیاد | متوسط | زیاد | CONFIRMED |
| AR-20 | ظرفیت | runner هر بار فقط یک Job برمی‌دارد | کم | متوسط | کم | INFERRED |
| AR-21 | ظرفیت | محدودیت پلن رایگان Supabase | متوسط | زیاد | زیاد | CONFIRMED / UNKNOWN |
| AR-22 | استقرار | guard نسخهٔ schema فقط در runner است | کم | متوسط | کم | INFERRED |
| AR-23 | حاکمیت | ADR-0004 در کد ارجاع دارد ولی وجود ندارد | — | کم | کم | CONFIRMED |

---

## ۳. جزئیات ریسک‌ها

### آپلود کند یا ناموفق

#### AR-01 — آپلود فقط با صفحهٔ باز پیش می‌رود

- **شرح:** Service Worker فقط `push` و `notificationclick` را مدیریت می‌کند. Background Sync و Background Fetch هم استفاده نمی‌شوند. پس آپلود فایل و ارسال صوت ضبط‌شده فقط وقتی پیش می‌رود که تب اپ باز و فعال باشد. روی موبایل، قفل صفحه یا رفتن به اپ دیگر آپلود را متوقف می‌کند.
- **شواهد:**
  - `apps/web/public/sw.js:9`، `:29`
  - حلقهٔ آپلود در صفحه: `apps/web/src/ui/workspace/UploadProvider.tsx:87`
  - علت ثبت‌شدهٔ 2026-10-12: «آپلود فقط با اپ باز و در پیش‌زمینه» ([FIVE_PROBLEMS §3.3](../plans/FIVE_PROBLEMS_ROOT_CAUSE_2026-10-12.md))
- **کاهش‌دهنده‌های موجود:**
  - داده پیش از ارسال در IndexedDB ذخیره می‌شود (`apps/web/src/ui/recording/store.ts:90`).
  - طبق D60، قطعه‌های مهرشده حین ضبط فرستاده می‌شوند.
  - طبق D109، آپلود گیرکرده پس از reload ادامه پیدا می‌کند.
- **برچسب:** CONFIRMED. نرخ رخداد در production **UNKNOWN** است.
- **پیشنهاد:** P-03

#### AR-02 — retry کوتاه در کلاینت و بازیابی دستی و مهلت‌دار

- **شرح:**
  - هر درخواست آپلود ۳ تلاش با فاصلهٔ ۱ و ۲ ثانیه دارد. بعد از آن `UploadInterruptedError` می‌آید و کاربر باید Retry بزند یا صفحه را دوباره باز کند.
  - جلسهٔ آپلود و Run منتظر آپلود مهلت دارند. اگر مهلت بگذرد، Run در `awaiting_upload` به `failed` می‌رود.
  - مقدار مهلت از قرارداد ورودی در دیتابیس خوانده می‌شود.
- **شواهد:**
  - `apps/web/src/ui/workspace/upload.ts:103`، `:117`
  - `apps/web/src/ui/recording/capture-uploader.ts:237`
  - `supabase/migrations/20261004042324_src_core.sql:101`، `expires_at`
  - `packages/core/src/proc/maintenance.ts:58`، `:81`
  - سابقه: رگرسیون D59 Run را یک روز در «منتظر آپلود» نگه داشت و پیام «Retry saved audio upload» ۱۷ بار شکست خورد ([FIVE_PROBLEMS §3.2، §7.1](../plans/FIVE_PROBLEMS_ROOT_CAUSE_2026-10-12.md)).
- **برچسب:** CONFIRMED (سازوکار). مقدار مهلت و نرخ فعلی، پس از D104 تا D109، **UNKNOWN** است.
- **پیشنهاد:** P-03

#### AR-03 — خواندن کامل فایل در حافظهٔ Function، با سقف‌های نامعلوم

- **شرح:**
  - برای STT، فایل اصلی کامل در حافظه خوانده و در `/tmp` نوشته می‌شود.
  - برای تحلیل صدا هم فایل اصلی کامل خوانده می‌شود.
  - سقف حجم و مدت ورودی در مخزن نیست و از جدول `src.input_contract` می‌آید.
  - اگر سقف‌ها بزرگ باشند، مثلاً WAV چندساعته، حافظه یا `/tmp` در Function تمام می‌شود و Run با خطای عمومی شکست می‌خورد.
- **شواهد:**
  - `apps/web/src/server/audio-preparer.ts:481`
  - `apps/web/src/server/voice-processing.ts:97` (و `readOwnedObject` در بدنهٔ `diarizeOriginal`)
  - `packages/core/src/src/contracts.ts:11`
  - migration تنظیم اپراتور `20261004055403_src_operator_configuration.sql`، که مقدار پیش‌فرض ندارد
- **برچسب:** INFERRED. سقف‌های واقعی و حافظهٔ Function **UNKNOWN** هستند (AQ-03، AQ-05).
- **پیشنهاد:** P-05

### رونویسی و پردازش

#### AR-04 — رونویسی stream نیست و تا جزوه فاصله هست

- **شرح:**
  - STT یک POST به‌صورت batch روی قطعه‌های ۵ دقیقه‌ای است.
  - طبق D61، رونویسی پس‌زمینه فقط قطعه‌های ۱۰ دقیقه‌ای **مهرشده** را حین ضبط پوشش می‌دهد. آخرین قطعه، آپلودهای فایل، بررسی صدا و تولید درس پس از «Process this session» انجام می‌شوند.
  - انتشار منتظر بررسی صدا می‌ماند.
  - اگر محصول «رونویسی زنده» را وعده بدهد یا کاربر آن را انتظار داشته باشد، با PRD بخش ۴.۲، که Live Transcription را خارج از دامنه گذاشته، تعارض دارد.
- **شواهد:**
  - `packages/core/src/aip/openrouter.ts:303`
  - `apps/web/src/server/audio-preparer.ts:376`
  - `packages/core/src/proc/capture-transcription.ts:39`
  - `packages/core/src/proc/worker.ts:39`–`:77`
  - `PRD_Recalino_FA_v0.3.md:164`
  - flagها: `apps/web/src/server/capture-flags.ts:10`
- **برچسب:** CONFIRMED. وضعیت flagها در production **UNKNOWN** است (AQ-02).
- **پیشنهاد:** P-06 (بخش زمان)، P-08 (انتظار صدا)

#### AR-05 — نتیجهٔ نامعلوم provider جلسه را قفل می‌کند (بحرانی)

- **شرح:**
  1. این حالت‌ها به `uncertain` می‌رسند: timeout، قطع شبکه یا HTTP ≥500 در **هر** فراخوانی پولی Run کلاس، یعنی هر قطعهٔ STT، هر عکس، درس یا اصلاح صدا.
  2. Run به `needs_input` می‌رود.
  3. از آن به بعد این‌ها همه رد می‌شوند:
     - Retry زبان‌آموز (`provider_outcome_unresolved`)
     - ساخت Run تازه برای همان جلسه
     - Retry مالک، که فقط برای `failed` بدون تلاش حل‌نشده مجاز است
  4. در کد هیچ مسیری نیست که تلاش `started` یا `uncertain` را به وضعیت دیگری ببرد. جست‌وجوی `updateTable("proc.provider_attempt")` فقط دو نقطهٔ ثبت نتیجه در `runtime.ts` را نشان داد. runbookها هم رویه‌ای ندارند.
  5. رابط می‌گوید «Contact the pilot operator» (D89)، ولی اپراتور هم ابزاری در اپ ندارد.
  6. با timeout پیش‌فرض ۹۰ ثانیه و تعداد زیاد قطعه در کلاس بلند (یک کلاس ۱۲۸ دقیقه‌ای حدود ۲۶ قطعهٔ STT دارد)، احتمال دست‌کم یک رخداد کم نیست.
- **شواهد:**
  - `packages/core/src/aip/openrouter.ts:118`، `:133`
  - `packages/core/src/proc/steps/runtime.ts:258`، `:486`، `:587`
  - `packages/core/src/proc/steps/fail-run.ts:40`
  - `packages/core/src/proc/runs.ts:416`، `:766`
  - `packages/core/src/proc/admin.ts:34`
  - نمایش در پنل: `packages/core/src/ops/admin-read.ts:689`
- **مرز:** Runهای کمکی رونویسی حین ضبط (D61) این قفل را نمی‌سازند، چون فیلتر `kind = 'class'` است (`packages/core/src/proc/runs.ts:407`–`:416`).
- **برچسب:** CONFIRMED (سازوکار و نبود مسیر خروج در کد). نرخ رخداد **UNKNOWN** است (AQ-04).
- **پیشنهاد:** P-01

#### AR-06 — وابستگی به یک provider، retry فقط برای 429، پیکربندی نامعتبرِ بی‌صدا

- **شرح:**
  - STT، LLM، vision و TTS همه فقط از OpenRouter می‌آیند و مدل جایگزینی تعریف نشده است.
  - فقط 429 retry خودکار دارد.
  - اگر `OPENROUTER_SETTINGS_JSON` نامعتبر باشد، `getAiProvider` بی‌صدا `undefined` برمی‌گرداند. خطا فقط هنگام استفاده و با کد `configuration_unavailable` دیده می‌شود. سلامت سیستم این را نمی‌سنجد.
- **شواهد:**
  - `apps/web/src/server/ai.ts:5`–`:16`
  - `packages/core/src/aip/contracts.ts:181`
  - `packages/core/src/aip/openrouter.ts:133`
  - `packages/core/src/proc/steps/fail-run.ts:22`
  - `packages/core/src/ops/health.ts:1`، که فهرست سیگنال‌هایش provider را ندارد
- **برچسب:** CONFIRMED
- **پیشنهاد:** P-02، P-04

### خروجی ضعیف teacher agent

#### AR-07 — کنترل کیفیت درس فقط ساختاری است

- **شرح:**
  - درس پیش از انتشار فقط از نظر ساختار سنجیده می‌شود: schema، SourceRef، پوشش منبع، زبان و قواعد کارت.
  - کیفیت آموزشی، یعنی عمق توضیح، تناسب با سطح و تعداد آیتم، پیش از انتشار سنجیده نمی‌شود.
  - بازبینی درس (`eval.lesson_review`) مشورتی است و فقط به درخواست کاربر اجرا می‌شود.
  - طبق D110، کارت‌های نامعتبر تا سقف `max(2, یک‌پنجم)` بی‌صدا حذف می‌شوند و فقط در لاگ آمار ثبت می‌شوند.
  - حافظهٔ آموزشی در تولید خاموش است.
  - سابقه: پیش از D62، هر ۷ درس منتشرشده ۴ تا ۶ آیتم داشتند و ۱۳ عکس از ۲۳ عکس اثری در درس نداشتند ([FIVE_PROBLEMS §5](../plans/FIVE_PROBLEMS_ROOT_CAUSE_2026-10-12.md)).
- **شواهد:**
  - `packages/core/src/proc/study-output-guard.ts:72`
  - `packages/core/src/proc/steps/study-output.ts:121`
  - `apps/web/src/server/lesson-review.ts:5`
  - `apps/web/src/server/teaching-memory.ts:18`
  - `packages/core/src/proc/steps/lesson.ts:22`
- **برچسب:** CONFIRMED (سازوکار). کیفیت فعلی **INFERRED** است و داده‌ای از production در مخزن نیست.
- **پیشنهاد:** P-06

#### AR-08 — کلاس طولانی و سقف ورودی LLM

- **شرح:**
  - اگر ورودی درس از `maxInputCharacters` بیشتر شود (پیش‌فرض ۱۲۰٬۰۰۰)، شکست `provider_input_too_large` می‌گیرد که retry ندارد.
  - تکه‌سازی D63 فقط وقتی فعال است که `lessonQuality.classPartMinutes` تنظیم شده باشد. این کلید در پیش‌فرض‌های مخزن نیست.
  - طبق توضیح `currentRunSnapshot`، ممکن است انتخاب به سقف ورودی محدود شود و بخشی از کلاس به‌جای شکست، «missing» شود.
  - رفتار دقیق یک کلاس ۱۲۸ دقیقه‌ای فقط از مخزن قطعی نشد.
- **شواهد:**
  - `packages/core/src/proc/knowledge-evidence.ts:132`
  - `packages/core/src/proc/steps/lesson.ts:34`
  - `config/openrouter-defaults.json`
  - `packages/core/src/proc/runs.ts:419`
  - D63 و D71
- **برچسب:** INFERRED. پیکربندی production **UNKNOWN** است (AQ-01، AQ-13).
- **پیشنهاد:** P-06

### فهم تصویر

#### AR-09 — خوانش عکس با LLM و بدون راستی‌آزمایی

- **شرح:**
  - عکس تخته فقط با یک فراخوانی vision خوانده می‌شود. prompt از ساختن متن منع می‌کند، ولی هیچ گذر دوم، OCR مستقل یا تأیید کاربر پیش از تدریس وجود ندارد.
  - تنها نشانهٔ تردید یک boolean به نام `uncertain` است.
  - SourceRef درس به بلوک‌هایی اشاره می‌کند که خود مدل vision ساخته است. پس «منسوب به کلاس» بودن یک ادعا، درستی خوانش را تضمین نمی‌کند.
- **شواهد:**
  - `packages/core/src/proc/steps/image-sources.ts:74`
  - `packages/core/src/proc/steps/vision.ts:71`
  - `packages/core/src/src/service.ts:851`
- **برچسب:** CONFIRMED (سازوکار). نرخ خطای خوانش **UNKNOWN** است.
- **پیشنهاد:** P-07

#### AR-10 — افت وضوح و از دست رفتن ساختار نموداری تخته

- **شرح:**
  - عکس به ۳۰۷۲ یا ۲۰۴۸ پیکسل و حداکثر ۳ مگابایت کوچک می‌شود، بدون برش. نوشتهٔ ریز در عکس عریض از کل تخته ممکن است ناخوانا شود.
  - نوع بلوک‌ها متنی‌اند: `relation` و `table` هست، ولی شکل، فلش و چیدمان فضایی نیست. پس نمودار و نقشهٔ ذهنی تخته صاف یا حذف می‌شود.
- **شواهد:**
  - `apps/web/src/server/image-preparer.ts:41`، `:42`
  - `packages/core/src/src/service.ts:851`
  - بازخورد خوانایی سمت کلاینت (D72): `apps/web/src/ui/recording/photo-quality.ts`
- **برچسب:** INFERRED
- **پیشنهاد:** P-07

### تشخیص گوینده

#### AR-11 — پوشش نمونه‌ای ≤۸ دقیقه از هر انتخاب

- **شرح:**
  - تحلیل صدا حداکثر ۸ پنجرهٔ ۵۸ ثانیه‌ای از هر انتخاب را بررسی می‌کند.
  - در کلاس ۱۲۸ دقیقه‌ای، حدود ۶٪ صوت بررسی می‌شود.
  - خط‌های زبان‌آموز بیرون از پنجره‌ها پیدا نمی‌شوند و اشتباه گفتاری آن‌ها اصلاح نمی‌شود.
- **شواهد:**
  - `apps/web/src/server/voice-source-windows.ts:1`، `:12`
  - `apps/web/src/server/voice-processing.ts:54`
  - [FIVE_PROBLEMS §6.1](../plans/FIVE_PROBLEMS_ROOT_CAUSE_2026-10-12.md)
  - طبق D69، `backgroundCoverage` خاموش است.
- **برچسب:** CONFIRMED
- **پیشنهاد:** P-08

#### AR-12 — پذیرش خودکار خاموش است و انتشار منتظر بررسی صدا می‌ماند

- **شرح:**
  - `VOICE_ACCEPTANCE_POLICIES` خالی است، پس هر کلاس تأیید دستی «This is me» می‌خواهد.
  - Run پیش از انتشار منتظر پایان بررسی صدا می‌ماند. مالک در D61 «انتشار جزوه پیش از نتیجهٔ صدا» را رد کرده است.
  - کندی یا شکست موتور صدا مستقیم زمان رسیدن جزوه را بالا می‌برد.
- **شواهد:**
  - `packages/core/src/voc/policy-registry.ts:10`
  - `packages/core/src/proc/worker.ts:58`–`:77`
  - D61، D64، D69
- **برچسب:** CONFIRMED
- **پیشنهاد:** P-08 (تغییر قاعدهٔ انتظار فقط با تصمیم تازهٔ مالک ممکن است)

#### AR-13 — نقش مدرس هرگز به متن نسبت داده نمی‌شود

- **شرح:**
  - PRD-SPK-01 دو چیز می‌خواهد: برچسب «Speaker 1، Speaker 2، Unknown» و انتخاب اختیاری «این گوینده مدرس است».
  - در مسیر واقعی، `speakerRole` همهٔ بلوک‌های صوتی `unknown` است و رابطی برای تعیین مدرس نیست. این برچسب‌ها فقط در `/preview` و با دادهٔ مصنوعی دیده شدند.
  - schema جزوه ادعای `teacher` را بدون بلوک teacher نمی‌پذیرد، پس متن طبق PRD-SPK-03 به عبارت «در گفت‌وگوی کلاس» برمی‌گردد. این جلوی نسبت‌دادن نادرست را می‌گیرد.
  - ولی «اصلاح مدرس» و «توضیح مدرس» در `study-prompt` و `knowledge-generation` به برداشت LLM از متن بی‌نقش وابسته‌اند.
  - D54 و D64 مسیر صدا را به «صدای خود زبان‌آموز» برده‌اند. اینکه PRD-SPK-01 هنوز الزام است یا نه، روشن نیست.
- **شواهد:**
  - `packages/core/src/aip/contracts.ts:140`
  - `packages/core/src/proc/steps/audio-source.ts:135`
  - `packages/core/src/proc/capture-transcription.ts:217`
  - `packages/core/src/lkm/schema.ts:37`، `:187`
  - `apps/web/src/ui/preview/LearningViews.tsx:545`
  - `PRD_Recalino_FA_v0.3.md:295`
- **برچسب:** CONFIRMED (نبود در مسیر واقعی). اثر روی کیفیت **INFERRED** است.
- **پیشنهاد:** P-09

#### AR-14 — مدل embedding و شرایط آکوستیک کلاس

- **شرح:**
  - embedding از `wespeaker_en_voxceleb_resnet34_LM` می‌آید که روی گفتار VoxCeleb آموزش دیده است.
  - کد ثبت کرده که میکروفون دور همهٔ امتیازها را بالا می‌برد: صدای غالب کلاس 2026-10-12 امتیاز ۰٫۷۰ تا ۰٫۷۷ گرفت، در حالی که کف پیشنهاد طبق D69 برابر ۰٫۶ است.
  - برای لهجه‌ها و زبان‌های دیگرِ زبان‌آموزان، دقت ارزیابی نشده است. ارزیابی موجود روی جلسه‌های calibration است.
- **شواهد:**
  - `apps/web/src/server/voice-engine.ts:190`
  - `packages/core/src/voc/analysis.ts:306`
  - `apps/web/src/server/voice-source-windows.ts:12` (انتخاب روی calibration)
  - `tools/voice/evaluation`
- **برچسب:** INFERRED
- **پیشنهاد:** P-08

#### AR-15 — ML و decoder بومی داخل Vercel Functions

- **شرح:**
  - ffmpeg، sherpa-onnx و مدل‌های ONNX، sharp، pdf.js و canvas در Functionهای پردازش بسته‌بندی می‌شوند.
  - طبق fix tracker، بزرگ‌ترین Function ۱۷۱٫۱ مگابایت است و نگهبان اندازه ۲۲۵ مگابایت.
  - CPU-bound بودن diarization و decode، cold start و سقف ۸۰۰ ثانیه، همه روی همان Function فشار می‌آورند.
- **شواهد:**
  - `apps/web/next.config.ts:63`، `:73`
  - `apps/web/src/server/voice-engine.ts:187`
  - [fix tracker](../audit/2026-10-18-fix-tracker.md)، موج ۱
  - ممیزی PERF-01 و OPS-06
- **برچسب:** CONFIRMED (پیکربندی). اثر **INFERRED** است.
- **پیشنهاد:** P-05

### ناوبری گیج‌کنندهٔ workflow

#### AR-16 — سطوح متعدد وضعیت و زیرصفحه‌های زیاد جلسه

- **شرح:**
  - اکنون تابع واحد `sessionNextStep` وجود دارد و صفحهٔ جلسه و Today از آن استفاده می‌کنند. ریشهٔ ثبت‌شده در 2026-10-12 تا حدی برطرف شده است.
  - ولی جلسه هنوز ۱۰ زیرصفحه دارد: `record`، `sources`، `estimate`، `processing`، `voice`، `notes`، `notes/versions`، `cards`، `export` و `options`.
  - وضعیت همچنان در چند جا جدا نمایش داده می‌شود: صف آپلود سراسری، مرکز اعلان، `/recordings` و صفحهٔ صدا.
  - تغییرهای پیاپی D103 تا D110 در دو روز نشان می‌دهد این ناحیه هنوز ناپایدار است.
  - دادهٔ کاربردپذیری در مخزن نیست.
- **شواهد:**
  - `apps/web/src/ui/workspace/session-state.ts:156`
  - `apps/web/src/app/(app)/sessions/[id]/page.tsx:14`
  - `apps/web/src/app/(app)/today/page.tsx:16`
  - `apps/web/src/ui/workspace/UploadProvider.tsx:87`
  - [FIVE_PROBLEMS §7](../plans/FIVE_PROBLEMS_ROOT_CAUSE_2026-10-12.md)
- **برچسب:** INFERRED
- **پیشنهاد:** P-10

#### AR-17 — وضعیت با polling: تأخیر و egress

- **شرح:**
  - صفحه‌ها وضعیت را با polling می‌خوانند:
    - learning: ۳ ثانیه با backoff تا ۶۰ ثانیه
    - processing: ۲ ثانیه
    - sources: ۳ ثانیه
    - صف آپلود: ۵ ثانیه
  - پس ممکن است جزوه آماده باشد و چند دقیقه بعد نمایش داده شود. 2026-10-12 فاصلهٔ ۶ دقیقه‌ای ثبت شد.
  - هر poll هم egress پلن رایگان را مصرف می‌کند (D73).
- **شواهد:**
  - `apps/web/src/ui/workspace/automatic-learning-poll.ts:8`
  - `apps/web/src/ui/workspace/ProcessingView.tsx:86`
  - `apps/web/src/ui/workspace/SourcesView.tsx:259`
  - D73
- **برچسب:** CONFIRMED (سازوکار). تأخیر فعلی **INFERRED** است.
- **پیشنهاد:** P-10

### ریسک‌های بین‌بخشی

#### AR-18 — authorization تک‌لایه

- **شرح:**
  - نقش اپ `bypassrls` دارد و هیچ RLS policy وجود ندارد. مالکیت فقط در کد اپ بررسی می‌شود.
  - این تصمیم آگاهانه است (ADR-0002) و آزمون cross-account برای هر route زبان‌آموز الزامی است.
  - ولی یک query تازه بدون فیلتر مالکیت، مثلاً در Job یا گزارش مالک، لایهٔ دومی ندارد که جلویش را بگیرد.
- **شواهد:**
  - `supabase/migrations/20260930175238_baseline.sql:11`
  - `packages/core/src/plt/ownership.ts:14`
  - `apps/web/AGENTS.md`
  - [ADR-0002](../adr/0002-data-access-and-migrations.md)
- **برچسب:** CONFIRMED
- **پیشنهاد:** P-11

#### AR-19 — شکست Run در سیگنال سلامت دیده نمی‌شود و هشدار بیرونی نیست

- **شرح:**
  - `processingJob` خطا را می‌گیرد و `failRun` را اجرا می‌کند و برمی‌گردد. فقط خطای قابل retry (429) دوباره پرتاب می‌شود. پس در بقیهٔ حالت‌ها Job `succeeded` ثبت می‌شود، با اینکه Run `failed` یا `needs_input` شده است.
  - سیگنال «Jobهای شکست‌خوردهٔ ساعت گذشته» در `ops.health_check` این را نمی‌بیند.
  - هشدار فقط به‌صورت رخداد ممیزی و لاگ در پنل مالک ثبت می‌شود. ارسال بیرونی، مثل ایمیل، ندارد.
  - نتیجه: Runهای قفل‌شدهٔ AR-05 فقط وقتی دیده می‌شوند که کسی پنل را باز کند.
- **شواهد:**
  - `packages/core/src/proc/worker.ts:79`
  - `packages/core/src/plt/jobs.ts:453` (`completeJob` پس از بازگشت عادی)
  - `packages/core/src/ops/health.ts:1`، `:32`
  - ممیزی OPS-02 (در fix tracker: «ادغام‌شده (بخشی)»)
- **برچسب:** CONFIRMED
- **پیشنهاد:** P-04

#### AR-20 — runner هر بار فقط یک Job برمی‌دارد

- **شرح:**
  - `runDueJobs` در هر دور `claimJobs(..., 1, ...)` اجرا می‌کند و Jobها را پشت‌سرهم پیش می‌برد. موازی‌سازی فقط از چند invocation می‌آید.
  - pool هر instance ۳ اتصال دارد.
  - در پایلوت کوچک مشکلی نیست. با رشد کاربر، تأخیر صف (`queuedAgeSeconds` = ۱۵ دقیقه) زودتر هشدار می‌دهد.
- **شواهد:**
  - `packages/core/src/plt/jobs.ts:471`
  - `apps/web/src/server/db.ts:9`
  - `packages/core/src/ops/health.ts:32`
- **برچسب:** INFERRED
- **پیشنهاد:** P-12

#### AR-21 — محدودیت پلن رایگان Supabase

- **شرح:**
  - پلن رایگان در ۵۰۰ مگابایت حجم دیتابیس پروژه را فقط‌خواندنی می‌کند. آستانهٔ هشدار ۴۰۰ مگابایت است.
  - egress هم سقف دارد و D73 به آن برخورد.
  - همهٔ وضعیت‌ها، checkpointها، لاگ ممیزی و صف در همین دیتابیس‌اند.
- **شواهد:**
  - `packages/core/src/ops/health.ts:32`
  - [ADR-0001](../adr/0001-stack-and-hosting.md)
  - D73
  - `docs/implementation/egress-status-reads.md`
- **برچسب:** CONFIRMED (سازوکار). مصرف فعلی **UNKNOWN** است (AQ-15).
- **پیشنهاد:** P-12

#### AR-22 — guard نسخهٔ schema فقط در runner است

- **شرح:**
  - runner، wake و `/api/health` در دیتابیسِ عقب‌مانده کاری نمی‌کنند.
  - route handlerهای زبان‌آموز چنین guardی ندارند و ممکن است با ستونی که هنوز ساخته نشده خطای 500 بدهند.
  - ممیزی OPS-05 در fix tracker «ادغام‌شده (بخشی)» است.
- **شواهد:**
  - `apps/web/src/server/jobs.ts:195`، `:235`
  - `apps/web/src/server/health.ts:27`
  - جست‌وجوی `createSchemaGuard`
- **برچسب:** INFERRED
- **پیشنهاد:** P-12

#### AR-23 — ADR-0004 در کد ارجاع دارد ولی وجود ندارد

- **شرح:**
  - کد و برنامهٔ M4 انتخاب روش ادغام قطعه (`stream` یا `multipart`) و مسیر ffmpeg را به ADR-0004 سپرده‌اند.
  - `docs/adr/` فقط ۰۰۰۱ تا ۰۰۰۳ دارد. کد عملاً `stream` را به کار می‌برد.
- **شواهد:**
  - `packages/core/src/plt/storage-vercel-blob.ts:185`
  - `packages/core/src/plt/storage.ts:350`
  - `docs/plans/M4_QUEUE_STORAGE.md:20`، `:261`
- **برچسب:** CONFIRMED
- **پیشنهاد:** P-12

---

## ۴. پیشنهادهای بهبود (جدا از یافته‌ها، اجرا نشده)

> هر پیشنهاد سه بخش دارد: گزینه‌ها، trade-off، و گام‌های اعتبارسنجی. پیشنهادهایی که با هزینه، سهمیه، سرویس تازه یا تصمیم قطعی مالک (D..) سروکار دارند، **پیش از هر اقدامی تأیید مالک محصول** می‌خواهند (CLAUDE.md، قید هزینه و دامنه).

### P-01 — مسیر خروج برای تلاش نامعلوم provider (برای AR-05)

- **گزینه‌ها:**
  1. **reconcile خودکار:** نتیجهٔ تلاش با `provider_request_id` (`X-Generation-Id`) از OpenRouter استعلام شود. اگر هزینه یا نتیجه معلوم شد، تلاش `succeeded` یا `failed` شود. این گزینه به اینکه چنین استعلامی ممکن باشد بستگی دارد (AQ-06).
  2. **سیاست زمانی:** پس از مهلتی معین، مثلاً دو برابر timeout مدل، تلاش `uncertain` به `failed` برود. هزینهٔ حداکثری در `quota.cost_hold` نگه داشته شود و retry با `operation_key` تازه مجاز شود.
  3. **اقدام مالک:** دکمهٔ «resolve» در پنل، با دلیل و `recordAudit`.
- **trade-off:**
  - گزینهٔ ۲ و ۳ خطر پرداخت دوباره به provider را می‌پذیرند تا جلسه قفل نماند.
  - گزینهٔ ۱ دقیق‌تر است، ولی به API بیرونی وابسته است.
  - کسر سهمیهٔ کاربر در هر سه باید یک‌باره بماند (PRD-COST-02).
- **اعتبارسنجی:**
  - آزمون integration با شبیه‌سازی timeout در `stt:<chunk>` و در `knowledge`.
  - بررسی اینکه کسر سهمیهٔ کاربر دوباره رخ نمی‌دهد.
  - شمارش Runهای `needs_input` با `unresolved_attempt` در پنل، پیش و پس از تغییر.

### P-02 — لایهٔ پایداری provider (برای AR-06)

- **گزینه‌ها:**
  - retry محدود برای 5xx، فقط اگر رعایت `Idempotency-Key` تأیید شود.
  - مدل STT پشتیبان در همان OpenRouter، پس از ارزیابی و تأیید قرارداد داده.
  - سیگنال سلامت «provider configuration unavailable» وقتی `getAiProvider` مقدار `undefined` برمی‌گرداند.
- **trade-off:** هزینهٔ تکرار. مدل تازه دروازهٔ قرارداد داده و ارزیابی D56 را لازم دارد.
- **اعتبارسنجی:**
  - آزمون واحد `OpenRouterProvider` با پاسخ‌های 500 و 503 و timeout.
  - آزمون health با JSON نامعتبر.

### P-03 — پایداری آپلود (برای AR-01 و AR-02)

- **گزینه‌ها:**
  - بودجهٔ retry بلندتر با jitter.
  - ادامهٔ خودکار با `online` و `visibilitychange`.
  - نمایش پیشرفت هر part.
  - Background Sync فقط در مرورگرهایی که پشتیبانی می‌کنند (Safari iOS ندارد).
  - تکیهٔ بیشتر بر D60 برای ضبط داخل اپ.
- **trade-off:** پیچیدگی کلاینت. Background Sync پوشش کامل ندارد.
- **اعتبارسنجی:**
  - Playwright با throttling و offline و reload.
  - مقایسهٔ زمان مراحل NFR-07 پیش و پس از تغییر.
  - آزمون دستی روی Safari iOS و Chrome Android.

### P-04 — هشدار شکست پردازش (برای AR-19 و AR-06)

- **گزینه:** افزودن این سیگنال‌ها به `ops.health_check`:
  - تعداد Runهای `failed` یا `needs_input` در ساعت گذشته
  - Run با تلاش حل‌نشده
  - در دسترس نبودن پیکربندی provider

  هشدار از همان صف ایمیل موجود به اپراتور فرستاده شود، بدون سرویس پولی تازه.
- **trade-off:** نویز هشدار، که با قاعدهٔ موجودِ «یک هشدار در هر دوره» کنترل می‌شود.
- **اعتبارسنجی:**
  - آزمون واحد health با fixture یک Run شکست‌خورده.
  - اجرای آزمایشی روی Supabase محلی.

### P-05 — کاهش فشار حافظه و اندازهٔ Function (برای AR-03 و AR-15)

- **گزینه‌ها:**
  - ffmpeg و موتور صدا به‌جای بارگذاری کامل، از stream یا link خصوصی کوتاه‌عمر بخوانند.
  - سقف حجم و مدت قرارداد ورودی بر پایهٔ اندازه‌گیری حافظه تعیین شود.
  - Function پردازش از Functionهای API جدا شود.
- **trade-off:** seek روی stream پیچیده‌تر است. هر link باید مثل امروز خصوصی و کوتاه‌عمر بماند.
- **اعتبارسنجی:**
  - fixture مصنوعی در سقف قرارداد.
  - اندازه‌گیری حافظه و زمان با `pnpm ops timings`.
  - `pnpm check:function-size`.

### P-06 — کیفیت و زمان درس (برای AR-07، AR-08 و AR-04)

- **گزینه‌ها:**
  - پیش از هر تغییر مدل یا prompt، معیار کیفیت offline با ابزار `eval` موجود و معیار D56 اجرا شود.
  - متریک‌های هر درس در پنل مالک ثبت شود: تعداد آیتم، پوشش منبع، کارت حذف‌شده و repair.
  - D63 پس از ارزیابی با `classPartMinutes` فعال شود.
  - سقف ورودی در صفحهٔ برآورد پیش‌بررسی و به زبان کاربر گفته شود.
- **trade-off:** هزینهٔ ارزیابی پولی که سقفش با مالک است. تکه‌سازی زمان پردازش را بالا می‌برد.
- **اعتبارسنجی:**
  - benchmark holdout ([LESSON_REVIEW_BENCHMARK](../plans/LESSON_REVIEW_BENCHMARK_2026-10-11.md)).
  - کلاس مصنوعی ۱۲۰ دقیقه به بالا. تا بسته شدن G11 فقط دادهٔ مصنوعی یا دارای مجوز.

### P-07 — خوانش قابل‌اعتمادتر عکس (برای AR-09 و AR-10)

- **گزینه‌ها:**
  - tiling یا برش عکس‌های بزرگ.
  - گذر دوم فقط برای بلوک‌های `uncertain`.
  - نمایش خوانش عکس به کاربر با امکان اصلاح پیش از درس. این گزینه با «ویرایش کاربر» و منشأ (PRD-CORE-03) سازگار است.
- **trade-off:** هزینهٔ vision بیشتر و زمان بیشتر. تغییر UI به طرح و تأیید متن نیاز دارد (D34، D65).
- **اعتبارسنجی:** مجموعهٔ عکس تختهٔ مصنوعی برچسب‌دار با معیار پوشش متن و خطای نویسه.

### P-08 — پوشش و جریان صدا (برای AR-11، AR-12 و AR-14)

- **گزینه‌ها:**
  - پوشش تطبیقی، یعنی پنجره‌های بیشتر در Jobهای ادامه‌دار.
  - تکمیل دروازهٔ ارزیابی D54 برای پذیرش خودکار.
  - انتشار درس پیش از نتیجهٔ صدا و به‌روزرسانی بعدی. این گزینه **با D61 تعارض دارد** و فقط با تصمیم تازهٔ مالک ممکن است.
- **trade-off:** زمان CPU و سقف Function، در برابر پوشش بیشتر.
- **اعتبارسنجی:**
  - `tools/voice/evaluation`: recall خط‌های زبان‌آموز و خطای تطبیق، روی دادهٔ calibration و مصنوعی.

### P-09 — تکلیف PRD-SPK-01 (برای AR-13)

- **گزینه‌ها:**
  1. برچسب گوینده و انتخاب اختیاری مدرس از خروجی diarization ساخته شود، با تأیید کاربر.
  2. با ثبت نسخه‌دار در PRODUCT_DECISIONS_LOG اعلام شود که PRD-SPK-01 با D54 و D64 جایگزین شده است.
- **trade-off:** گزینهٔ ۱ پوشش کامل diarization را لازم دارد (P-08). گزینهٔ ۲ هزینه ندارد، ولی ادعای «توضیح مدرس» را محدود می‌کند.
- **اعتبارسنجی:** به‌روزرسانی FR-VOC و آزمون عبارت PRD-SPK-03.

### P-10 — یک منبع وضعیت برای ناوبری (برای AR-16 و AR-17)

- **گزینه‌ها:**
  - یک endpoint وضعیت جلسه که `next step` را سمت سرور می‌سازد و Today، صفحهٔ جلسه، صف آپلود و اعلان همه از آن می‌خوانند.
  - ادغام `estimate` و `processing`.
  - polling تطبیقی کمتر، همراه با بیدارسازی از اعلان.
- **trade-off:** بازطراحی UI به Figma و تأیید مالک نیاز دارد (D34، D35، D65).
- **اعتبارسنجی:** آزمون کاربردپذیری با ۵ کار اصلی، e2e مسیرهای اصلی، و شمارش درخواست‌های poll در هر جلسه.

### P-11 — دفاع در عمق برای دسترسی (برای AR-18)

- **گزینه‌ها:**
  - RLS policy روی جدول‌های دارای `user_id`، با `set_config` داخل تراکنش.
  - یا بررسی ایستا در CI که هر query روی جدول کاربر فیلتر مالکیت دارد.
- **trade-off:** سازگاری با Supavisor در حالت transaction و نقش BYPASSRLS، و هزینهٔ کارایی.
- **اعتبارسنجی:** آزمون‌های cross-account موجود و آزمون RLS در `pnpm test:int`.

### P-12 — ظرفیت، استقرار و حاکمیت (برای AR-20 تا AR-23)

- **گزینه‌ها:**
  - claim دسته‌ای یا چند lane در runner، وقتی سیگنال تأخیر صف تکرار شود.
  - پایش egress.
  - guard نسخهٔ schema برای routeها، یا اجرای اجباری migration پیش از deploy.
  - نوشتن ADR-0004.
- **trade-off:** اتصال‌های بیشتر به پلن رایگان. پیچیدگی پیکربندی استقرار.
- **اعتبارسنجی:**
  - load test با Jobهای مصنوعی روی Supabase محلی.
  - آزمون guard با دیتابیس عقب‌مانده.

---

## ۵. ارتباط با اسناد پیشین

| ریسک | پیوند |
|---|---|
| AR-01، AR-02 | FIVE_PROBLEMS §3 و §4، D59، D60، D104 تا D109 |
| AR-05 | D89 (متن پیام). در ممیزی 2026-10-18 یافتهٔ جدایی برای «نبود مسیر خروج» ثبت نشده است |
| AR-06، AR-19 | ممیزی OPS-02 (بخشی) |
| AR-07، AR-08 | FIVE_PROBLEMS §5، D62، D63، D110 |
| AR-11 تا AR-14 | FIVE_PROBLEMS §6، D54، D64، D69، PRD-SPK-01 تا 03 |
| AR-15 | ممیزی PERF-01 و OPS-06 |
| AR-16، AR-17 | FIVE_PROBLEMS §7، D71، D73، D105 تا D107 |
| AR-22 | ممیزی OPS-05 (بخشی) |
