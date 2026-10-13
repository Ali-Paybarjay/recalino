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
## جریان کار ۵ — ناوبری جلسه و گام بعد (2026-10-12)

متن‌های زیر برای resolver «گام بعد» ([`session-state.ts`](../../apps/web/src/ui/workspace/session-state.ts))، کارت گام بعد در صفحهٔ جلسه و Today، و گام اختیاری تأیید صدا نوشته شده‌اند ([گزارش](../plans/SESSION_NAVIGATION_2026-10-12.md)؛ [تشخیص، بخش ۷](../plans/FIVE_PROBLEMS_ROOT_CAUSE_2026-10-12.md)). سطر وضعیت و برچسب دکمه‌ها تا جای ممکن از متن‌های موجود (`learning-progress.ts`، `AutomaticLearningView.tsx` و صفحهٔ جلسه) آمده‌اند و فقط متن‌های زیر تازه‌اند.

| کلید | متن | حالت | منشأ | وضعیت |
|---|---|---|---|---|
| `sessionNavigation.nextStep` | Next step | برچسب بالای کارت گام بعد در صفحهٔ جلسه و Today | تشخیص ۷.۳ بند ۱ | در انتظار تأیید |
| `sessionNavigation.uploadCount` | {sent} of {total} files sent. | دنبالهٔ سطر وضعیت هنگام ارسال بیش از یک فایل | تشخیص ۷.۳ بند ۱ («در حال ارسال ۳ از ۶») | در انتظار تأیید |
| `sessionNavigation.audioNotReceived` | Your saved audio did not reach Recalino. Retry to send it again from this device; your material is still saved. | Run با `audio_upload_rejected` متوقف شده است؛ جای پیام نادرست «The audio could not be verified…» | تشخیص ۳.۲ بند ۶ | در انتظار تأیید |
| `sessionNavigation.savedOnDevice.heading` | Saved on this device | ضبط تمام‌شده روی دستگاه هست و هنوز به سرور نرسیده است | تشخیص ۷.۳ بند ۱ | در انتظار تأیید |
| `sessionNavigation.savedOnDevice.online` | Your recording uploads automatically while this app is open. | همان حالت، دستگاه آنلاین | تشخیص ۷.۳ بند ۱ | در انتظار تأیید |
| `sessionNavigation.savedOnDevice.offline` | Your recording uploads when this device is back online. Keep this app open. | همان حالت، دستگاه آفلاین («منتظر اینترنت») | تشخیص ۷.۳ بند ۱ | در انتظار تأیید |
| `sessionNavigation.capture.background` | Finished parts upload in the background. Keep recording; nothing interrupts it. | سطر وضعیت حین ضبط وقتی قطعه‌های بسته‌شده در پس‌زمینه ارسال می‌شوند | D60 (تصمیم مالک 2026-10-12)، PRD-REC-02 | در انتظار تأیید |
| `sessionNavigation.capture.lastPart` | Sending the last part | پس از Stop، از قطعه‌های صوتی در حال ارسال فقط آخری مانده است (از پیشرفت اندازه‌گیری‌شدهٔ ارسال) | D60، پیام مدیر 2026-10-12 | در انتظار تأیید |
| `sessionNavigation.capture.lastPartDetail` | The other parts are already sent. Keep this app open until it finishes. | همان حالت | D60 | در انتظار تأیید |
| `sessionNavigation.voiceCheck.heading` | Finishing your notes | درس نوشته شده و انتشار منتظر بررسی صداست | تصمیم مالک 2026-10-12 (رد انتشار پیش از نتیجهٔ صدا)، تشخیص ۷.۱ بند ۵ | در انتظار تأیید |
| `sessionNavigation.voiceCheck.detail` | Your lesson is written. Recalino is checking the voices in your recording before it shows the notes. This can take a few minutes; you can leave this page. | همان حالت | همان | در انتظار تأیید |
| `sessionNavigation.voice.action` | Confirm your voice | دکمهٔ گام اختیاری صدا در صفحهٔ جلسه | تشخیص ۷.۳ بند ۴ | در انتظار تأیید |
| `sessionNavigation.voice.ready` | Your notes are ready. Confirming your voice in this session is optional. | سطر وضعیت وقتی جزوه آماده است و بررسی صدا منتظر تأیید است | تشخیص ۷.۱ بند ۵ و ۷.۳ بند ۴ | در انتظار تأیید |
| `sessionNavigation.voice.cardBody` | Optional: listen to a few excerpts and confirm which voice is yours, so spoken mistakes can be included. Your notes are already available. | متن کارت «Your voice in this session» در صفحهٔ جلسه | تشخیص ۷.۳ بند ۴، D55 | در انتظار تأیید |
## Workstream 2 — ضبط داخل اپ (`feat/recording-capture`، 2026-10-12)

