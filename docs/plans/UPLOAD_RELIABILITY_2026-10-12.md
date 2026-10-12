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
  - `audio_upload_rejected`: فقط برای رد واقعی توسط verifier.
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

## ۱۰. فایل‌های بیرون از مالکیت

- `packages/core/src/proc/maintenance.ts`، `runs.ts` (فقط نوع `AwaitingUploadFailure`) و `index.ts` (export). کار ۲ به آن‌ها نیاز داشت.
- `packages/core/src/proc/processing.int.test.ts`: یک انتظار.
- `apps/web/src/server/automatic-learning.ts`: دو پیام.
- `apps/web/src/ui/pending-copy.ts` و `docs/design/UI_COPY_PENDING.md`: احتمال تعارض با کارهای دیگر که متن pending اضافه می‌کنند. ادغام ساده است: کلیدها در شاخهٔ جدای `uploadReliability` هستند و بخش سند جداست.
- `ProcessingView.tsx`: فقط متن خطای صوت و برچسب دکمهٔ موجود.
- به `worker.ts` دست نزدم.

## ۱۱. آزمون و شواهد

همه روی شاخهٔ `feat/upload-reliability`، Node 24.21.0 و pnpm 12.4.2، با Supabase محلی و فقط دادهٔ مصنوعی:

| بررسی | نتیجه |
|---|---|
| `pnpm lint` | بدون خطا (1117 فایل) |
| `pnpm typecheck` | بدون خطا |
| `pnpm check:boundaries` | بدون نقض |
| `pnpm test:unit` | 182 فایل، 3282 آزمون، همه موفق |
| `pnpm test:int` (کامل) | 138 فایل، 624 آزمون موفق و 1 skip موجود؛ پیش از کار ۶ اجرا شد. آزمون‌های integration تازهٔ کار ۶ جداگانه اجرا و موفق شدند |
| e2e روی build تولیدی با `CI=1` (مهلت ۵ ثانیه) | 32 از 32 موفق: `upload-reliability`، `audio-upload`، `automatic-learning`، `background-uploads`، `upload-recovery`، `recording` و `processing-review` |

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

- Run [`38315163237`](https://github.com/Ali-Paybarjay/recalino/actions/runs/38315163237) خطای واقعی قاعدهٔ ADR-0002 را نشان داد. اصلاح شد (`dd068c5`).
- از حدود 22:16 UTC همهٔ jobهای مخزن، در همهٔ شاخه‌ها و نه فقط این شاخه، در ۲ تا ۳۰ ثانیه و بی‌آنکه runner بگیرند شکست می‌خورند: `runner_id: 0`، بدون لاگ. این مشکل حساب یا ظرفیت GitHub Actions است، نه کد.
- نتیجهٔ CI برای commit نهایی در پیام پایانی گزارش می‌شود.

**نکتهٔ محیط e2e محلی:** shell این محیط کلید `SUPABASE_SECRET_KEY` ابری و `NEXT_PUBLIC_SUPABASE_*` را export می‌کند. چون Next.js مقدار موجود را با `.env.local` عوض نمی‌کند، سرور محلی کلید ابری را به Auth محلی فرستاد و ورود آزمایشی 500 داد. چیزی به پروژهٔ ابری نرسید، چون `SUPABASE_URL` محلی بود. e2e را با `env -u` برای این متغیرها اجرا کردم.

**آزمون ناپایدار موجود:** `automatic-learning.spec.ts:510` یک بار پیش از تلاش دوم شکست خورد. خود آزمون IndexedDB را بدون `onupgradeneeded` باز می‌کند و به باز شدن پایگاه توسط اپ وابسته است. در اجرای نهایی موفق بود.

## ۱۲. پرسش‌ها برای مالک محصول

1. متن پنج پیام بخش ۹ (D65: بازبینی یک‌جا در پایان).
2. آیا آپلود صوت فایل انتخاب‌شده می‌تواند پیش از بسته شدن گروه فایل‌ها، یعنی هم‌زمان با تأیید عکس‌ها و PDFها، شروع شود؟ این کار مجوز پردازش (Run و رزرو) را به لحظهٔ ثبت فایل صوتی جلو می‌برد.
3. ثبت زمان پایان تحلیل صدا و فاصله‌های پیش‌زمینهٔ کلاینت برای NFR-07 (بخش ۷)، هماهنگ با کار صدا و ضبط.
