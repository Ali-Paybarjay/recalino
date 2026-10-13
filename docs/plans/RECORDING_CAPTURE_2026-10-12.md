# ضبط داخل اپ: ضبط صادق، تشخیص بدون محتوا، آپلود و رونویسی حین کلاس — 2026-10-12

شاخه: `feat/recording-capture` (Workstream 2). مبنا: بخش‌های ۳.۳ و ۴ (به‌ویژه ۴.۲ و ۴.۳-ب) [علت واقعی پنج مشکل](FIVE_PROBLEMS_ROOT_CAUSE_2026-10-12.md)، [قطعه‌های ضبط](RECORDING_SEGMENTS_2026-10-06.md)، [یادگیری خودکار](AUTOMATIC_LEARNING_2026-10-06.md)، D29، D32، D33، D47، D59، PRD-REC-01 تا 09، و تصمیم‌های مالک محصول در 2026-10-12: **D60** (آپلود قطعه‌های بسته‌شده حین ضبط) و **D61** (رونویسی پس‌زمینه بدون نمایش متن زنده).

## ۱. خلاصه

- **علت اصلی گم‌شدن دو سوم کلاس 2026-10-12 در کد پیدا و رفع شد.** اپ مدت ضبط را با ساعت دستگاه می‌شمرد؛ حالا مدت را از timestampهای خود فایل (WebM یا MP4) می‌سنجد. فاصله‌های بی‌صدا ثبت می‌شوند، زبان‌آموز پس از Stop از آن‌ها باخبر می‌شود و `durationMs` از صوت واقعی ثبت می‌شود.
- **یافتهٔ تازه:** در فایلی که صوتش وسط کار قطع شده، timestamp پرش می‌کند. رونویسی سرور (`ffmpeg -ss` روی ورودی، بر حسب timestamp) صوتِ بعد از پرش را **هرگز رونویسی نمی‌کرد**. بازتولید با Chromium واقعی: پنجرهٔ دوم ۰ میلی‌ثانیه صوت داشت. اکنون پس از هر فاصله قطعهٔ تازه‌ای شروع می‌شود تا timestampها از صفر شروع شوند (بند ۳.۴).
- تشخیص سلامت ضبط بدون محتوا به لاگ Vercel می‌رود.
- D60 و D61 ساخته شدند. هر دو پیش‌فرض روشن‌اند و kill switch دارند.
- آزمون‌ها: unit، integration محلی (Supabase در Docker) و e2e با Chromium واقعی. **CI گیت‌هاب در کل مخزن از کار افتاده است.** همهٔ شاخه‌ها، از جمله شاخه‌های دیگر workerها، در ۳ ثانیه و بدون runner شکست می‌خورند (بند ۶).

## ۲. چه چیزی و چرا (Task 1 — ضبط صادق)

