# متن‌های رابط در انتظار تأیید مالک محصول

متن رابط باید از طرح مصوب بیاید (CLAUDE.md، «پیاده‌سازی رابط کاربری»؛ D34 و D35). متن‌های زیر برای حالت‌هایی نوشته شده‌اند که نه در `handoff/copy.md` هستند و نه در گزارش‌های بازطراحی 2026-10-04. هیچ‌کدام هنوز تأیید نشده‌اند. همه در [`apps/web/src/ui/pending-copy.ts`](../../apps/web/src/ui/pending-copy.ts) نگه داشته می‌شوند و آزمون `pending-copy.test.ts` بررسی می‌کند که هر متن عیناً در همین فهرست ثبت شده باشد.

پس از تأیید یا اصلاح هر مورد، متن نهایی به جای خودش در متن صفحه منتقل و ردیفش از این فهرست حذف می‌شود.

**تأیید 2026-10-10:** مالک محصول همهٔ ۴۳ متنی را که در این تاریخ در فهرست بودند تأیید کرد (پیگیری D54). ۳۴ متن عیناً منتقل شدند: متن‌های صدا به [`voice/voice-copy.ts`](../../apps/web/src/ui/voice/voice-copy.ts)، متن‌های بازبینی پردازش به `AutomaticLearningView.tsx` و متن‌های `learningMemory.*` به `learning-memory-copy.ts`. نُه متن صدا (`voice.reference.short`، `expired` و `missing`؛ `voice.match.no_sample`، `no_reference` و `policy_unavailable`؛ `voice.readiness.needs_sample`، `needs_class` و `unavailable`) با D54 نمی‌خواندند، چون ممکن بود در حالتی نمایش داده شوند که calibration خود حساب (۲۰ تأیید و ۲۰ رد) کلاس‌های بعد را خودکار بپذیرد. مالک محصول در همان روز متن اصلاح‌شدهٔ هر نُه متن را عیناً تأیید کرد و آن‌ها هم به `voice-copy.ts` رفتند. پیشنهاد PR #23 برای `voice.readiness.unavailable` بدون جملهٔ سوم پذیرفته شد، چون آن جمله با سیاست `autoAccept: false` درست نیست.

پس از آن تأیید فهرست خالی شد.

**تأیید دوم 2026-10-10:** مالک محصول سه متن D55 (`voice.confirmBlockedSummary`، `voice.playback.listenFirst` و `voice.playback.clipFailed`) را عیناً تأیید کرد. این متن‌ها به [`voice/voice-copy.ts`](../../apps/web/src/ui/voice/voice-copy.ts) منتقل شدند.

**تأیید 2026-10-11:** مالک محصول چهار متن D59 و FR-QUOTA-007 (`allowance.shortage`، `allowance.shortageItem`، `allowance.none` و `allowance.covered`) را عیناً تأیید کرد. شرطش این بود که هر متن اقدام متناسب خودش را داشته باشد. متن‌ها به [`allowance-copy.ts`](../../apps/web/src/ui/allowance-copy.ts) منتقل شدند. اقدام‌ها از برچسب‌های موجود و `handoff/copy.md` ساخته شده‌اند و متن تازه‌ای ندارند:

| حالت و متن | اقدام اصلی | اقدام‌های دیگر |
|---|---|---|
| کمبود سهمیه (`allowance.shortage` با `allowance.shortageItem`) | «Ask for more allowance» | «Review material» فقط وقتی انتخاب مواد کمتر کمبود را برطرف می‌کند (صوت یا صفحه، نه نسخهٔ تازه)، و «Review allowance» |
| نبود سهمیهٔ فعال (`allowance.none`) | «Ask the pilot operator» (از بخش Allowance در `handoff/copy.md`) | «Review allowance» |
| سهمیهٔ کافی (`allowance.covered`) | «Retry» در خود پیام، و دکمهٔ اصلی «Retry processing» | پیوند درخواست سهمیه نمایش داده نمی‌شود، چون سهمیه کافی است |

وقتی مقدارها معلوم‌اند و سهمیه کم است یا وجود ندارد، دکمهٔ «Retry after allowance changes» نمایش داده نمی‌شود، چون تلاش دوباره فقط دوباره متوقف می‌شود. وضعیت هر چند ثانیه دوباره خوانده می‌شود و پس از افزایش سهمیه، «Retry processing» ظاهر می‌شود (FR-QUOTA-007 قاعدهٔ ۵). اگر مقدارها در وضعیت نیامده باشند، همان دکمهٔ «Retry after allowance changes» می‌ماند.

در Session sources، اعلان پس از بارگذاری و پیام وضعیت بدون رسید بارگذاری همین اقدام‌ها را نشان می‌دهند: کمبود سهمیه «Ask for more allowance» و «Review allowance»، نبود سهمیه «Ask the pilot operator» و «Review allowance»، و سهمیهٔ کافی «Retry processing».

