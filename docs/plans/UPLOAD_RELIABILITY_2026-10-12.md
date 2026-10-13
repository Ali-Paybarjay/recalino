# کار ۱ — پایداری آپلود صوت — 2026-10-12

شاخه: `feat/upload-reliability`. مبنا: `43f12a9` (`main @ b4aa3d5` به‌علاوهٔ [سند ریشه‌یابی](FIVE_PROBLEMS_ROOT_CAUSE_2026-10-12.md)، بخش ۳ و ۴.۳-الف).

## ۱. خلاصه

| # | کار | نتیجه |
|---|---|---|
| ۱ | رگرسیون D59 در شروع آپلود صوت | رفع شد؛ آزمون integration کامل (شروع، تأیید قطعه، تکمیل، verify، رونویسی، انتشار) بدون کسر دوبارهٔ صوت |
| ۲ | تلاش دوبارهٔ بی‌نتیجه | کدهای دلیل پایدار در سرور و کلاینت؛ دکمهٔ Retry فقط جایی که می‌تواند موفق شود؛ متن‌های تازه در انتظار تأیید |
| ۳ | polling | فقط کلاس‌های در جریان، کلاس در حال مشاهده و کار دستگاه؛ backoff؛ توقف در صفحهٔ پنهان |
| ۴ | انتقال موازی صوت | تا ۲ فایل هم‌زمان، حداکثر ۴ قطعهٔ هم‌زمان در کل (۳ برای هر فایل، مثل قبل) |
| ۵ | زودترین شروع مجاز | آپلود همان لحظهٔ ساخت Run مجاز می‌شود؛ سقف backoff تضمین می‌کند حداکثر ۶ ثانیه بعد شروع شود. شروع زودتر تصمیم می‌خواهد (بخش ۸) |
| ۶ | زمان مراحل (NFR-07) | دستور فقط‌خواندنی `pnpm --filter @recalino/ops-cli timings` با p50/p95 هر مرحله |

پس از استقرار (که با من نیست)، برای جلسه‌های `572dda3f` و `f36401c8` فقط Retry لازم است. صوت هر دو روی دستگاه است و نوشتن در دیتابیس لازم نیست.

- Run قدیمی این دو جلسه با کد قدیمی `audio_upload_rejected` بسته شده است.
- صفحهٔ Session progress برایش دکمهٔ «Retry failed attempt» نشان می‌دهد.
- این دکمه Run تازه می‌سازد. Run تازه با رزرو صوت صفر (D59) حالا آپلود را از روی دستگاه شروع می‌کند.

## ۲. کار ۱ — رگرسیون D59

**علت (تأییدشده در کد):** `beginTemporaryAudioUpload` شرط `!hold || hold.audio <= 0` را داشت. D59 برای صوتی که در همین دورهٔ سهمیه در کلاس دیگری پرداخت شده، رزرو صوت صفر می‌سازد. نتیجه: پاسخ 400 `validation_failed` با `reservation: ["confirmed_processing_required"]`.

**اصلاح:** [`packages/core/src/src/audio.ts`](../../packages/core/src/src/audio.ts)

- شرط به «رزرو باز همین کاربر» تبدیل شد (`reservationIsOpen`).
- route پیش از آن همچنان با `validateAudioUploadRun` ([`runs.ts`](../../packages/core/src/proc/runs.ts)) این موارد را می‌سنجد: مالکیت Run و جلسه، وضعیت `awaiting_upload`، یکی بودن شناسهٔ رزرو، و حضور منبع صوتی در snapshot.
- تأیید قطعه، لینک نوشتن و verify هم مثل قبل باز بودن رزرو را می‌سنجند.
- D29 تغییری نکرد: نسخهٔ سرور موقت است و پس از رونویسی حداکثر ۲۴ ساعت می‌ماند.

**بررسی جاهای دیگر با فرض رزرو صوت غیرصفر:**

- `activateProcessingRun` مقدار واقعی را با `chargeableRunAmounts` و پوشش پرداخت‌شده می‌سنجد. با رزرو صفر درست کار می‌کند (آزمون).
- `settleClassMaterial` (D59) فقط مطلب پرداخت‌نشده را کسر می‌کند.
- `legacyEntries` در `charged-material.ts` فقط Runهای قدیمی بی‌نشانگر را می‌خواند. ربطی به این مسیر ندارد.
- کلاینت (`uploadAutomaticAudio`، `ManualAudioManager`) مقدار رزرو را نمی‌خواند.
- `confirmedReservationAmounts` در quota دیگر مصرف‌کننده‌ای ندارد. حذفش نکردم تا تغییر بیرون از نیاز در `quota` نباشد.

**آزمون‌ها:**

- [`audio-charged-material.int.test.ts`](../../packages/core/src/proc/audio-charged-material.int.test.ts):
  - کلاس اول صوت را آپلود می‌کند و ۲ ثانیه کسر می‌شود.
  - کلاس دوم با همان checksum در همان دوره: رزرو `audio: 0`، شروع، `confirm_part`، تکمیل با job تأیید صوت، فعال‌سازی، رونویسی و انتشار (`ready`).
  - مصرف صوت تغییر نمی‌کند.
  - پیش از اصلاح همین آزمون در `audio.ts:89` شکست خورد.
  - رزرو ناشناخته همچنان رد می‌شود.
- مسیر کلاینت در [`manual-audio-manager.test.ts`](../../apps/web/src/ui/workspace/manual-audio-manager.test.ts): صف ذخیره‌شده با `uploadAutomaticAudio` واقعی Run را آپلود و فعال می‌کند (start، confirm_part، complete، activate).

## ۳. کار ۲ — تلاش دوبارهٔ بی‌نتیجه

**سرور:**

- `expireAwaitingUploads` ([`maintenance.ts`](../../packages/core/src/proc/maintenance.ts)) پیش‌تر هر Run منقضی را `audio_upload_rejected` می‌کرد. حالا با `temporaryAudioUploadStates` بر اساس رسیدهای آپلود همان رزرو تصمیم می‌گیرد:
  - `audio_upload_not_started`: هیچ آپلودی شروع نشده است.
  - `audio_upload_incomplete`: آپلود شروع شده، ولی تمام نشده است.
  - `audio_upload_rejected`: فقط برای رد واقعی توسط verifier، و مثل قبل برای Runی که منبع صوتی‌اش حذف شده است. در این حالت نمی‌شود گفت نسخهٔ اصلی روی دستگاه مانده است.