| موضوع | پیش‌تر | اکنون | فایل |
|---|---|---|---|
| ساعت ضبط | `performance.now()`. همهٔ زمانِ وضعیت «recording» شمرده می‌شد، چه صدا رسیده بود چه نه | مدت هر قطعه از timestampهای همان فایل سنجیده می‌شود. ساعت دستگاه (`Date.now`، یکنوا) فقط برای مقایسه است | [`media-timeline.ts`](../../apps/web/src/ui/recording/media-timeline.ts)، [`capture-meter.ts`](../../apps/web/src/ui/recording/capture-meter.ts)، [`controller.ts`](../../apps/web/src/ui/recording/controller.ts) |
| فرمت‌ها | — | WebM/Opus (Chromium و Firefox) و fragmented MP4 (Safari) به‌صورت streaming و بدون decode خوانده می‌شوند. فقط header و timestamp خوانده می‌شود؛ صوت نگه داشته یا فرستاده نمی‌شود. فرمت ناشناخته به ساعت دستگاه برمی‌گردد (`measuredBy: "clock"`) و فاصله‌ای ادعا نمی‌کند | `media-timeline.ts` |
| تشخیص فاصله | فقط وقتی صفحه دیده می‌شد، پس از ۲۰+۱۰ ثانیه | در هر chunk، رشد «زمان فعال دستگاه منهای صوت رسیده» در همان بازه سنجیده می‌شود. رشد ≥ ۳ ثانیه یک فاصله است. chunkِ دیررسیده که صوتش بعداً می‌رسد، فاصله را پس می‌گیرد. drift تدریجی ساعت هرگز فاصله حساب نمی‌شود (آزمون: ۲ ساعت با drift ۰٫۱٪) | `capture-meter.ts` |
| علت فاصله | — | `hidden`، `frozen` (رخداد freeze یا تایمر قفل/کندشده)، `muted`، `ended`، `stalled`، `interrupted` و `unknown`، از روی رخدادهای واقعی همان بازه | `capture-meter.ts`، [`capture-lifecycle.ts`](../../apps/web/src/ui/recording/capture-lifecycle.ts) |
| فاصلهٔ بین قطعه‌ها | ثبت نمی‌شد | زمان قطع تا اتصال دوبارهٔ میکروفون، و قطعی که تا Stop ادامه داشت، هم فاصله ثبت می‌شوند. Pause هرگز فاصله نیست | `controller.ts` |
| manifest محلی | — | `measuredBy` و `gaps[]` (`from`، `to`، `offsetMs`، `missingMs`، `cause`) در manifest هر قطعه ذخیره می‌شوند | [`store.ts`](../../apps/web/src/ui/recording/store.ts) |
| چرخش ۱۰ دقیقه‌ای | تایمر ۱ ثانیه‌ای. وقتی تایمر کند می‌شد، قطعهٔ اول ۲۹ دقیقه شد | با رسیدن هر chunk و بر اساس صوت سنجیده انجام می‌شود (رخداد رسانه‌ای throttle نمی‌شود). تایمر فقط پشتیبان است. **پس از هر فاصله هم قطعهٔ تازه شروع می‌شود** | `controller.ts` |
| `durationMs` | از ساعت | `round(activeMs)+1000`، و `activeMs` همان صوت سنجیده است. روی Chromium واقعی: پارسر ۴۰۱۴ ms و ffmpeg سرور ۴۰۲۰ ms. حاشیهٔ ۱ ثانیه رزرو سهمیه را امن نگه می‌دارد | [`source-sync.ts`](../../apps/web/src/ui/recording/source-sync.ts) |
| وضعیت سالم در صفحهٔ دیده‌شده | تا ۳۰ ثانیه «recording» بی‌صدا | timeslice ضبط ۲ ثانیه شد (`TIMESLICE_MS`؛ PRD-REC-05 آن را تنظیم فنی می‌داند). پس از ۳ ثانیه بدون chunk، `requestData`، و اگر تا ۲ ثانیه چیزی نرسد، حالت موجود `recovering` با پیام موجود («Recording stopped producing audio…»). chunkهایی که می‌رسند ولی صوت ندارند هم پس از ۳ ثانیه همین حالت را می‌دهند. پس حداکثر **۵ ثانیه** پس از قطع صدا، صفحهٔ دیده‌شده دیگر «در حال ضبط» سالم نشان نمی‌دهد (PRD-REC-03). با بازگشت صفحه به حالت دیده‌شده یا resume، بلافاصله داده خواسته می‌شود. صفحهٔ پنهان هرگز ری‌استارت نمی‌شود | `controller.ts` |
| شمارندهٔ صفحه | ساعت | حداکثر ۶ ثانیه جلوتر از آخرین صوت سنجیده. در فاصله، شمارنده می‌ایستد | `capture-meter.ts` |
| لنگر عکس تخته | ساعت. ممکن بود از مدت قطعه بیشتر شود و سرور `invalid_audio_anchor` بدهد | صوت سنجیدهٔ همان قطعه؛ هرگز از پایان قطعه جلو نمی‌زند | `controller.ts` (`anchorMs`)، [`RecordingView.tsx`](../../apps/web/src/ui/recording/RecordingView.tsx) |
| پیام پس از Stop | — | فقط پس از Stop (PRD-REC-02): جمع دقیقه‌های ضبط‌نشده، ساعت هر بازه و یک راهنما. نوار ضبط در صفحه‌های دیگر فقط جمع را نشان می‌دهد. فهرست قطعه‌ها کنار هر قطعه «N min not recorded» دارد. **متن‌ها در انتظار تأیید است** | [`MissingAudioNotice.tsx`](../../apps/web/src/ui/recording/MissingAudioNotice.tsx)، [`pending-copy.ts`](../../apps/web/src/ui/pending-copy.ts)، [`UI_COPY_PENDING.md`](../design/UI_COPY_PENDING.md) |

ترتیب ثبت قطعه‌ها همان ترتیب ضبط است (`earlierPendingPart` بدون تغییر؛ آزمون uploader). لنگر عکس‌ها به قطعهٔ جاری و صوت سنجیده‌اش بسته است (Task 5).

## ۳. تشخیص بدون محتوا (Task 2)

- کلاینت: [`capture-diagnostics.ts`](../../apps/web/src/ui/recording/capture-diagnostics.ts) رخدادهای `onHealth` کنترلر را دسته‌بندی می‌کند. فاصله، پایان قطعه و پنهان‌شدن صفحه فوراً فرستاده می‌شوند و بقیه حداکثر هر ۶۰ ثانیه. ارسال با `fetch` و `keepalive` است و خطا بی‌اثر دور ریخته می‌شود.
- سرور: route تازهٔ `POST /api/recordings/diagnostics` با احراز هویت، rate limit کلاس `support`، سقف اندازهٔ بدنه (۱۶ KiB)، idempotency اجباری برای هر دسته (کلید تکراری یک بار لاگ می‌شود و با محتوای دیگر رد می‌شود) و schema سخت (zod `strictObject`، enum، عدد صحیح محدود، حداکثر ۵۰ رخداد، MIME با regex) در [`recording-routes.ts`](../../apps/web/src/server/recording-routes.ts). برای هر رخداد یک خط `capture_health` نوشته می‌شود. جز رکورد idempotency (کلید و پاسخ)، هیچ داده‌ای ذخیره نمی‌شود.
- فیلدهای مجاز تازه در allow-list لاگ ([`log.ts`](../../packages/core/src/plt/log.ts)): `capture_event`، `platform`، `browser`، `mime`، `codec`، `state`، `visible`، `part`، `cause`، `measured`، `age_ms`، `offset_ms`، `missing_ms`، `media_ms`، `wall_ms`، `gaps` و `result`. هیچ صوت، متن، شناسهٔ کلاس یا ضبط، یا user agent کامل ثبت نمی‌شود. فقط خانوادهٔ سکو و مرورگر ثبت می‌شود، مثل `android`/`chrome` (PRD-PRIV-06).
- خاموش‌کردن: `RECALINO_CAPTURE_DIAGNOSTICS=off`. در این حالت درخواست پذیرفته و رخدادها دور ریخته می‌شوند.