**تأیید 2026-10-13 (D65، بازبینی یک‌جای پایان کار پنج مشکل):** مالک محصول همهٔ ۳۵ متن پنج جریان کار را عیناً تأیید کرد و متن‌ها از `pending-copy.ts` به فایل نهایی خود منتقل شدند:

| جریان کار | کلیدها | مقصد |
|---|---|---|
| تشخیص صدا، دور دوم (نمونهٔ صدا در شرایط کلاس، پاسخ ۸ مالک) | `voiceSample.classConditions`، `voiceSample.recordAgain`، `voiceSample.replaces` | [`voice/voice-copy.ts`](../../apps/web/src/ui/voice/voice-copy.ts) |
| ناوبری جلسه و گام بعد (۱۴ متن `sessionNavigation.*`) | `nextStep`، `uploadCount`، `audioNotReceived`، `savedOnDevice.*`، `capture.*`، `voiceCheck.*`، `voice.*` | [`workspace/session-navigation-copy.ts`](../../apps/web/src/ui/workspace/session-navigation-copy.ts) |
| ضبط داخل اپ (۴ متن `recordingCapture.*`، فقط پس از Stop) | `missingSummary`، `missingInterval`، `missingHint`، `partMissing` | [`recording/recording-copy.ts`](../../apps/web/src/ui/recording/recording-copy.ts) |
| پایداری آپلود (۶ متن `uploadReliability.*`) | `audio.uploadClosed`، `audio.notStarted`، `audio.incomplete`، `automatic.rejected`، `automatic.notStarted`، `automatic.incomplete` | [`workspace/upload-copy.ts`](../../apps/web/src/ui/workspace/upload-copy.ts) |
| کیفیت درس و عکس تخته (۸ متن `lessonQuality.*`) | `coverage.title`، `coverage.reason.*`، `review.tooLarge` | [`workspace/lesson-quality-copy.ts`](../../apps/web/src/ui/workspace/lesson-quality-copy.ts) (در جای خود، با یادداشت تأیید) |

در همان تأیید، متن مقدمهٔ صفحهٔ ضبط («After Stop, all recorded parts are saved on this device, then uploaded automatically to prepare and save your session notes and flashcards.») که با D60 دقیق نبود، با پیشنهاد گزارش ضبط جایگزین شد: «Recorded parts are saved on this device and sent while you record; after Stop the last part is sent and your notes are prepared.» (`recordingCopy.introduction`).

پس از آن تأیید، فهرست در انتظار تا متن‌های D72 زیر خالی بود.

## D72 — خوانایی عکس تخته روی دستگاه (`feat/photo-readability`، 2026-10-13)

متن‌های لایهٔ ۱ و ۲ D72 ([گزارش](../plans/PHOTO_READABILITY_2026-10-13.md)). فقط در ردیف همان عکس، زیر تصویر کوچک، نمایش داده می‌شوند؛ هیچ پنجره، toast، banner یا صدایی ندارند (PRD-REC-02). عکس همیشه ذخیره می‌ماند و Retake عکس تازه‌ای اضافه می‌کند (PRD-REC-07). هیچ‌کدام تأیید نشده‌اند.

| کلید | متن | حالت | منشأ | وضعیت |
|---|---|---|---|---|
| `photoQuality.ok` | Looks sharp | حکم `ok` | D72 لایهٔ ۱ | در انتظار تأیید |
| `photoQuality.blurry` | May be hard to read: blurry. Retake? | حکم `blurry`، با دکمهٔ Retake | D72 لایهٔ ۱ | در انتظار تأیید |
| `photoQuality.too_dark` | May be hard to read: too dark. Retake? | حکم `too_dark`، با دکمهٔ Retake | D72 لایهٔ ۱ | در انتظار تأیید |
| `photoQuality.too_bright` | May be hard to read: washed out. Retake? | حکم `too_bright`، با دکمهٔ Retake | D72 لایهٔ ۱ | در انتظار تأیید |
| `photoQuality.glare` | May be hard to read: glare on the board. Retake? | حکم `glare`، با دکمهٔ Retake | D72 لایهٔ ۱ | در انتظار تأیید |
| `photoQuality.low_detail` | Hard to see writing in this photo. Move closer or retake? | حکم `low_detail`، با دکمهٔ Retake | D72 لایهٔ ۱ | در انتظار تأیید |
| `photoQuality.retake` | Retake | دکمهٔ گرفتن عکس تازه از همان تخته | D72 لایهٔ ۱ | در انتظار تأیید |
| `photoQuality.zoomPrompt` | Can you read the smallest writing? If not, retake while the board is still there. | Sheet عکس در اندازهٔ کامل با pinch-zoom | D72 لایهٔ ۲ | در انتظار تأیید |