- نوع `AwaitingUploadFailure` در `runs.ts` این کدها را نام می‌برد.
- migration لازم نیست، چون ستون `last_error` فقط الگوی `^[a-z0-9_.]{1,64}$` را می‌خواهد.
- انتظار آزمون موجود `processing.int.test.ts` (انقضای Run بی‌آپلود) از `audio_upload_rejected` به `audio_upload_not_started` تغییر کرد. این همان رفتار اصلاح‌شده است، نه تضعیف آزمون.

**کلاینت:** [`upload-problems.ts`](../../apps/web/src/ui/workspace/upload-problems.ts)

| دلیل | منشأ | Retry |
|---|---|---|
| `upload_closed` | `validation_failed` با `confirmed_processing_required`، یا `conflict` (Run تمام شده، رزرو بسته یا مهلت گذشته) | ندارد. پیام: Processing را باز کن |
| `integrity_mismatch` | `idempotency_mismatch` (فایل دستگاه با manifest آپلود فرق دارد) یا checksum محلی متفاوت | ندارد |
| `original_missing` | فایل روی این دستگاه نیست | ندارد. متن موجود دستگاه دیگر را نام می‌برد |
| `audio_unsupported` | `unsupported_media` | ندارد |
| بی‌دلیل یا `unknown` | خطای دسته‌بندی‌نشده و ورودی‌های قدیمی | دارد، مثل قبل |

- `part_integrity_mismatch` عمداً retry دارد. قطعه‌ای که در انتقال خراب شده با لینک تازه دوباره فرستاده می‌شود و e2e موجود همین را می‌خواهد.
- خطاهای شبکه و 5xx مثل قبل خودکار تکرار می‌شوند.
- `ManualAudioTransfer.reason` در IndexedDB ذخیره می‌شود.
- `retry()` ورودی غیرقابل‌تکرار را به صف برنمی‌گرداند.
- دکمهٔ «Retry saved audio upload» فقط وقتی `audioUploadRetryable(reason)` درست باشد نمایش داده می‌شود.

**نمایش:**

- آنچه زبان‌آموز واقعاً می‌بیند پیام وضعیت خودکار سرور (`automaticLearningMessage`) در صفحهٔ Session progress است. برای دو کد تازه پیام مخصوص دارد و دکمهٔ موجود «Retry failed attempt» را نشان می‌دهد.
- مسیر: sweep آپلود Run را با کد تازه می‌بندد. سپس reconciler خودکار، که کلاس‌های `waiting_upload` را دوباره همگام می‌کند، وضعیت کلاس را `blocked` با همان کد می‌کند.
- **یافتهٔ جانبی:** `ProcessingView` در هیچ route استفاده نمی‌شود. `/sessions/{id}/processing` همان صفحهٔ estimate را برمی‌گرداند که `AutomaticLearningView` را نشان می‌دهد. متن «The audio could not be verified…» که سند ریشه‌یابی به `ProcessingView.tsx:366` نسبت داده، در رابط فعلی دیده نمی‌شود. کاربر پیام کلی «Automatic creation could not finish…» را دیده است.
- با این حال `ProcessingView` را هم‌راستا کردم: دو کد تازه پیام خودشان را دارند و دکمهٔ «Review and retry» را نشان می‌دهند. اگر این کامپوننت دوباره به کار برود، پیام نادرست برنمی‌گردد. تصمیم دربارهٔ حذف یا نگه‌داشتن آن با کار ناوبری است.
- در صف «Your audio uploads»، برای حالتی که دیگر ادامه پیدا نمی‌کند، جملهٔ موجود «…the saved original resumes when you return» پنهان می‌شود، چون درست نیست.
- برچسب دکمه‌ها همان برچسب‌های موجودند.

## ۴. کار ۳ — polling

[`automatic-learning-poll.ts`](../../apps/web/src/ui/workspace/automatic-learning-poll.ts) و `AutomaticLearningProvider.tsx`:

**چه کلاسی خوانده می‌شود:**

- هر کلاس یک بار در اولین دیدن.
- کلاس در جریان:
  - `waiting_sources`، `waiting_upload` و `processing`.
  - یا Run در `awaiting_upload`، `queued` یا `processing`.
- کلاسی که روی صفحه است.
- کلاسی که این دستگاه برایش کار دارد:
  - capture تمام‌شدهٔ همگام‌نشده.
  - یا صوت منتظر آپلود.

**backoff:**

- هر خواندن بی‌تغییر فاصله را دو برابر می‌کند. تغییر وضعیت دوباره از ۳ ثانیه شروع می‌کند.
- سقف فاصله:
  - ۶ ثانیه در انتظار فایل یا آپلود (کار ۵).
  - ۱۵ ثانیه در `processing`.
  - ۶۰ ثانیه برای بقیه.
- در صفحهٔ پنهان فقط کار دستگاه ادامه دارد.

**بیدار شدن:**

- `online`.
- نمایش دوبارهٔ صفحه.
- `recalino:learning-changed`؛ با `detail` فقط همان کلاس.
- تغییر phase ضبط. تیک‌های ساعت ضبط فقط kick می‌کنند و backoff را صفر نمی‌کنند.
- باز کردن صفحهٔ یک کلاس.

**صف صوت ذخیره‌شده:** وقتی انتقالی در جریان است هر ۳ ثانیه، وقتی همه منتظر کاربرند هر ۶۰ ثانیه. در صفحهٔ پنهان تایمر kick نمی‌کند.

**گزارش پیشرفت:** پیشرفت آپلود با callbackهای `onTransferProgress` و `onProgress` گزارش می‌شود، نه با polling. پس آپلود حین ضبط (D60) هم پیشرفتش را از دست نمی‌دهد.

**مسیرهای بازیابی:** همه با رخداد یا خواندن دوره‌ای کلاس فعال پوشش داده می‌شوند. این مسیرها: قطع و وصل شبکه، تب دیگر، انقضای سرور، Retry کاربر (وضعیت تازه با `acceptStatus` فوراً فعال حساب می‌شود) و تغییر از دستگاه دیگر هنگام باز کردن کلاس. آزمون: [`automatic-learning-poll.test.ts`](../../apps/web/src/ui/workspace/automatic-learning-poll.test.ts). شبیه‌سازی ۷ کلاس بی‌کار در ۲ ساعت ۷ درخواست می‌فرستد. پیش‌تر حدود ۳۱۰۰ درخواست ثبت شده بود.

## ۵. کار ۴ — انتقال موازی

`uploadAutomaticAudio` ([`automatic-learning.ts`](../../apps/web/src/ui/workspace/automatic-learning.ts)):

