# بازبینی امنیتی پنج شاخهٔ اصلاح (پیش از انتشار D66) — 2026-10-12

دامنه: `git diff origin/claude/gifted-franklin-7ecldm...origin/<branch>` برای پنج شاخه. فقط کد سمت سرور، migration، لاگ و مسیرهای تازه به‌طور کامل خوانده شدند؛ کد رابط فقط برای مالکیت و متن بررسی شد. مدیر کار یافته‌ها را به مالک هر شاخه می‌رساند.

| شاخه | سرِ بررسی‌شده |
|---|---|
| `feat/upload-reliability` | `105c2ac` (دور دوم؛ دور اول `fa9ff12`) |
| `feat/recording-capture` | `c512a24` (دور دوم؛ دور اول `dbf93d7`) |
| `feat/lesson-quality` | `f4a0f7a` |
| `feat/voice-detection` | `26aa6e0` (دور دوم؛ دور اول `966c6aa`) |
| `feat/session-navigation` | `38067a3` |

## ۱. یافته‌ها

### S1 — متوسط: دروازهٔ «فقط قطعهٔ ضبط داخل اپ» به کلید کلاینت وابسته است

> **وضعیت: بسته (ثبت 2026-10-19، ممیزی 2026-10-18، SEC-10).** در `c3eee07` (2026-10-13) رفع شد. `beginStagedAudioUpload` در `packages/core/src/src/staged-audio.ts:60-63` حالا علاوه بر پیشوند کلید، lease باز ضبط جلسهٔ وصل‌شده را با `captureInProgress` لازم می‌داند و بدون آن `capture_required` برمی‌گرداند. آزمون: `packages/core/src/proc/staged-capture-audio.int.test.ts`. نکتهٔ «سقف هزینه و سهمیه پیش از وصل کردن D61» بخشی از این بستن نیست و جداگانه بررسی می‌شود.

- **شاخه و فایل:** `feat/recording-capture`، `packages/core/src/src/staged-audio.ts:44-50` (و مسیر `apps/web/src/server/capture-staging.ts:66-71`).
- **شرح:** `beginStagedAudioUpload` قطعهٔ ضبط را با `source.operation_key?.startsWith("recorded-source:")` تشخیص می‌دهد. `operation_key` همان کلید idempotency است که کلاینت هنگام ثبت منبع می‌فرستد (`apps/web/src/ui/recording/source-sync.ts:151`؛ ذخیره در `packages/core/src/src/service.ts:274`). هر کاربر واردشده می‌تواند فایل صوتی دلخواهی را با این پیشوند ثبت کند و به یک کلاس وصل کند. سپس بی‌هیچ رزرو تأییدشده‌ای نسخهٔ سرور بسازد و decode/verify را اجرا کند. این دروازهٔ `confirmed_processing_required` را که برای هر آپلود دیگر هست دور می‌زند.
- **اثر امروز:** ذخیرهٔ موقت و CPU تأیید بدون سهمیه. سقف آن اندازهٔ قرارداد منبع است و پس از `uploadTtlSeconds` حذف می‌شود. کسر سهمیه سالم می‌ماند، چون Run بعدی طبق D59 رزرو می‌کند.
- **اثر پس از D61:** وقتی hook رونویسی (`setStagedVerifiedHook`) وصل شود، همین مسیر رونویسی **پولی** را پیش از هر رزرو یا بررسی سهمیه اجرا می‌کند؛ یعنی هزینهٔ تأمین‌کننده بدون سقف کاربر.
- **اصلاح پیشنهادی:** در `beginStagedAudioUpload` شرط کنید که lease ضبط جلسهٔ وصل‌شده باز باشد (`captureInProgress(tx, ctx, linked.session_id, now)` از `packages/core/src/org/capture-lease.ts`). بهتر است منشأ «ضبط داخل اپ» را سرور هنگام ثبت از مسیر `/api/recordings` بنویسد، نه از روی پیشوند کلید. پیش از وصل کردن D61 هم سقف هزینه و سهمیهٔ مانده بررسی شود (D37، D56، D59). آزمون: کاربر با کلید `recorded-source:x` روی منبعی که از `/api/sources` ثبت کرده، 400 بگیرد.

### S2 — کم: نسخهٔ staged ممکن است وسط رونویسی Run حذف شود

