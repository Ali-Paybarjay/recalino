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

متن‌های پیشین همین صفحه‌ها که پیش از 2026-10-08 مستقیم در کد نوشته شده‌اند در این فهرست نیستند؛ ثبت آن‌ها کار جداگانه‌ای است.