- `AUDIO_SOURCE_CONCURRENCY = 2` فایل هم‌زمان.
- `AUDIO_FILE_PART_CONCURRENCY = 3` قطعه برای هر فایل، مثل قبل.
- `AUDIO_PART_CONCURRENCY = 4` قطعهٔ هم‌زمان در کل، با `uploadSlots` در [`upload-concurrency.ts`](../../apps/web/src/ui/workspace/upload-concurrency.ts).
- چیزهایی که مثل قبل ماندند:
  - checksum هر فایل.
  - ادامه از قطعه‌های تأییدشده.
  - کلیدهای idempotent `audio-start` و `audio-complete`.
  - پیشرفت جدای هر فایل.
- رابط تابع تغییر نکرد و در توضیحش برای استفادهٔ کار ضبط (D60) مستند شد.
- آزمون: سه فایل، اوج هم‌زمانی بیش از ۱ و حداکثر ۴، یک start و یک complete برای هر فایل، و پیشرفت نهایی هر فایل.

## ۶. کار ۵ — زودترین شروع مجاز

- برای فایل انتخاب‌شده، سرور Run را پس از بسته شدن گروه فایل‌ها می‌سازد. این همان لحظهٔ مجوز پردازش است (قاعدهٔ ۲ D29).
- تا پیش از آن، `src.audio_upload` رزروی برای اتصال ندارد.
- کلاینت پس از ثبت گروه، `recalino:learning-changed` می‌فرستد و polling بیدار می‌شود. با سقف ۶ ثانیه، آپلود حداکثر چند ثانیه پس از ساخت Run شروع می‌شود.
- شروع زودتر، یعنی هم‌زمان با تأیید عکس‌ها و PDFهای همان گروه، Run یا رزرو را پیش از بسته شدن گروه لازم دارد. این تغییر قاعدهٔ مجوز است و به تصمیم نیاز دارد (پرسش ۲).
- hash دوبارهٔ فایل پیش از آپلود (`prepareFileHashes`) برای سنجش برابری با snapshot لازم است و حذفش نکردم.

## ۷. کار ۶ — زمان مراحل (NFR-07)

[`ops/stage-timings.ts`](../../packages/core/src/ops/stage-timings.ts) (خواندن از راه توابع `classRunTimes` در proc، `audioUploadWindows` در src و `voiceAnalysisTimes` در voc، طبق ADR-0002 قاعدهٔ ۴) و [`timings.ts`](../../packages/ops-cli/src/timings.ts):

```
DATABASE_URL=... pnpm --filter @recalino/ops-cli timings -- --since 2026-10-06 [--until …] [--runs] [--env <file>]
```

- همه چیز در یک تراکنش `read only` اجرا می‌شود.
- خروجی فقط شناسه، وضعیت و زمان است.
- مرزهای مراحل:
  - `upload_wait` و `upload_transfer`: از `src.audio_upload`.
  - `queue`.
  - `transcription`، `board_photos` و `lesson`: از `proc.provider_attempt` با پیشوندهای `stt:`، `vision:` و `knowledge`.
  - `voice`: از `voc.analysis`.
  - `publication` و `total`.

**نتیجهٔ production** (Runهای کلاس از 2026-10-06؛ فقط `select` روی پروژهٔ `twowhuzhvyuzjrpraikm`؛ ثانیه):

| مرحله | n | p50 | p95 |
|---|---:|---:|---:|
| upload_wait | 5 | 4 | 9 |
| upload_transfer | 5 | 125 | 664 |
| transcription | 5 | 283 | 2664 |
| board_photos | 5 | 56 | 1747 |
| lesson | 22 | 40 | 106 |
| publication | 6 | 0 | 1 |
| total (ready/partial) | 7 | 71 | 10810 |

**محدودیت‌های داده:**

- نمونه کوچک است.
- p95 رونویسی و عکس شامل تلاش‌های دوباره در ساعت‌های بعد است.
- پایان `voice` از `voc.analysis.updated_at` می‌آید. اقدام بعدی کاربر (تأیید صدا) این زمان را جابه‌جا می‌کند و p95 آن معنا ندارد. اندازهٔ دقیق به ثبت زمان پایان تحلیل نیاز دارد. این کار در مالکیت کار صدا و worker است.
- فاصله‌های پیش‌زمینهٔ کلاینت از داده‌های موجود بدون ثبت تازه به دست نمی‌آید. تشخیص visibility در کار ضبط (0.2) اضافه می‌شود.

## ۸. پرچم‌ها و پیش‌فرض‌ها

پرچم تازه‌ای اضافه نشد. همهٔ تغییرها اصلاح خطا یا اجرای رفتار مصوب‌اند. ثابت‌های قابل تنظیم در کد:

| ثابت | مقدار |
|---|---|
| `LEARNING_POLL.baseMs` | 3000 |
| `LEARNING_POLL.startMs` | 6000 |
| `LEARNING_POLL.processingMs` | 15000 |
| `LEARNING_POLL.maxMs` | 60000 |
| `AUDIO_SOURCE_CONCURRENCY` | 2 |
| `AUDIO_FILE_PART_CONCURRENCY` | 3 |
| `AUDIO_PART_CONCURRENCY` | 4 |

## ۹. متن‌های تازه (در انتظار تأیید، D65)

پنج متن در [`UI_COPY_PENDING.md`](../design/UI_COPY_PENDING.md)، بخش «کار ۱ — پایداری آپلود»، و در `pendingCopy.uploadReliability` آمده‌اند. هیچ‌کدام تأییدشده علامت نخورده‌اند.

## ۹-الف. رابط پایدار برای کارهای دیگر

**ناوبری** (`feat/session-navigation`): این‌ها export پایدارند و resolver «گام بعد» می‌تواند با آن‌ها تصمیم بگیرد که Retry ممکن است یا نه.

- از [`upload-problems.ts`](../../apps/web/src/ui/workspace/upload-problems.ts):
  - نوع `AudioUploadReason`.
  - کلاس `AudioUploadProblem` با فیلد `reason`.
  - `audioUploadProblem(failure)` برای دسته‌بندی خطای سرور.
  - `audioUploadRetryable(reason)`.
- فیلد `ManualAudioTransfer.reason` در `manual-audio-store.ts`.
- کدهای سرور `audio_upload_not_started` و `audio_upload_incomplete` در `lastError` وضعیت کلاس.

**ضبط** (`feat/recording-capture`، D60):