- **شاخه و فایل:** `feat/recording-capture`، `packages/core/src/src/staged-audio.ts:124-131` (`expires_at = staged_at + uploadTtlSeconds`) و `packages/core/src/src/jobs.ts:206` (`expireTemporaryAudio`).
- **شرح:** Run پس از Stop همان نسخهٔ staged را برمی‌دارد، ولی `expires_at` آن تمدید نمی‌شود. اگر Run نزدیک پایان پنجرهٔ ۲۴ ساعته ساخته شود (ضبط طولانی که دیر Stop شده، یا گوشی آفلاین)، sweep ساعتی می‌تواند شیء را وسط رونویسی حذف کند. نتیجه شکست Run است، نه نشت داده؛ D29 نقض نمی‌شود.
- **اصلاح پیشنهادی:** هنگام برداشتن نسخهٔ staged توسط Run، `expires_at` را تا پایان پنجرهٔ Run تمدید کنید. سقف همچنان قاعدهٔ D29 است: ۲۴ ساعت پس از رونویسی و ۷ روز پس از شکست. یا نسخه‌ای را که کمتر از یک ساعت تا انقضا دارد برندارید و آپلود عادی را شروع کنید.

### S3 — کم (عملیاتی): `VOICE_SETTINGS_JSON` نامعتبر مسیرهای صدا را می‌شکند

- **شاخه و فایل:** `feat/voice-detection`، `packages/core/src/voc/settings.ts:57-63`.
- **شرح:** JSON نامعتبر خطا پرتاب می‌کند. این تنظیم «کلید خاموش‌کردن» D64 است و در بحران، با عجله ویرایش می‌شود. خطای تایپی همهٔ بررسی صدا و مسیر `/api/classes/[id]/voice` را می‌شکند.
- **اصلاح پیشنهادی:** یا هنگام شروع، مقدار نامعتبر را با لاگ `voice_settings_invalid` (بدون مقدار) رد کنید و به پیش‌فرض امن (هر دو کلید خاموش) برگردید، یا در runbook بسنجید. فعلاً runbook بخش ۶ سنجش پیش از ذخیره را لازم کرده است.

### S4 — اطلاع: D60 با ادغام روشن می‌شود و D61 هنوز کامل نیست

- `feat/recording-capture`، `apps/web/src/server/capture-staging-jobs.ts:14-18`: `RECALINO_CAPTURE_EARLY_UPLOAD` و `RECALINO_CAPTURE_EARLY_TRANSCRIPTION` پیش‌فرض روشن‌اند و در production تعریف نشده‌اند. پس D60 با همان استقرار فعال می‌شود، نه در گام «روشن کردن» D66.
- `setStagedVerifiedHook` در هیچ‌جا فراخوانی نمی‌شود، پس D61 عملاً کاری نمی‌کند. سمت کلاینت در `c512a24` اضافه شد، بی‌تغییر سمت سرور؛ S1 تا این commit باز بود و در `c3eee07` بسته شد (بالا). پیش از انتشار، دوباره بازبینی شود.

## ۲. موارد بررسی‌شده بدون یافته

- **مالکیت سمت سرور:**
  - همهٔ خواندن‌ها و نوشتن‌های تازه با `ctx.userId` یا `owner_id` محدودند: `temporaryAudioUploadStates`، `runFinishingStage`، `renewCaptureLease`، `releaseCaptureLease`، `captureInProgress` (همراه `assertSessionOwner`)، `stagedAudioManifest`، `liveTemporaryAudioObject`، `changeClassVoiceIdentity` و `changeVoiceLine` (`currentVoiceRows`، `ownedAnalysis` و تطبیق `session_id`).
  - صفحه‌های تغییرکردهٔ `session-navigation` همه `requireLearner` و `workspaceSession` دارند؛ `estimate` به `material-page.tsx` منتقل شده و همان بررسی را دارد.
  - گزارش اپراتوری `audioUploadWindows` و `ops-cli timings` همهٔ کاربران را می‌خوانند، ولی فقط شناسه و زمان، و فقط از ابزار اپراتور.