این متن‌ها فقط **پس از Stop** نمایش داده می‌شوند (PRD-REC-02) و بازه‌هایی را می‌گویند که زبان‌آموز قصد ضبط داشت ولی صدایی به دستگاه نرسید (PRD-REC-03، PRD-REC-05). `{minutes}` عدد دقیقه گردشده به بالا و `{time}` ساعت محلی شروع بازه است. جزئیات در [گزارش ضبط داخل اپ](../plans/RECORDING_CAPTURE_2026-10-12.md).

| کلید | متن | حالت | منشأ | وضعیت |
|---|---|---|---|---|
| `recordingCapture.missingSummary` | Part of this class was not recorded: about {minutes} min in total. | پس از Stop، وقتی دست‌کم یک بازهٔ بی‌صدا ثبت شده است؛ در صفحهٔ Recordings و نوار ضبط | تازه؛ در طرح نیست | در انتظار تأیید |
| `recordingCapture.missingInterval` | About {minutes} min missing from {time}. | یک سطر برای هر بازه، زیر متن بالا | تازه | در انتظار تأیید |
| `recordingCapture.missingHint` | This usually happens when the screen locks or another app uses the microphone. Keep Recalino open and the screen on during class. | زیر فهرست بازه‌ها | جملهٔ دوم از متن موجود صفحهٔ ضبط («Keep Recalino open and the screen on for reliable capture») | در انتظار تأیید |
| `recordingCapture.partMissing` | {minutes} min not recorded | کنار مدت هر قطعه در فهرست ضبط‌ها، وقتی آن قطعه بازهٔ بی‌صدا دارد | تازه | در انتظار تأیید |

متن‌های پیشین همین صفحه‌ها که پیش از 2026-10-08 مستقیم در کد نوشته شده‌اند در این فهرست نیستند؛ ثبت آن‌ها کار جداگانه‌ای است.

## کار ۱ — پایداری آپلود (2026-10-12)

متن‌های زیر برای جدا کردن حالت‌های خطای آپلود صوت نوشته شده‌اند ([گزارش](../plans/UPLOAD_RELIABILITY_2026-10-12.md)). هیچ‌کدام تأیید نشده‌اند. برچسب‌های «Review and retry» و «Retry failed attempt» از متن‌های موجودند و تازه نیستند.

