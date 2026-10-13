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

فهرست تأییدشدهٔ بالا خالی است؛ متن‌های در انتظار هر کار در بخش خودش آمده‌اند.

## Workstream 4 — تشخیص صدا (`feat/voice-detection`، 2026-10-12)

متن‌های تأیید یک‌بارهٔ کلاس و انتخاب در سطح خط (D64). طبق D65، مالک محصول همه را یک‌جا در پایان بازبینی می‌کند. متن‌های موجود و مصوب («Yes, this is my voice»، «No, show other speakers»، «None of these voices is mine»، «This is not my voice» و «این صدای توست؟») بدون تغییر دوباره به کار رفته‌اند.

| کلید | متن | حالت | منشأ | وضعیت |
|---|---|---|---|---|
| `voiceDetection.classHeading` | Your voice in this class | عنوان بخش تأیید صدا برای کل کلاس | D64 | در انتظار تأیید (D65) |
| `voiceDetection.classIntro` | Recalino matched the same voices across this class's recordings. Confirm your voice once for the whole class. | توضیح بالای تأیید یک‌بارهٔ کلاس | D64، PRD-SPK-02 | در انتظار تأیید (D65) |
| `voiceDetection.heardIn` | Heard in {count} of {total} recordings | زیر هر صدای کلاس: در چند بخش ضبط شنیده شده | D64 | در انتظار تأیید (D65) |
| `voiceDetection.ambiguous` | This voice sounded like more than one voice in another recording, so those recordings were not joined. Check them separately below. | پیوند مبهم بین بخش‌ها | FR-VOC-002، D64 | در انتظار تأیید (D65) |
| `voiceDetection.classConfirmed` | Your voice is confirmed for this whole class. | پس از تأیید کلاس | D64 | در انتظار تأیید (D65) |
| `voiceDetection.coveredByClass` | Your choice for the whole class above covers this recording. | کارت هر بخش وقتی تأیید کلاس آن را پوشش می‌دهد | D64 | در انتظار تأیید (D65) |
| `voiceDetection.shortVoices` | Short voices ({count}) | گروه بسته‌شدهٔ صداهای کوتاه | وظیفهٔ ۱ (صداهای تکه‌ای) | در انتظار تأیید (D65) |
| `voiceDetection.shortVoicesDetail` | These voices have too little clear speech to suggest. Choose one only if you recognise it. | داخل گروه صداهای کوتاه | وظیفهٔ ۱ | در انتظار تأیید (D65) |
| `voiceDetection.linesHeading` | Lines that may be yours | عنوان فهرست خط‌های پیشنهادی | D64 (تشخیص گویندهٔ هدف) | در انتظار تأیید (D65) |
| `voiceDetection.linesIntro` | These short lines sound like your voice sample. Mark the lines you said. Only lines you mark can add spoken mistakes. | توضیح فهرست خط‌ها | D64 | در انتظار تأیید (D65) |
| `voiceDetection.lineMine` | This is me | دکمهٔ هر خط | D64 | در انتظار تأیید (D65) |
| `voiceDetection.lineNotMine` | Not me | دکمهٔ هر خط | D64 | در انتظار تأیید (D65) |
| `voiceDetection.lineUndo` | Undo | برگرداندن انتخاب خط | D64 | در انتظار تأیید (D65) |
| `voiceDetection.lineMarkedMine` | Marked as yours | وضعیت خط | D64 | در انتظار تأیید (D65) |
| `voiceDetection.lineMarkedNotMine` | Marked as not yours | وضعیت خط | D64 | در انتظار تأیید (D65) |

متن‌های پیشین همین صفحه‌ها که پیش از 2026-10-08 مستقیم در کد نوشته شده‌اند در این فهرست نیستند؛ ثبت آن‌ها کار جداگانه‌ای است.

## کار ۱ — پایداری آپلود (2026-10-12)

متن‌های زیر برای جدا کردن حالت‌های خطای آپلود صوت نوشته شده‌اند ([گزارش](../plans/UPLOAD_RELIABILITY_2026-10-12.md)). هیچ‌کدام تأیید نشده‌اند. برچسب‌های «Review and retry» و «Retry failed attempt» از متن‌های موجودند و تازه نیستند.

| کلید | متن | حالت | منشأ | وضعیت |
|---|---|---|---|---|
| `uploadReliability.audio.uploadClosed` | This audio upload has ended, so retrying it here cannot work. Your original is still saved on this device. Open processing to see the next step. | صف «Your audio uploads» وقتی سرور آپلود این Run را دیگر نمی‌پذیرد؛ دکمهٔ «Retry saved audio upload» نمایش داده نمی‌شود | جایگزین «Some information is missing or not valid.» | در انتظار تأیید |
| `uploadReliability.audio.notStarted` | The audio upload did not start before its time limit. The audio was not rejected, and the original is still saved on this device. Choose Review and retry to upload it again. | صفحهٔ Processing، Run با `audio_upload_not_started` | جایگزین «The audio could not be verified…» برای آپلودی که شروع نشد | در انتظار تأیید |
| `uploadReliability.audio.incomplete` | The audio upload did not finish before its time limit. The audio was not rejected, and the original is still saved on this device. Choose Review and retry to upload it again. | صفحهٔ Processing، Run با `audio_upload_incomplete` | جایگزین «The audio could not be verified…» برای آپلود نیمه‌تمام | در انتظار تأیید |
| `uploadReliability.automatic.notStarted` | The audio upload did not start before its time limit. The audio was not rejected, and the original is still saved on this device. Choose Retry failed attempt to upload it again. | وضعیت یادگیری خودکار (`blocked`) با `audio_upload_not_started` | جایگزین پیام کلی «Automatic creation could not finish…» | در انتظار تأیید |
| `uploadReliability.automatic.incomplete` | The audio upload did not finish before its time limit. The audio was not rejected, and the original is still saved on this device. Choose Retry failed attempt to upload it again. | وضعیت یادگیری خودکار (`blocked`) با `audio_upload_incomplete` | جایگزین پیام کلی «Automatic creation could not finish…» | در انتظار تأیید |