**خواندن در Vercel Logs:** در Runtime Logs پروژه، `capture_health` را جست‌وجو کنید. هر خط JSON است، مثلاً:

```json
{"event":"capture_health","user_id":"…","capture_event":"gap","platform":"android","browser":"chrome","part":1,"offset_ms":5000,"missing_ms":1680000,"cause":"hidden","age_ms":0}
```

| `capture_event` | معنا |
|---|---|
| `started` | قطعه شروع شد (`part`، `mime`، `codec`) |
| `visibility` | `visible: true/false` |
| `lifecycle` | `state`: `frozen`، `resumed`، `throttled` (فاصلهٔ ضربان تایمر بیش از ۵ ثانیه) |
| `wake_lock` | `state`: `acquired`، `released`، `unavailable`، `failed` |
| `track` | `state`: `muted`، `unmuted`، `ended` |
| `gap` | فاصلهٔ بی‌صدا: `missing_ms`، `offset_ms`، `cause` |
| `interrupted` | قطعه قطع شد و بازیابی خودکار شروع شد |
| `part` | پایان قطعه: `measured`، `media_ms` (صوت واقعی)، `wall_ms` (زمان فعال دستگاه)، `missing_ms`، `gaps` |
| `staged` | نتیجهٔ D60 برای یک قطعه: `result` (`staged`/`skipped`/`failed`) و `duration_ms` |

برای یک ضبط: خط‌های یک `user_id` را بر حسب زمان مرتب کنید. `wall_ms - media_ms` در `part` مقدار گم‌شده است. توالی `visibility:false` → `lifecycle:throttled` → `gap(cause=hidden|frozen)` همان سازوکاری است که در 2026-10-12 دیده شد.

## ۴. D60 — آپلود قطعه‌های بسته‌شده حین ضبط (Task 3)

**سرور (هسته):**
- migration [`20261012230000_src_capture_staged_audio.sql`](../../supabase/migrations/20261012230000_src_capture_staged_audio.sql):
  - `src.audio_upload.reservation_id` می‌تواند خالی باشد. ستون `staged_at` اضافه شد.
  - قید «یا رزرو یا staged» و یک index یکتا برای هر منبع گذاشته شد.
  - ستون `org.class_session.capture_open_until` برای اجارهٔ ضبط اضافه شد.
- [`staged-audio.ts`](../../packages/core/src/src/staged-audio.ts):
  - فقط قطعه‌ای را می‌پذیرد که مال همین کاربر باشد، به کلاسی وصل باشد و **اجارهٔ ضبط آن کلاس باز باشد** (یافتهٔ S1 بازبینی امنیتی: پیشوند `recorded-source:` را کلاینت انتخاب می‌کند و مدرک نیست؛ اجاره را فقط صفحهٔ در حال ضبط تمدید می‌کند). آزمون: کلید جعلی بدون اجاره و اجارهٔ باطل‌شده رد می‌شوند، قطعهٔ واقعی با اجاره پذیرفته می‌شود.
  - از همان پروتکل checksum‌دار و قابل‌ادامه استفاده می‌کند. هیچ سهمیه‌ای رزرو نمی‌شود.
  - verify با job تازهٔ `src.verify_staged_audio` انجام می‌شود (decode کامل، مثل همیشه).
- [`audio.ts`](../../packages/core/src/src/audio.ts): تنها تغییر `holdIsOpen` است. upload بدون رزرو فقط برای نسخهٔ staged مجاز است.
- **پذیرش در Run بعد از Stop:** snapshot منبع، آخرین نسخهٔ verified و منقضی‌نشده را از قبل برمی‌دارد. پس Run بعد از Stop **مستقیم queued** می‌شود. انتقال دوباره، رزرو دوباره و کسر دوباره رخ نمی‌دهد. رزرو و کسر طبق D59 یک بار انجام می‌شود.
- **نگه‌داری D29:**
  - نسخهٔ staged با پنجرهٔ آپلود (۲۴ ساعت) منقضی و با sweep موجود حذف می‌شود. این از سقف ۷ روزه هم سخت‌گیرانه‌تر است.
  - پس از رونویسی موفق، همان قاعدهٔ «حداکثر ۲۴ ساعت» برقرار است.