| کلید | متن | حالت | منشأ | وضعیت |
|---|---|---|---|---|
| `uploadReliability.audio.uploadClosed` | This audio upload has ended, so retrying it here cannot work. Your original is still saved on this device. Open processing to see the next step. | صف «Your audio uploads» وقتی سرور آپلود این Run را دیگر نمی‌پذیرد؛ دکمهٔ «Retry saved audio upload» نمایش داده نمی‌شود | جایگزین «Some information is missing or not valid.» | در انتظار تأیید |
| `uploadReliability.audio.notStarted` | The audio upload did not start before its time limit. The audio was not rejected, and the original is still saved on this device. Choose Review and retry to upload it again. | صفحهٔ Processing، Run با `audio_upload_not_started` | جایگزین «The audio could not be verified…» برای آپلودی که شروع نشد | در انتظار تأیید |
| `uploadReliability.audio.incomplete` | The audio upload did not finish before its time limit. The audio was not rejected, and the original is still saved on this device. Choose Review and retry to upload it again. | صفحهٔ Processing، Run با `audio_upload_incomplete` | جایگزین «The audio could not be verified…» برای آپلود نیمه‌تمام | در انتظار تأیید |
| `uploadReliability.automatic.rejected` | The audio could not be verified, so sending the same file again would stop at the same point. Open Review material to replace the audio or remove it from the selection. | وضعیت یادگیری خودکار (`blocked`) با `audio_upload_rejected`؛ اقدام اصلی «Review material» (برچسب موجود)، بدون Retry | ممیزی دوم 2026-10-13: جایگزین پیام کلی و دکمهٔ Retry که با همان فایل دوباره متوقف می‌شد | در انتظار تأیید |
| `uploadReliability.automatic.notStarted` | The audio upload did not start before its time limit. The audio was not rejected, and the original is still saved on this device. Choose Retry failed attempt to upload it again. | وضعیت یادگیری خودکار (`blocked`) با `audio_upload_not_started` | جایگزین پیام کلی «Automatic creation could not finish…» | در انتظار تأیید |
| `uploadReliability.automatic.incomplete` | The audio upload did not finish before its time limit. The audio was not rejected, and the original is still saved on this device. Choose Retry failed attempt to upload it again. | وضعیت یادگیری خودکار (`blocked`) با `audio_upload_incomplete` | جایگزین پیام کلی «Automatic creation could not finish…» | در انتظار تأیید |

## Workstream 3 — کیفیت درس و عکس تخته (`feat/lesson-quality`، 2026-10-12)

متن‌های تازهٔ این بخش در [`workspace/lesson-quality-copy.ts`](../../apps/web/src/ui/workspace/lesson-quality-copy.ts) هستند و از `pending-copy.ts` ثبت می‌شوند. توضیح کامل در [گزارش کیفیت درس](../plans/LESSON_QUALITY_2026-10-12.md). هیچ‌کدام تأیید نشده‌اند. برچسب «File N · نام فایل» و پیوند «Review session material» از متن‌های موجود همان صفحه‌اند.

| کلید | متن | حالت | منشأ | وضعیت |
|---|---|---|---|---|
| `lessonQuality.coverage.title` | Material not used in these notes | عنوان فهرست منبع‌هایی که متن داشتند ولی در جزوه استفاده نشدند | کنترل پوشش منبع (lesson-quality-1) | در انتظار تأیید |
| `lessonQuality.coverage.reason.unreadable` | This file could not be read clearly enough to teach from. | دلیل `unreadable` | همان | در انتظار تأیید |
| `lessonQuality.coverage.reason.duplicate` | This file repeats material that another file already teaches. | دلیل `duplicate` | همان | در انتظار تأیید |
| `lessonQuality.coverage.reason.off_topic` | This file does not contain lesson content. | دلیل `off_topic` | همان | در انتظار تأیید |
| `lessonQuality.coverage.reason.outside_selection` | This file is outside the part of the session you selected. | دلیل `outside_selection` | همان | در انتظار تأیید |
| `lessonQuality.coverage.reason.no_teaching_content` | This file has nothing to teach on its own. | دلیل `no_teaching_content` | همان | در انتظار تأیید |
| `lessonQuality.coverage.reason.not_reported` | This file was not used in these notes. | مدل در تنها تولید دوبارهٔ مجاز هم دلیلی نداد | همان | در انتظار تأیید |
| `lessonQuality.review.tooLarge` | This session has more material than one AI lesson review can check, so a review is not available for it. | به‌جای دکمهٔ بازبینی، وقتی ورودی حتی پس از فشرده‌سازی از سقف بزرگ‌تر است | رفع بن‌بست بازبینی درس (400 `lesson_review_input_too_large`) | در انتظار تأیید |