- **رفع D59** (`upload-reliability`، `packages/core/src/src/audio.ts`): حذف شرط `hold.audio <= 0` امن است. `reservationIsOpen` مالک و باز بودن رزرو را می‌سنجد، و مسیر پیش از آن `validateAudioUploadRun` را اجرا می‌کند (`apps/web/src/server/source-routes.ts:303,314`).
- **RLS و grantها:** جدول تازه‌ای ساخته نشده است. ستون‌های تازه روی جدول‌هایی با RLS فعال و grant سطح جدول به `recalino_app` نشسته‌اند (`voc.analysis`، `src.audio_upload`، `org.class_session`). قید `audio_upload_hold_or_staged` و index یکتای جزئی، یک نسخهٔ staged برای هر منبع را تضمین می‌کنند.
- **اعتبارسنجی ورودی و سقف اندازه:**
  - مسیر تشخیص ضبط فقط `strictObject` و enum و عدد صحیح محدود می‌پذیرد: حداکثر ۵۰ رخداد و MIME از فهرست مجاز. متن آزاد و شناسهٔ کلاس 400 می‌گیرند و rate limit `support` دارند.
  - manifest قطعه‌های staged با `contract.partBytes` و اندازهٔ منبع سنجیده می‌شود.
  - اقدام‌های صدا با `voiceClassActionSchema` و `voiceLineActionSchema` و تطبیق شناسهٔ خط با utteranceهای موجود سنجیده می‌شوند.
- **idempotency:**
  - شروع staged با مقایسهٔ manifest و index یکتا idempotent است.
  - job تأیید staged کلید singleton `staged-audio:<uploadId>` دارد.
  - کسر سهمیه فقط در Run است و آزمون `staged-capture-audio.int.test.ts` یک بار کسر را می‌سنجد.
  - D63 بخش‌ها را با کش هر گام (`cached`) دوباره صدا نمی‌زند و سهمیهٔ اضافه کسر نمی‌کند.
- **لاگ (PRD-PRIV-06):** خط‌های تازهٔ `capture_health` فقط enum و عدد و `user_id` دارند و فیلدهای لاگ مجاز فهرست‌شده‌اند. در هیچ شاخه‌ای `console.*` یا لاگ متن کلاس، transcript، صوت یا کلید اضافه نشده است.
- **حذف نسخهٔ موقت صوت (D29، D60):** نسخه‌های staged `retention: "temporary"` دارند. `expireTemporaryAudio` بر اساس `expires_at` و حذف منبع، نسخه‌های بی‌hold را هم پاک می‌کند (آزمون «deletes a staged copy that no run used…»). داده‌های ابری در 2026-10-12: هیچ آپلودی بیش از ۲۴ ساعت پس از رونویسی نمانده است.
- **خروجی LLM:** در `lesson-quality` خروجی هر بخش با `generatedKnowledgeSchema` و `validateGeneratedKnowledge` سنجیده می‌شود و نتیجهٔ ادغام `mergeLessonParts` دوباره با `validateGeneratedKnowledge` (`packages/core/src/proc/worker.ts`، حدود خط ۱۵۹۲). خواندن ساخت‌یافتهٔ تخته و `knowledgeRepairDetailSchema` هم از schema می‌گذرند. خروجی مدل اجرا یا رندر خام نمی‌شود.
- **تنظیمات AI:** تغییر `config/openrouter-defaults.json` روی production اثر ندارد، چون production فقط `OPENROUTER_SETTINGS_JSON` را می‌خواند (`apps/web/src/server/ai.ts:8`). نبود کلید `lessonQuality` یعنی رفتار قبلی. پس D62 و D63 تا تغییر صریح env خاموش‌اند.

## ۳. یادداشت‌های جانبی (خارج از پنج شاخه)

- در فهرست env پروژهٔ Vercel، `BLOB_READ_WRITE_TOKEN` (هر سه محیط، از جمله `development`) برچسب امنیتی `readable-secret` دارد؛ یعنی از نوع sensitive نیست. مقدار خوانده یا چاپ نشد. پیشنهاد: تبدیل به sensitive و حذف از `development` اگر لازم نیست (تصمیم مالک؛ تغییر تنظیمات Vercel).
- `apps/web/src/app/(app)/sessions/[id]/voice/page.tsx` در `session-navigation` عنوان را مستقیم می‌نویسد («Your voice in this session»)، نه از `strings.ts` یا `pending-copy.ts`. امنیتی نیست؛ مربوط به D65.