- **اجارهٔ ضبط** ([`capture-lease.ts`](../../packages/core/src/org/capture-lease.ts)):
  - تا اجاره باز است، `automaticLearningSync` منتظر می‌ماند ([`automatic-learning.ts`](../../apps/web/src/server/automatic-learning.ts)) تا جزوه از بخشی از کلاس ساخته نشود.
  - Stop اجاره را می‌بندد و پردازش را فوراً بیدار می‌کند.
  - صفحهٔ بسته یا فریزشده اجاره را تمدید نمی‌کند و اجاره پس از ۱۵ دقیقه خودبه‌خود باطل می‌شود.
- routeهای تازه (با آزمون cross-account):
  - `/api/sources/[id]/audio/staged`: GET manifest و لینک part؛ POST start، confirm_part و complete.
  - `/api/classes/[id]/capture`: open/close اجاره. پاسخ آن وضعیت flagها را به اپ می‌گوید.

**کلاینت:** [`capture-uploader.ts`](../../apps/web/src/ui/recording/capture-uploader.ts) فقط وقتی ساخته می‌شود که layout سرور (`(app)/layout.tsx`) با `captureFlags().earlyUpload` آن را روشن کرده باشد؛ با kill switch خاموش هیچ درخواست تازه‌ای از اپ نمی‌رود و رفتار امروز عیناً برمی‌گردد. هنگام ضبط این کارها را می‌کند:
1. اجاره را باز و هر ۵ دقیقه تمدید می‌کند.
2. هر قطعهٔ بسته‌شده را به ترتیب ثبت می‌کند. `registerRecordingRow` گزینهٔ `sealedDuringCapture` دارد.
3. نسخهٔ staged را بی‌صدا می‌فرستد. از توابع انتقال موجود استفاده می‌کند: `prepareFileHashes`، `uploadWithConfirmation`، `concurrentUploads` و `uploadWithProgress`. فایل‌های worker آپلود تغییر نکردند.

رفتار خطا و Stop:
- **حین ضبط هیچ پیام یا خطایی نمایش داده نمی‌شود** (PRD-REC-02). قطعه‌ای که staged نشود به آپلود معمول پس از Stop سپرده می‌شود و پیام‌های همان مسیر پس از Stop می‌آیند. خرابی واقعی ضبط همچنان فوراً با کنترلر نمایش داده می‌شود (PRD-REC-03).
- پس از Stop، قطعهٔ آخر را هم staged می‌کند و تا ۶۰ ثانیه منتظر verify می‌ماند. سپس اجاره را می‌بندد تا Run همهٔ نسخه‌ها را بپذیرد.
- مسیر توقف آپلود حین ضبط در `AutomaticLearningProvider` دست نخورده است. با kill switch، رفتار امروز کامل برمی‌گردد.

## ۵. D61 — رونویسی پس‌زمینه بدون متن زنده (Task 4)

- [`capture-transcription.ts`](../../packages/core/src/proc/capture-transcription.ts): پس از verify نسخهٔ staged، یک **auxiliary run** (`proc.capture_transcription`) زمان‌بندی می‌شود. همان الگوی بررسی صدا (voice) است و `worker.ts` تغییری نکرد.
  - همهٔ فراخوان‌های STT از attempts و سیاست هزینهٔ PROC می‌گذرند (D37/D56).
  - checkpointها برای هر قطعه idempotent‌اند (`audio:<source>` و `stt:<chunk>`) و ادامه در runner تازه ممکن است.
  - هیچ رزروی ندارد و هیچ کسری انجام نمی‌دهد (settle خالی).
  - transcript به content version همان قطعه تبدیل می‌شود. Run کلاس پس از Stop **دوباره رونویسی نمی‌کند**؛ آزمون با شمارش فراخوان `/audio/transcriptions` این را نشان می‌دهد. صوت را D59 همچنان یک بار کسر می‌کند.
  - فقط وقتی شروع می‌شود که زبان‌آموز برای آن قطعه سهمیهٔ صوتی داشته باشد. پس کار پولی برای صوتی که Run کلاس نمی‌تواند پردازش کند، شروع نمی‌شود.
  - شکست فقط یعنی Run کلاس خودش آن قطعه را رونویسی می‌کند.
  - تا رونویسی پس‌زمینه در جریان است، کلاس منتظر می‌ماند و پس از پایانش بیدار می‌شود.
  - نسخهٔ سرور برای D29 «رونویسی‌شده» علامت می‌خورد.
- هیچ متنی حین ضبط به کاربر نشان داده نمی‌شود.

## ۶. آزمون‌ها و شواهد