- `uploadAutomaticAudio(run, snapshot, contract, options)` بدون تغییر امضا مستقیم قابل فراخوانی است.
- پیشرفت با `onTransferProgress` و `onProgress` گزارش می‌شود و به polling وابسته نیست.
- تایمرهای polling و صف صوت ذخیره‌شده در صفحهٔ پنهان kick نمی‌کنند. صفحه هنگام ضبط روی گوشی ممکن است پنهان باشد. پس آپلود حین ضبط باید مستقیم با `uploadAutomaticAudio` یا با driver خود کار ضبط اجرا شود، نه با این تایمرها.
- `ManualAudioManager` حین ضبط عمداً متوقف است، چون `allowed()` برای phaseهای ضبط false برمی‌گرداند.
- اگر کار ضبط برای هر بخش مهر و موم‌شده رخداد `recalino:learning-changed` با `detail` همان کلاس بفرستد، polling همان کلاس فوراً بیدار می‌شود.

**تعارض شناخته‌شده در `AutomaticLearningProvider.tsx`:**

- `feat/session-navigation` دکمهٔ «Retry saved audio upload» را از صف حذف می‌کند و این اقدام را به صفحهٔ جلسه می‌برد. در ادغام، حذف برنده است (یادداشت مدیر).
- تغییر من در همان بلوک (شرط `audioUploadRetryable` برای دکمه و برای جملهٔ «…resumes when you return») با حذف دکمه بی‌اثر می‌شود.
- اگر جملهٔ راهنما در صف بماند، بهتر است همان شرط را نگه دارد.
- بقیهٔ تغییرهای این فایل (polling) در بلوک‌های دیگرند.

## ۱۰. فایل‌های بیرون از مالکیت

- `packages/core/src/proc/maintenance.ts`، `runs.ts` (فقط نوع `AwaitingUploadFailure`) و `index.ts` (export). کار ۲ به آن‌ها نیاز داشت.
- `packages/core/src/proc/processing.int.test.ts`: یک انتظار.
- `apps/web/src/server/automatic-learning.ts`: دو پیام.
- `apps/web/src/ui/pending-copy.ts` و `docs/design/UI_COPY_PENDING.md`: احتمال تعارض با کارهای دیگر که متن pending اضافه می‌کنند. ادغام ساده است: کلیدها در شاخهٔ جدای `uploadReliability` هستند و بخش سند جداست.
- `ProcessingView.tsx`: فقط متن خطای صوت و برچسب دکمهٔ موجود.
- به `worker.ts` دست نزدم.

## ۱۱. آزمون و شواهد

GitHub Actions از حدود 22:16 UTC در کل مخزن job را شروع نمی‌کند. به درخواست مدیر، شواهد CI از اجرای کامل محلی روی commit نهایی همین شاخه آمده است (پس از ادغام `origin/main @ 4ad3391`). محیط: Node 24.21.0، pnpm 12.4.2، Supabase محلی و فقط دادهٔ مصنوعی.

| دستور | خط خلاصه |
|---|---|
| `pnpm verify` → `pnpm lint` | `Checked 1118 files in 1591ms. No fixes applied.` |
| `pnpm verify` → `pnpm typecheck` | `packages/core typecheck: Done`، `apps/web typecheck: Done`، `packages/ops-cli typecheck: Done` |
| `pnpm verify` → `pnpm check:boundaries` | `✔ no dependency violations found (1198 modules, 5458 dependencies cruised)` |
| `pnpm verify` → `pnpm test` (unit و integration) | `Test Files  320 passed \| 1 skipped (321)`؛ `Tests  3906 passed \| 1 skipped (3907)` |
| `pnpm build` (با `RECALINO_DEV_UI=1`) | موفق (exit 0) |
| `CI=1 pnpm test:e2e` (build تولیدی، مهلت ۵ ثانیه، مثل CI) | `268 passed (5.0m)`، بدون flaky |

**بازتولید پیش از اصلاح:** آزمون D59 در `audio-charged-material.int.test.ts` پیش از اصلاح در `audio.ts:89` با `validation_failed` شکست خورد و پس از اصلاح موفق شد.

**آزمون‌های تازه:**

- `packages/core/src/proc/audio-charged-material.int.test.ts`: سه آزمون؛ D59 سرتاسری، رزرو ناشناخته، کدهای انقضا.
- `packages/core/src/proc/maintenance.test.ts`.
- `packages/core/src/ops/stage-timings.test.ts` و `stage-timings.int.test.ts`.
- `apps/web/src/ui/workspace/upload-problems.test.ts`.
- `apps/web/src/ui/workspace/automatic-learning-poll.test.ts`.
- `apps/web/e2e/upload-reliability.spec.ts`.
- آزمون‌های افزوده در `automatic-learning.test.ts` (D59، انتقال موازی)، `manual-audio-manager.test.ts` (مسیر کلاینت D59، Retry)، `ProcessingView.test.ts` و `automatic-learning-message.test.ts`.

**تصویرها (D65)** در `artifacts/verification/feat-upload-reliability/`، با `RECALINO_SCREENSHOTS=1` از همان e2e:

- `session-progress-upload-not-started-390.png` و `-1440.png`: Session progress برای آپلودی که شروع نشد.
- `audio-tray-upload-closed-390.png` و `-1440.png`: صف «Your audio uploads» برای آپلود بسته‌شده، بدون Retry.
- `.gitignore` پوشهٔ `artifacts/verification/*` را نادیده می‌گیرد. این چهار فایل با `git add -f` ثبت شدند. `.gitignore` را تغییر ندادم تا با کارهای دیگر تعارض نسازد.

**CI در GitHub Actions:**