| نوع | فایل | نتیجه |
|---|---|---|
| unit | `media-timeline.test.ts`: fixtureهای واقعی Chromium (فاصله و Pause) و MP4 ffmpeg با برش‌های ۱ بایت تا ۱ MiB، پرش MP4 و فرمت ناشناخته | سبز |
| unit | `capture-meter.test.ts`: فریز ۲۸ دقیقه، chunk دیررس، drift دوساعته، Pause، فرمت ناشناخته، فاصلهٔ پایانی | سبز |
| unit | `capture-honesty.test.ts`: بازتولید 2026-10-12، فایل واقعی Chromium از کنترلر، چرخش بدون تایمر، صفحهٔ دیده‌شدهٔ بی‌صدا، صفحهٔ پنهان با fake timers، میکروفون muted، قطع تا Stop، Pause، رخدادهای بی‌محتوا، لنگر عکس | سبز |
| unit | `capture-lifecycle.test.ts`، `capture-diagnostics.test.ts`، `recording-routes.test.ts`، `MissingAudioNotice.test.ts`، `capture-uploader.test.ts` (ترتیب قطعه‌ها، سکوت خطا، kill switch، پس از Stop) | سبز |
| integration | `proc/staged-capture-audio.int.test.ts`، `proc/capture-transcription.int.test.ts`، `server/capture-lease.int.test.ts`، و cross-account برای `captureDiagnostics`، `sourceStagedAudio` و `classCapture` | سبز، محلی |
| e2e | [`recording-capture.spec.ts`](../../apps/web/e2e/recording-capture.spec.ts): Chromium واقعی و MediaRecorder واقعی، میکروفون مصنوعی Web Audio که وسط ضبط ساکت می‌شود | نتیجه در بند ۶.۱ |
| کل | `pnpm lint`، `pnpm typecheck`، `pnpm check:boundaries`، `pnpm test:unit` | سبز |

### ۶.۱ CI و اجرای محلی

- **CI گیت‌هاب:** از حدود 22:17 UTC همهٔ runها در **کل مخزن** (`feat/recording-capture`، `feat/session-navigation`، `feat/lesson-quality`، `feat/release-prep` و…) در ۲ تا ۳ ثانیه و بدون runner شکست می‌خورند. لاگی هم ساخته نمی‌شود (404). این خطای زیرساخت است، نه این شاخه؛ احتمالاً سهمیه یا پرداخت GitHub Actions.
- به همین دلیل همهٔ مراحل CI محلی و با همان دستورها اجرا شدند. نتیجه‌ها در بند ۱۰ آمده است.

## ۷. flagها

**هشدار استقرار (S4 بازبینی امنیتی):** هر دو kill switch در production تعریف نشده‌اند و پیش‌فرض **روشن**‌اند؛ یعنی D60 و D61 با خود استقرار فعال می‌شوند. اگر runbook انتشار بخواهد اول با رفتار قدیمی مستقر کند، باید `RECALINO_CAPTURE_EARLY_UPLOAD=off` را پیش از استقرار در Vercel بگذارد. سرور با switch خاموش staging را رد می‌کند (`early_upload_disabled`، آزمون cross-account) و route اجاره هم `earlyUpload: false` برمی‌گرداند؛ پس switch مهار واقعی است، نه فقط رفتار کلاینت.

| متغیر محیطی | پیش‌فرض | اثر خاموش‌کردن (`off`) |
|---|---|---|
| `RECALINO_CAPTURE_EARLY_UPLOAD` | روشن (D60) | uploader اصلاً ساخته نمی‌شود: هیچ درخواستی حین ضبط نمی‌رود، اجاره باز نمی‌شود و route اجاره هم بدون تمدید پاسخ می‌دهد. همان رفتار پیش از D60 |
| `RECALINO_CAPTURE_EARLY_TRANSCRIPTION` | روشن (D61)؛ بدون D60 بی‌اثر است | قطعه‌های staged فقط در Run کلاس رونویسی می‌شوند |
| `RECALINO_CAPTURE_DIAGNOSTICS` | روشن | رخدادها پذیرفته و دور ریخته می‌شوند |

ضبط صادق (بخش ۲) flag ندارد. در دامنهٔ تصمیم‌های موجود است (PRD-REC-03 و 05).

## ۸. متن پیشنهادی برای ثبت D60 و D61

**اصلاح قاعدهٔ ۲ D29:**

> 2. **ارسال فقط برای پردازش:** صوت فقط برای رونویسی به سرور ارسال می‌شود: پس از آغاز مجاز پردازش، یا — برای ضبط داخل اپ — هر قطعهٔ بسته‌شدهٔ ۱۰ دقیقه‌ای، حین ضبط و بی‌صدا (D60). نسخهٔ سرورِ قطعهٔ حین ضبط موقت است: اگر رونویسی نشود با پایان پنجرهٔ آپلود (۲۴ ساعت) حذف می‌شود، و پس از رونویسی موفق طبق قاعدهٔ ۳. ارسال حین ضبط نه سهمیه رزرو می‌کند نه کسر؛ Run کلاس پس از Stop طبق D59 یک بار رزرو و کسر می‌کند. در حالت Awaiting quota صوت تازه فقط روی دستگاه می‌ماند. خطای ارسال حین ضبط فقط پس از Stop گفته می‌شود (PRD-REC-02)؛ خرابی واقعی ضبط فوراً (PRD-REC-03).

**جایگزین جملهٔ [یادگیری خودکار](AUTOMATIC_LEARNING_2026-10-06.md) («Stop ends capture; no audio is uploaded mid-capture»):**

> Stop ends capture. While recording, each sealed ten-minute part is registered and its temporary server copy is uploaded silently through the same checksummed, resumable protocol (D60), and may be transcribed in the background without showing any text (D61). Automatic learning waits until Stop (capture lease); the class run then reuses the uploaded copies and transcripts and only the remaining part is sent. Upload problems are shown only after Stop.

**D61 (رونویسی پس‌زمینه):** قطعه‌ای که حین ضبط ارسال و تأیید شده، در پس‌زمینه با همان سیاست هزینه رونویسی می‌شود. هیچ متنی حین کلاس نمایش داده نمی‌شود؛ پس «Live Transcription» بخش ۴.۲ PRD نیست. رونویسی پس‌زمینه سهمیه کسر نمی‌کند و فقط با سهمیهٔ کافی شروع می‌شود. Run کلاس transcript را دوباره استفاده می‌کند.

## ۹. فایل‌های بیرون از مالکیت این workstream (ویرایش کوچک و جدا)

| فایل | تغییر |
|---|---|
| `packages/core/src/src/audio.ts` | `holdIsOpen` به جای چهار `reservationIsOpen` (upload staged بدون رزرو). worker آپلود هم در همین فایل `beginTemporaryAudioUpload` را تغییر داده است. هر دو تغییر جدا و بی‌تداخل‌اند |
| `apps/web/src/server/source-routes.ts` | سه خط: manifest بدون رزرو از مسیر Run تکمیل نمی‌شود |
| `apps/web/src/server/automatic-learning.ts` | یک شرط پیش از خواندن مواد: منتظر اجارهٔ ضبط یا رونویسی پس‌زمینه بمان |
| `apps/web/src/server/automatic-learning.test.ts` | mock دو تابع تازه |
| `apps/web/src/server/jobs.ts`، `routes.ts` | ثبت دو job و سه route |
| `packages/core/src/plt/log.ts` | فیلدهای allow-list |
| `packages/core/src/org/index.ts`، `proc/index.ts`، `src/index.ts` | export |
| `apps/web/src/ui/pending-copy.ts`، `docs/design/UI_COPY_PENDING.md` | بخش «Workstream 2». worker ناوبری و worker آپلود هم در همین دو فایل بخش اضافه کرده‌اند. در ادغام، بخش‌ها کنار هم می‌مانند |

برخورد احتمالی در ادغام: migration تازهٔ voice (`20261012220000_…`) قبل از migration من (`20261012230000_…`) اجرا می‌شود و تداخل ندارد. `packages/core/src/db/types.ts` پس از ادغام باید با `pnpm db:types` دوباره ساخته شود.

## ۱۰. نحوهٔ بررسی و محدودیت‌ها

بررسی محلی: `pnpm db:start && pnpm db:env`، سپس `pnpm verify` و `pnpm --filter @recalino/web exec playwright test e2e/recording-capture.spec.ts e2e/recording.spec.ts`.

محدودیت‌ها:
1. **فرمت‌های دیگر:** برای Ogg یا هر فرمت ناشناخته، مدت همچنان از ساعت است و فاصله‌ای گزارش نمی‌شود. Chromium، Firefox و Safari پوشش داده شده‌اند.
2. **رونویسی سرور با timestamp پرش‌دار:** فایل‌های قدیمی یا قطعه‌ای که پیش از تشخیص فاصله تا ۵ ثانیه صوت پس از پرش دارد، هنوز ممکن است آن چند ثانیه را در رونویسی از دست بدهند. اصلاح کامل در `audio-preparer.ts` است (برنامه‌ریزی پنجره‌ها روی بازهٔ timestamp یا `asetpts`). اندازه‌گیری نشان داد `asetpts` با seek خروجی برای کلاس ۲ ساعته هر تکه را تا حدود ۷ ثانیه به ازای هر ۳۰ دقیقه کندتر می‌کند. پس به تصمیم و مالک آن فایل سپرده شد (پرسش ۳).
3. پنجرهٔ بسیار کوتاه بین ثبت قطعه و باز شدن اجاره در کلاسی که intent معلق دارد، ممکن است یک Run زودهنگام بسازد. این حالت بسیار نادر است و D59 کسر دوباره را مانع می‌شود.
4. اگر کلاس بیش از ۲۴ ساعت پس از ارسال یک قطعه پردازش نشود، نسخهٔ staged حذف می‌شود و Run آن قطعه را از دستگاه دوباره می‌فرستد.
5. متن موجود صفحهٔ ضبط («After Stop, all recorded parts are saved on this device, then uploaded automatically…») با D60 دیگر دقیق نیست. بدون تأیید تغییر داده نشد (پرسش ۲).

## ۱۱. پرسش‌ها برای مالک محصول