- Run [`38315163237`](https://github.com/Ali-Paybarjay/recalino/actions/runs/38315163237) پیش از قطعی خطای واقعی قاعدهٔ ADR-0002 را نشان داد. اصلاح شد (`dd068c5`).
- از حدود 22:16 UTC همهٔ jobهای مخزن در همهٔ شاخه‌ها در ۲ تا ۳۰ ثانیه، بی‌آنکه runner بگیرند، شکست می‌خورند (`runner_id: 0`، بدون لاگ). مدیر تأیید کرده که مشکل از حساب است و مالک در حال رفع آن است.

**ادغام hotfix:** شاخهٔ `feat/hotfix-d59-audio-start` (PR #44) هنوز در `main` ادغام نشده است. پس از ادغام، فقط فایل `packages/core/src/proc/audio-charged-material.int.test.ts` تعارض می‌دهد. نسخهٔ این شاخه را نگه دارید، چون کامل‌تر است. تغییر `audio.ts` در هر دو یکی است.

**نکتهٔ محیط e2e محلی:** shell این محیط کلید `SUPABASE_SECRET_KEY` ابری و `NEXT_PUBLIC_SUPABASE_*` را export می‌کند. چون Next.js مقدار موجود را با `.env.local` عوض نمی‌کند، سرور محلی کلید ابری را به Auth محلی فرستاد و ورود آزمایشی 500 داد. چیزی به پروژهٔ ابری نرسید، چون `SUPABASE_URL` محلی بود. e2e را با `env -u` برای این متغیرها اجرا کردم.

**آزمون ناپایدار موجود:** `automatic-learning.spec.ts:510` یک بار پیش از تلاش دوم شکست خورد. خود آزمون IndexedDB را بدون `onupgradeneeded` باز می‌کند و به باز شدن پایگاه توسط اپ وابسته است. در اجرای نهایی موفق بود.

## ۱۲. پرسش‌ها برای مالک محصول

1. متن پنج پیام بخش ۹ (D65: بازبینی یک‌جا در پایان).
2. آیا آپلود صوت فایل انتخاب‌شده می‌تواند پیش از بسته شدن گروه فایل‌ها، یعنی هم‌زمان با تأیید عکس‌ها و PDFها، شروع شود؟ این کار مجوز پردازش (Run و رزرو) را به لحظهٔ ثبت فایل صوتی جلو می‌برد.
3. ثبت زمان پایان تحلیل صدا و فاصله‌های پیش‌زمینهٔ کلاینت برای NFR-07 (بخش ۷)، هماهنگ با کار صدا و ضبط.

## ممیزی دوم (2026-10-13)

به درخواست مالک، دور دوم با این فرض انجام شد که مشکل ۱ («آپلود صوت طول می‌کشد و بیشتر شکست می‌خورد») حل نشده است، مگر اینکه هر شاهد آن با آزمون یا دستوری اثبات شود. مبنا: `feat/upload-reliability` پس از ادغام نسخهٔ منتشرشده (`main @ 40dda8f`، D60 تا D66). همهٔ آزمون‌ها با دادهٔ مصنوعی، Supabase محلی، فروشگاه آزمون (`MemoryObjectStore`، FR-PLT-014 قاعدهٔ ۲)، provider مصنوعی و decoder مصنوعی اجرا شده‌اند؛ routeها، جدول‌ها، jobها و سرویس یادگیری خودکار واقعی‌اند.

### شواهد مشکل ۱

| شاهد در سند ریشه‌یابی | وضعیت | اثبات |
|---|---|---|
| ۱۷ پاسخ HTTP 400 روی `POST /api/sources/{id}/audio` | حل شد | `audio-upload-audit.int.test.ts` › «class B with class A's paid audio (hold audio=0) uploads through ManualAudioManager…»: کلاس دوم با رزرو صوت صفر از خود route شروع، قطعه، تکمیل، تأیید، رونویسی و انتشار را می‌گذراند و به `ready` می‌رسد. هر 400 باقی‌مانده در همان فایل برای درخواست واقعاً نامعتبر است (فهرست پایین) |
| Runهای `c8f92d7e` و `fbc79e72` ۲۴ ساعت گیر کردند | حل شد | `audio-retry-audit.int.test.ts` › شکل (الف): همان وضعیت production (`needs_input` با `audio_upload_rejected`، کلاس خودکار `blocked`، بدون ردیف آپلود) بدون هیچ ویرایش دیتابیس به‌صورت «شروع نشده» خوانده می‌شود، «Retry failed attempt» Run تازه با `audio: 0` می‌سازد، دستگاه آپلود می‌کند و کلاس `ready` می‌شود |
| رزرو `audio = 0` رد می‌شد | حل شد | همان دو آزمون بالا و `packages/core/src/proc/audio-charged-material.int.test.ts` (پیش از اصلاح در `audio.ts:89` شکست می‌خورد) |
| دکمهٔ بی‌نتیجهٔ «Retry saved audio upload» | حل شد | دکمه در نسخهٔ منتشرشده از صف حذف شده است (کار ناوبری). resolver صفحهٔ جلسه فقط وقتی `uploadRetryCanHelp` درست باشد `retry_upload` می‌دهد؛ `audio-dead-ends.test.ts` برابری آن با `audioUploadRetryable` را برای هر `AudioUploadReason` می‌سنجد؛ `upload-problems.test.ts` و `manual-audio-manager.test.ts` دسته‌بندی و ذخیرهٔ دلیل را |
| پیام «could not be verified» پس از انقضا | حل شد | `audio-retry-audit.int.test.ts` و `audio-dead-ends.test.ts`: آپلود شروع‌نشده و نیمه‌تمام متن خودشان را دارند، و رد واقعی verifier دیگر Retry تکرارشونده ندارد (به «Review material» می‌رود). `ProcessingView` در هیچ route سوار نیست |
| حدود ۳٬۱۰۰ درخواست polling در ۲ ساعت | حل شد | `automatic-learning-loop.test.ts` › «reads seven idle classes with saved audio once in two hours»: ۷ خواندن در ۲ ساعت با تایمر جعلی روی خود حلقهٔ provider |
| انتقال پشت‌سرهم منبع‌های صوتی | حل شد | `automatic-learning.test.ts` (دو فایل هم‌زمان، سقف قطعه‌ها) و اندازه‌گیری `audio-upload-speed.int.test.ts` (جدول پایین) |
| ۲۸ دقیقه از Stop تا جزوه، با ۱۱ دقیقه اپ غیرفعال | در این کار حل نشد | ۱۱ دقیقهٔ غیرفعال بودن اپ، محدودیت وب است (D47) و با آپلود حین ضبط (D60، در نسخهٔ منتشرشده) کوتاه می‌شود، نه با این شاخه. آنچه این شاخه اثبات می‌کند: شروع آپلود حداکثر ۶ ثانیه پس از ساخت Run (`automatic-learning-loop.test.ts`) و در اندازه‌گیری ۳۲۵ تا ۵۳۸ میلی‌ثانیه؛ زمان مراحل بعدی با `ops-cli timings` سنجیده می‌شود |

### بندهای ۱ تا ۸

**۱. D59 سرتاسری از route واقعی.** `apps/web/src/server/audio-upload-audit.int.test.ts` با `audio-audit-support.ts`: `fetch` به `defineRoute` وصل است، پس احراز هویت، same-origin، تجزیهٔ بدنه و پاسخ خطا همان production هستند. مسیر: `ManualAudioManager.enqueue` → `GET /api/runs/{id}?includeSnapshot=1` → `start` → `confirm_part` → `complete` → job `src.verify_audio` (از ردیف واقعی `plt.job`) → `activateProcessingRun` → job پردازش با `finalizeAutomaticRun` → `ready`. دقیقاً یک ردیف `src.audio_upload` برای هر منبع؛ مصرف صوت پس از کلاس دوم بدون تغییر (۴ ثانیه). حالت‌های منفی: رزرو کاربر دیگر (400 از route و 400 از تابع هسته)، رزرو بسته (Run لغوشده: 400 و 400)، Run بیرون از `awaiting_upload` (400)، منبع بیرون از snapshot (400)، منبع و Run کاربر دیگر (404).

**۲. شاخه‌های رد در مسیر start، part و complete.** هر شاخه در همان فایل آزمون دارد:

| شاخه | پاسخ | رسیدن کلاینت سالم به آن |
|---|---|---|
| بدنهٔ نامعتبر، Run ناشناخته | 400، 404 | خیر |
| `validateAudioUploadRun` (وضعیت Run، رزرو، منبع) | 400 `audio: confirmed_processing_required` | بله، فقط وقتی Run تمام یا منقضی شده است؛ کلاینت آن را `upload_closed` می‌نامد و Retry نمی‌دهد |
| `storage: unavailable`، `verifier_unavailable` | 400 | فقط با پیکربندی سرور بدون فروشگاه فایل (پرسش ۲) |
| `parts: invalid_manifest` (۴ گونه) | 400 | فقط اگر اپراتور `partBytes` قرارداد را بین ساخت منبع و آپلود عوض کند (پرسش ۱) |
| manifest متفاوت برای همان رزرو | 422 `idempotency_mismatch` | فقط اگر فایل دستگاه عوض شده باشد؛ کلاینت `integrity_mismatch` بدون Retry |
| نسخهٔ اصلی حذف‌شده | 409 | بله، پس از حذف منبع؛ `upload_closed` |
| لینک قطعه: آپلود تأییدشده یا منقضی | 409 | بله؛ برای تأییدشده کلاینت اول manifest را می‌خواند و رد می‌شود، برای منقضی `upload_closed` |
| شمارهٔ قطعه خارج از محدوده | 404 | خیر |
| `confirm_part` پیش از PUT | 200 `{confirmed:false}` | بله، رفتار عادی |
| `part_integrity_mismatch` | 400 | بله، خرابی در انتقال؛ کلاینت با لینک تازه دوباره می‌فرستد (آزمون همان را انجام می‌دهد) |
| تکمیل نسخهٔ staged (D60) از این route | 400 | خیر |
| تکمیل دوباره | 202 با `jobId: null` | بله؛ job دوم ساخته نمی‌شود |
| آپلود کاربر دیگر | 404 | خیر |

**۳. Retry برای دو شکل گیرکرده.** `audio-retry-audit.int.test.ts`: (الف) وضعیت به‌جامانده از کد قدیمی؛ (ب) Run با آپلود شروع‌نشده و سپس نیمه‌تمام که sweep با کد تازه می‌بندد و reconciler روی کلاس ثبت می‌کند. در هر دو، `POST /api/classes/{id}/learning` با `action: "retry"` از route واقعی Run تازه با `audio: 0` می‌سازد، آپلود از مسیر کلاینت انجام می‌شود و کلاس `ready` می‌شود؛ مصرف صوت ثابت می‌ماند. اصلاح لازم: در `view()` سرور، `audio_upload_rejected`ِ به‌جامانده که هیچ رسید آپلودی ندارد، فقط هنگام خواندن (بدون نوشتن) به‌صورت `audio_upload_not_started` ارائه می‌شود. شروع آپلود در پنجرهٔ ۶ ثانیه: `automatic-learning-loop.test.ts` › «starts the device upload within the 6 s cap of the run being created».

**۴. بن‌بست‌ها.** `audio-dead-ends.test.ts`: برای هر `AudioUploadReason` (و بدون دلیل) صف و resolver در ارائهٔ Retry هم‌نظرند و اقدام اصلی `retry_upload` یا `review_material` است؛ برای کدهای `audio_upload_rejected`، `audio_upload_not_started`، `audio_upload_incomplete`، `new_confirmation_required`، `upload_needs_attention` و `upload_batch_cancelled` متن (مصوب یا pending)، نوع بازیابی و اقدام اصلی صفحهٔ جلسه سنجیده می‌شوند. یافتهٔ این دور: `audio_upload_rejected` (رد واقعی verifier) «Retry failed attempt» داشت که با همان فایل دوباره در همان نقطه متوقف می‌شد؛ حالا بازیابی از نوع «material» است، بدون Retry، با متن تازهٔ `uploadReliability.automatic.rejected` (در انتظار تأیید).

**۵. سرعت.** `audio-upload-speed.int.test.ts` روی routeها و جدول‌های واقعی؛ PUT به فروشگاه آزمون در همان فرایند می‌رسد، پس عددها hashing، رفت‌وبرگشت route، ثبت قطعه‌ها و خط لولهٔ کلاینت را می‌سنجند، نه شبکه را. با `RECALINO_MEASURE=1` (شکل ۱۲۸ دقیقه: ۶ قطعهٔ ۸ مگابایتی):

| اندازه‌گیری | عدد |
|---|---|
| ساخت Run تا اولین ردیف آپلود (`src.audio_upload.created_at − run.created_at`) | ۳۲۵ میلی‌ثانیه (۴۸ مگابایت)، ۵۳۸ میلی‌ثانیه (۱۶ مگابایت)؛ سقف طراحی ۶ ثانیه |
| ۶ فایل × ۸ مگابایت، دو فایل هم‌زمان (کد فعلی) | ۱٬۱۴۶ میلی‌ثانیه |
| همان ۶ فایل، یکی پس از دیگری (رفتار پیش از 2026-10-12) | ۱٬۴۹۳ میلی‌ثانیه |
| ادامه پس از قطع وسط قطعه (یک فایل ۶ قطعه‌ای) | همان `uploadId`، فقط قطعهٔ قطع‌شده دوباره فرستاده می‌شود، ۶ PUT در کل، بدون ردیف تکراری، ۹۷۳ میلی‌ثانیه |

با PUT در حافظه، سود هم‌زمانی کوچک است؛ روی شبکهٔ واقعی تفاوت بزرگ‌تر است، چون زمان انتقال غالب می‌شود. اوج قطعه‌های هم‌زمان در این اندازه‌گیری ۱ بود (هر PUT در حافظه بی‌درنگ تمام می‌شود)؛ سقف ۴ در `automatic-learning.test.ts` با gate اثبات می‌شود.

**۶. polling.** حلقهٔ provider به [`automatic-learning-loop.ts`](../../apps/web/src/ui/workspace/automatic-learning-loop.ts) منتقل شد (بدون تغییر رفتار؛ provider فقط آن را سیم‌کشی می‌کند) تا با تایمر جعلی سنجیده شود. `automatic-learning-loop.test.ts`: ۷ کلاس بی‌کار در ۲ ساعت → ۷ خواندن؛ صفحهٔ پنهان → هیچ خواندنی جز کار دستگاه، و خواندن فوری پس از نمایش؛ `online`، `learning-changed`، تغییر phase ضبط و باز کردن کلاس → خواندن فوری؛ کلاس در `processing` → سقف ۱۵ ثانیه؛ خطای شبکه در آپلود → تلاش دوباره در بازدید بعدی، و ردّی که سرور تکرار می‌کند → فقط یک بار.

**۷. ثابت‌ها.** مالکیت: در `audio-upload-audit.int.test.ts` کاربر دیگر برای start، complete و manifest پاسخ 404 می‌گیرد (و `sourceCrossAccount("sourceAudio")` موجود). idempotency: تکرار کامل انتقال با همان کلاینت یک ردیف آپلود، یک قطعه و یک job می‌سازد. D29: پس از رونویسی `transcribed_at` ثبت و `expires_at` حداکثر ۲۴ ساعت بعد است (حذف واقعی در `audio-expiry.int.test.ts:161`)؛ نسخهٔ ردشده بلافاصله منقضی می‌شود. لاگ: این شاخه هیچ خط لاگی اضافه نکرده است (`git diff 43f12a9..HEAD | grep` برای `console.`/`log(`: خالی). `expireAwaitingUploads` هرگز کسر نمی‌کند (مصرف ثابت، رزرو صفر).

**۸. تأیید کامل محلی روی commit نهایی.**

روی commit نهایی این دور (پس از ادغام `main @ 40dda8f`)، با `env -u` برای متغیرهای ابری Supabase:

| دستور | خط خلاصه |
|---|---|
| `pnpm verify` → `pnpm lint` | `Checked 1199 files in 2s. No fixes applied.` |
| `pnpm verify` → `pnpm typecheck` | `packages/core typecheck: Done`، `packages/ops-cli typecheck: Done`، `apps/web typecheck: Done` |
| `pnpm verify` → `pnpm check:boundaries` | `✔ no dependency violations found (1278 modules, 5946 dependencies cruised)` |
| `pnpm verify` → `pnpm test` (unit و integration) | `Test Files  356 passed \| 1 skipped (357)`؛ `Tests  4151 passed \| 1 skipped (4152)` |
| `pnpm build` (با `RECALINO_DEV_UI=1`) | موفق (exit 0) |
| `CI=1 pnpm test:e2e` (اجرای کامل) | `272 passed (9.3m)`، ۲ شکست در `session-navigation.spec.ts` و ۲ ناپایدار که در تلاش دوم گذشتند |
| اجرای دوبارهٔ `session-navigation`، `session-notes-reader`، `study` و `upload-reliability` پس از اصلاح | `34 passed (1.7m)`، بدون شکست و بدون مورد ناپایدار (روی همان build تولیدی) |

دو شکست e2e از fixture صفحهٔ مرجع `/dev/ui/session` بود که حالت «audio-not-received» را هنوز با کد `audio_upload_rejected` می‌ساخت؛ با قاعدهٔ تازه این حالت `audio_upload_not_started` است. fixture اصلاح شد (`SessionReference.tsx`)؛ انتظارهای آزمون تغییر نکردند. دو مورد ناپایدار (`session-notes-reader` در ۳۹۰ پیکسل و `study` tablet) مهلت ۵ ثانیهٔ CI زیر بار کامل بودند و ربطی به این شاخه ندارند.

### اصلاح‌های این دور

- `apps/web/src/server/automatic-learning.ts`: ارائهٔ `audio_upload_not_started` برای `audio_upload_rejected`ِ به‌جامانده بدون رسید آپلود؛ پیام `audio_upload_rejected`.
- `apps/web/src/ui/workspace/automatic-learning-recovery.ts`: `audio_upload_rejected` از نوع material.
- `apps/web/src/ui/workspace/session-state.ts` (مالک: ناوبری؛ ویرایش کوچک): شاخهٔ «did not reach Recalino» به کدهای `audio_upload_not_started` و `audio_upload_incomplete` منتقل شد؛ آزمونش به همین شکل.
- `apps/web/src/ui/workspace/automatic-learning-loop.ts` (تازه) و `AutomaticLearningProvider.tsx`: جداسازی حلقه برای آزمون.
- `apps/web/src/ui/pending-copy.ts` و `docs/design/UI_COPY_PENDING.md`: متن `uploadReliability.automatic.rejected`.
- پرچم یا تصمیم تازه‌ای نیست.

### پرسش‌های تازه برای مالک

1. اگر اپراتور `partBytes` قرارداد ورودی را عوض کند، منبع‌های ساخته‌شده با قرارداد قبلی در شروع آپلود `invalid_manifest` می‌گیرند، چون کلاینت قرارداد جاری را می‌خواند و سرور قرارداد ثبت‌شدهٔ منبع را. امروز رخ نمی‌دهد (یک نسخه قرارداد). پیشنهاد: سرور قطعه‌بندی با قرارداد جاری را هم بپذیرد، یا کلاینت `partBytes` قرارداد ثبت‌شدهٔ منبع را بخواند.
2. `storage: unavailable` و `verifier_unavailable` با 400 برمی‌گردند، در حالی که خرابی پیکربندی سرورند. کلاینت آن‌ها را خطای ورودی می‌خواند. پیشنهاد: کد پاسخ از جنس سرویس (`internal`/503) تا تلاش خودکار و پیام درست انجام شود.
3. متن `uploadReliability.automatic.rejected` (در انتظار تأیید، D65).

## پیگیری تصمیم‌های مالک محصول (2026-10-13، D71)

مرجع: تصمیم مالک محصول 2026-10-13 (D71)، رسیده از راه مدیر. هر مورد با آزمونِ ابتدا شکست‌خورده پیاده شد.

| مورد | تصمیم | پیاده‌سازی |
|---|---|---|
| متن‌های `uploadReliability.*` | هر شش متن تأیید شد؛ PR مدیر آن‌ها را به `apps/web/src/ui/workspace/upload-copy.ts` (`uploadCopy`) می‌برد | تا لحظهٔ push این فایل روی `main` نبود (`main @ ea95dbc`)؛ مصرف‌کننده‌ها هنوز `pendingCopy.uploadReliability` را می‌خوانند و با ورود PR مدیر جابه‌جا می‌شوند |
| آپلود صوت پیش از بسته شدن گروه فایل | مجاز نیست | تغییری نشد |
| ثبت زمان پایان تحلیل صدا و فاصله‌های پیش‌زمینهٔ کلاینت برای NFR-07 | تأیید | زیر |
| پذیرش قطعه‌بندی قرارداد جاری برای منبعِ قرارداد قدیمی‌تر | تأیید | زیر |
| `storage: unavailable` و `verifier_unavailable` با وضعیت 503 | تأیید | زیر |

### (۳) زمان مراحل: پایان تحلیل صدا و فاصله‌های پیش‌زمینه

- migration تازه [`20261013120000_nfr07_stage_times.sql`](../../supabase/migrations/20261013120000_nfr07_stage_times.sql): دو ستون `analysis_started_at` و `analysis_finished_at` روی `voc.analysis`، و جدول `proc.foreground_gap` (`user_id`، `session_id`، `hidden_at`، `visible_at`؛ یکتا روی `(user_id, session_id, hidden_at)`؛ RLS و grant مثل الگوی `proc.automatic_session`). `packages/core/src/db/types.ts` با `pnpm db:types` بازتولید شد. فقط زمان و شناسه؛ هیچ متن یا صدای کلاس (PRD-PRIV-06).
- صدا: `processVoiceSource` زمان شروع را در ورودی تحلیل می‌گذارد (`VoiceAnalysisInput.startedAt`)، `saveVoiceAnalysis` آن را با زمان ذخیره در دو ستون تازه می‌نویسد و هیچ به‌روزرسانی بعدی (تأیید صدا) آن‌ها را جابه‌جا نمی‌کند. `voiceAnalysisTimes` اکنون با `run_id` می‌خواند، نه با پنجرهٔ زمانی کلاس. تحلیل‌های ذخیره‌شده پیش از این ستون‌ها مرحلهٔ `voice` را اندازه‌گیری‌نشده می‌گذارند، نه صفر.
- فاصله‌های پیش‌زمینه: حلقهٔ کلاینت ([`automatic-learning-loop.ts`](../../apps/web/src/ui/workspace/automatic-learning-loop.ts)) زمان پنهان شدن صفحه را نگه می‌دارد و هنگام نمایش دوباره، برای هر کلاسی که در `waiting_upload` یا `processing` است، یک `POST /api/classes/[id]/learning` با `action: "foreground_gap"` می‌فرستد (فاصله‌های زیر ۱ ثانیه فرستاده نمی‌شوند؛ خطای این گزارش هرگز کار یادگیرنده را متوقف نمی‌کند). سرور (`recordForegroundGap` در `packages/core/src/proc/foreground-gaps.ts`) مالکیت کلاس را بررسی می‌کند، بازهٔ بیش از ۷ روز، شروع قدیمی‌تر از ۷ روز یا پایان در آینده (بیش از ۵ دقیقه) را با `gap: out_of_range` رد می‌کند و تکرار همان بازه را بی‌اثر می‌گذارد (`recorded: false`).
- گزارش: مرحلهٔ تازهٔ `device_hidden` در `pnpm --filter @recalino/ops-cli timings`: مجموع ثانیه‌های پنهان‌بودن گزارش‌شده که داخل `[created_at, finished_at)` اجرا می‌افتد (اجرای ناتمام تا بی‌نهایت). صفر یعنی دستگاهی گزارشی نداده است.
- آزمون‌ها: `packages/core/src/voc/analysis.int.test.ts` (ثبت و ثبات زمان‌ها)، `packages/core/src/ops/stage-timings.test.ts` (هم‌پوشانی بازه‌ها)، `apps/web/src/ui/workspace/automatic-learning-loop.test.ts` (یک گزارش برای هر کلاس در حال کار، نه برای کلاس آماده و نه برای جابه‌جایی کوتاه)، `apps/web/src/server/foreground-gaps.int.test.ts` (مسیر واقعی، مالکیت، idempotency، کران‌ها و ورود به گزارش).

### (۴) قطعه‌بندی قرارداد جاری برای منبع قدیمی‌تر

`beginTemporaryAudioUpload` ([`src/audio.ts`](../../packages/core/src/src/audio.ts)) قرارداد ثبت‌شدهٔ منبع و قرارداد فعال را می‌خواند و manifest را می‌پذیرد اگر با `partBytes` هر یک سازگار باشد؛ مجموع اندازه‌ها همچنان باید با منبع برابر باشد و manifest ناسازگار با هر دو همان `invalid_manifest` را می‌گیرد. TTL آپلود از قرارداد ثبت‌شدهٔ منبع می‌ماند. آزمون: `audio-upload-audit.int.test.ts` («accepts the part layout of the current contract…») با یک نسخهٔ قرارداد غیرفعال و `partBytes: 2`، بدون دست زدن به قرارداد فعال.

### (۵) وضعیت 503 برای سرویس وصل‌نشده

- `packages/core/src/plt/errors.ts` (بیرون از مالکیت؛ ویرایش کوچک): کد `service_unavailable` با وضعیت 503، پیام پیش‌فرض و `errors.serviceUnavailable(fields)`؛ `details.fields` همان کدهای دلیل قبلی را دارد.
- `source-routes.ts`: `store()`، نبودِ تعریف job آپلود و `verifier_unavailable` با این کد پاسخ می‌دهند. مسیرهای دیگری که `storage: unavailable` می‌دهند (media، export، capture-staging، `verifier_unavailable` در `src/service.ts`) بیرون از مالکیت‌اند و تغییر نکردند.
- کلاینت: `isRetryableUploadFailure` هر وضعیت ۵۰۰ به بالا را قابل‌تلاش می‌داند و `audioUploadProblem` آن را دست‌نخورده برمی‌گرداند؛ آزمونش دو ردیف 503 گرفت. `docs/API_CONTRACTS.md` ردیف `service_unavailable` را گرفت.

### فایل‌های بیرون از مالکیت در این دور

`packages/core/src/plt/errors.ts`، `packages/core/src/voc/{contracts,analysis,report}.ts`، `packages/core/src/proc/voice-processing.ts`، `packages/core/test/voice-fixture.ts`، `apps/web/src/server/automatic-learning-routes.ts`، `docs/API_CONTRACTS.md`. همه ویرایش کوچک و لازم برای همین سه مورد.