1. چهار متن پیام پس از Stop (`recordingCapture.*` در UI_COPY_PENDING) تأیید یا اصلاح شوند.
2. متن صفحهٔ ضبط «After Stop, all recorded parts are saved on this device, then uploaded automatically to prepare…» برای D60 اصلاح شود؟ پیشنهاد: «Recorded parts are saved on this device and sent while you record; after Stop the last part is sent and your notes are prepared.»
3. اصلاح رونویسی صوتِ دارای پرش timestamp در `audio-preparer.ts` (بند ۱۰.۲) با کدام راه و توسط کدام workstream انجام شود؟
4. آستانه‌ها تنظیم فنی‌اند و قابل تغییر: timeslice ضبط ۲ ثانیه (پیش‌تر ۵)، فاصلهٔ کمتر از ۳ ثانیه گزارش نمی‌شود، صفحهٔ دیده‌شده حداکثر ۵ ثانیه پس از قطع صدا حالت ناسالم نشان می‌دهد، و اجاره ۱۵ دقیقه است. تأیید می‌کنید؟
5. اگر داده‌های تشخیصی نشان دهد گوشی‌های پایلوت هنگام قفل صفحه ضبط را رایج قطع می‌کنند، تصمیم دربارهٔ ضبط Native (خارج از MVP) لازم می‌شود. فعلاً اقدامی نشده است.

## ممیزی دوم (2026-10-12)

به درخواست مالک محصول، هر شاهد تشخیص مشکل ۲ جداگانه با آزمون یا دستور اثبات شد. فرض این بود که مشکل حل نشده است تا خلافش ثابت شود. آزمون‌ها اول نوشته و اجرا شدند، بعد اصلاح، بعد اجرای دوباره. اصلاح‌های این دور: timeslice ضبط از ۵ به ۲ ثانیه و آستانه‌های سلامت ۳+۲ ثانیه (پیش‌تر ۱۲+۴)، تشخیص chunk بی‌صدا در صفحهٔ دیده‌شده، `durationMs = round(activeMs)+1000`، ساخت uploader فقط با تصمیم سرور (kill switch خاموش = صفر درخواست)، idempotency اجباری و سقف اندازهٔ بدنه برای route تشخیص، سقف اندازهٔ بدنه برای route staged، و آزمون‌های تازه.

| شاهد تشخیص (بخش ۴.۲ گزارش علت‌ها) | وضعیت | اثبات |
|---|---|---|
| قطعهٔ ۱: ۲۹٫۲ دقیقه اعلام، ۱٫۱ دقیقه decode (صفحه ۲۸ دقیقه پنهان، chunkها قطع) | حل شد | `capture-audit.test.ts` › «part 1»: با fake recorder و ساعت fake، ۲۸ دقیقه پنهان؛ مدت ثبت‌شده ۱٫۱ دقیقه، `gaps[0]` با `from` 08:50:06 و `to` 09:18:06 و `cause: hidden` در manifest، `missing.totalMs` پس از Stop |
| قطعهٔ ۲: ۱۲٫۴ → ۴٫۸ (chunkهای دیررس و throttle‌شده) | حل شد | «part 2»: چهار burst در ۱۲٫۴ دقیقه با ۴٫۸ دقیقه صوت؛ جمع مدت ۴٫۸، جمع فاصله ۷٫۶، هر فاصله با آغاز و پایان |
| قطعهٔ ۳: ۱۰٫۳ → ۱٫۱ (track خاموش، سپس پایان‌یافته) | حل شد | «part 3»: mute فوراً `recovering` با پیام میکروفون؛ چهار اتصال ناموفق (`ended`)؛ مدت ۱٫۱ دقیقه و ≥ ۹٫۲ دقیقه فاصله با علت `muted`/`ended` |
| قطعهٔ ۵: ۱۱٫۷ → ۴٫۵ (تایمر throttle‌شده، چرخش دیر) | حل شد | «part 5»: بدون هیچ فراخوانی تایمر، ۴٫۵ دقیقه صوت و chunk خالی پس از ۷٫۲ دقیقه؛ مدت ۴٫۵، فاصله ۷٫۲. «rotation seals…»: قطعهٔ ۱۰ دقیقه‌ای فقط با رسیدن chunkها بسته می‌شود |
| ساعت `performance.now()` به‌جای رسانه | حل شد | `media-timeline.test.ts` (fixture واقعی Chromium: ۴۰۱۴ ms پارسر در برابر ۴۰۲۰ ms ffmpeg)، `capture-meter.test.ts`، و «registers durationMs…»: `durationMs` ثبت‌شده منهای مدت سنجیده بین ۰ و ۱۰۰۰ ms، نه ۲۹ دقیقهٔ ساعت |
| کاوش سلامت فقط در صفحهٔ دیده‌شده، پس از ۲۰+۱۰ ثانیه | حل شد | «shows a non-healthy state within five seconds…»: با تیک یک‌ثانیه‌ای، حداکثر ۵ ثانیه پس از قطع صدا حالت ناسالم؛ «…when chunks keep coming without audio»: chunk بی‌صدا هم پس از ۳ ثانیه. صفحهٔ پنهان: `capture-honesty.test.ts` › «waits while the page is hidden…» با fake timers |
| چرخش ۱۰ دقیقه‌ای وابسته به تایمر ۱ ثانیه‌ای | حل شد | «rotation seals a ten-minute part from delivered audio alone, with no timer» و `capture-honesty.test.ts` › «rotates parts by delivered audio when timers are frozen» |
| `durationMs` از ساعت | حل شد | «registers durationMs from the measured audio, within one second»؛ در سرور `staged-capture-audio.int.test.ts`: اعلام ۲۹ دقیقه، decode ۴٫۰۲ ثانیه → رزرو ۵ ثانیه (D59، نه ساعت) |
| هیچ‌چیز به زبان‌آموز گفته نشد | حل شد | `capture-honesty.test.ts` (`state.missing` برابر فاصله‌های manifest)، `MissingAudioNotice.test.ts`، و e2e `recording-capture.spec.ts` در Chromium واقعی: متن «Part of this class was not recorded…» فقط پس از Stop. حین ضبط هیچ پیامی: «never shows a pop-up, sound, duration or quota message during capture» |
| decode سرور کمتر از اعلام (۶۷٪ گم‌شده، بی‌صدا) | حل شد | e2e `recording-decode.spec.ts`: MediaRecorder واقعی روی fake device، صفحه frozen (CDP `Page.setWebLifecycleState`) و track خاموش حین ضبط؛ هر قطعه با همان ffmpeg سرور decode می‌شود؛ اختلاف اعلام و decode ≤ ۲٪ و `round(activeMs)+1000 ≥ decode`. نتیجه: {{DECODE}} |
| آپلود حین ضبط متوقف (D29 قاعدهٔ ۲ قدیم) | حل شد (D60) | `staged-capture-audio.int.test.ts` (staging بدون رزرو، verify با `src.verify_staged_audio`، پذیرش در Run پس از Stop، رزرو یک‌بار، حذف با پایان پنجرهٔ ۲۴ ساعته، نسخهٔ رد‌شده ≤ ۷ روز، اجارهٔ ۱۵ دقیقه‌ای)؛ `capture-lease.int.test.ts` (یادگیری خودکار منتظر اجاره)؛ `capture-uploader.test.ts` (ترتیب قطعه‌ها، سکوت خطا تا Stop، kill switch) |
| ۲۸ دقیقه از Stop تا جزوه (رونویسی پس از آپلود همه) | حل شد (D61) | `capture-transcription.int.test.ts`: رونویسی پس‌زمینهٔ قطعهٔ staged؛ اجرای دوبارهٔ job هیچ فراخوان تازه‌ای نمی‌کند (۲ attempt می‌ماند)؛ Run کلاس پس از Stop همان transcript را استفاده می‌کند و STT دوباره صدا نمی‌زند؛ هیچ مسیر نمایش متن زنده در `apps/web/src/ui/recording` نیست (`grep -rn transcript` فقط متن ثابت صفحهٔ ضبط را می‌یابد) |
| PRD-REC-07: «ذخیره شد» فقط پس از ثبت معتبر | حل شد | «says saved only after a valid local registration»: شکست `put` نهایی → `failed`، هرگز `saved` |
| PRD-PRIV-06 و سخت‌گیری route تشخیص | حل شد | `recording-routes.test.ts` › «refuses hostile payloads…» (بدنهٔ بزرگ → 413، ۵۱ رخداد، user agent کامل، شناسهٔ کلاس، متن، script، اعداد خارج از بازه)؛ `captureDiagnostics.int.test.ts`: مالکیت، replay با همان کلید یک بار لاگ می‌شود، کلید با محتوای دیگر رد می‌شود، بدون کلید 400 |
| سازگاری | حل شد | «loads and registers an older manifest without measurement or gap markers»؛ migration روی DB محلیِ تازه (`supabase start` همهٔ ۴۷ migration را به ترتیب اعمال کرد) و `pnpm db:types` بدون diff |

### شواهد اجرای محلی (CI گیت‌هاب همچنان از کار افتاده)

{{EVIDENCE}}

### محدودیت‌های باقی‌مانده از ممیزی

- **S2 (کم، رفع نشده؛ پس از انتشار):** `expires_at` نسخهٔ staged هنگام پذیرش در Run پس از Stop تمدید نمی‌شود. اگر Run نزدیک پایان پنجرهٔ ۲۴ ساعته ساخته شود، sweep ساعتی می‌تواند نسخه را وسط رونویسی حذف کند؛ Run آن‌وقت شکست می‌خورد و Retry قطعه را از دستگاه می‌فرستد (داده‌ای گم نمی‌شود). اصلاح پیشنهادی: تمدید `expires_at` تا پنجرهٔ آپلود Run هنگام پذیرش، یا نپذیرفتن نسخه‌ای با کمتر از ۱ ساعت باقی‌مانده. به دستور مالک (انتشار اول) به بعد از انتشار موکول شد.

- «ثبت درست لنگر عکس حین آپلود زودهنگام» با آزمون واحد `anchorMs` و ترتیب قطعه‌ها در `capture-uploader.test.ts` پوشش داده شده است، نه با e2e عکس تخته.
- اختلاف ۲٪ در e2e روی fake device سنجیده می‌شود؛ روی گوشی واقعی داده‌های `capture_health` باید آن را تأیید کند.
