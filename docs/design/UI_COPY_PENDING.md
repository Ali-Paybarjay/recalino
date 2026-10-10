# متن‌های رابط در انتظار تأیید مالک محصول

متن رابط باید از طرح مصوب بیاید (CLAUDE.md، «پیاده‌سازی رابط کاربری»؛ D34 و D35). متن‌های زیر برای حالت‌هایی نوشته شده‌اند که نه در `handoff/copy.md` هستند و نه در گزارش‌های بازطراحی 2026-10-04. هیچ‌کدام هنوز تأیید نشده‌اند. همه در [`apps/web/src/ui/pending-copy.ts`](../../apps/web/src/ui/pending-copy.ts) نگه داشته می‌شوند و آزمون `pending-copy.test.ts` بررسی می‌کند که هر متن عیناً در همین فهرست ثبت شده باشد.

پس از تأیید یا اصلاح هر مورد، متن نهایی به جای خودش در متن صفحه منتقل و ردیفش از این فهرست حذف می‌شود.

**تأیید 2026-10-10:** مالک محصول همهٔ ۴۳ متنی را که در این تاریخ در فهرست بودند تأیید کرد (پیگیری D54). ۳۴ متن عیناً منتقل شدند: متن‌های صدا به [`voice/voice-copy.ts`](../../apps/web/src/ui/voice/voice-copy.ts)، متن‌های بازبینی پردازش به `AutomaticLearningView.tsx` و متن‌های `learningMemory.*` به `learning-memory-copy.ts`. نُه متن صدا (`voice.reference.short`، `expired` و `missing`؛ `voice.match.no_sample`، `no_reference` و `policy_unavailable`؛ `voice.readiness.needs_sample`، `needs_class` و `unavailable`) با D54 نمی‌خواندند، چون ممکن بود در حالتی نمایش داده شوند که calibration خود حساب (۲۰ تأیید و ۲۰ رد) کلاس‌های بعد را خودکار بپذیرد. مالک محصول در همان روز متن اصلاح‌شدهٔ هر نُه متن را عیناً تأیید کرد و آن‌ها هم به `voice-copy.ts` رفتند. پیشنهاد PR #23 برای `voice.readiness.unavailable` بدون جملهٔ سوم پذیرفته شد، چون آن جمله با سیاست `autoAccept: false` درست نیست.

پس از آن تأیید فهرست خالی شد.

**تأیید دوم 2026-10-10:** مالک محصول سه متن D55 (`voice.confirmBlockedSummary`، `voice.playback.listenFirst` و `voice.playback.clipFailed`) را عیناً تأیید کرد. این متن‌ها به [`voice/voice-copy.ts`](../../apps/web/src/ui/voice/voice-copy.ts) منتقل شدند.

**افزوده 2026-10-10 (D59 و FR-QUOTA-007):** چهار متن زیر پیام کمبود سهمیه را دقیق می‌کنند تا بگوید کدام سهمیه کم است، این کلاس چقدر لازم دارد و چقدر مانده است. نام سهمیه‌ها و واحدها همان‌اند که صفحهٔ Your allowance نشان می‌دهد. جای `{items}` یک یا چند `shortageItem` با نقطه از هم جدا می‌شوند.

| کلید | متن | حالت | منشأ | وضعیت |
|---|---|---|---|---|
| `allowance.shortage` | Your material is saved, but this class needs more allowance than is left. {items}. Ask the pilot operator for more allowance or select less material, then retry. You do not need to upload the same files again. | پردازش خودکار کلاس با کمبود سهمیهٔ زبان‌آموز متوقف شده است | FR-QUOTA-007 بند ۱، D59 | در انتظار تأیید |
| `allowance.shortageItem` | {allowance}: {needed} needed, {left} left | یک سهمیهٔ کم، مثل Class audio: 127 min 56 sec needed, 69 min 22 sec left | FR-QUOTA-007 بند ۱ | در انتظار تأیید |
| `allowance.none` | Your material is saved. You have no active processing allowance. Ask the pilot operator for an allowance, then retry. You do not need to upload the same files again. | حساب دورهٔ سهمیهٔ فعال ندارد | FR-QUOTA-003 | در انتظار تأیید |
| `allowance.covered` | Your material is saved. Your allowance now covers this class. Retry to create the notes and flashcards. You do not need to upload the same files again. | کلاس قبلاً با کمبود سهمیه متوقف شده، ولی سهمیهٔ فعلی اکنون کافی است | FR-QUOTA-007 بند ۵، D59 | در انتظار تأیید |

متن‌های پیشین همین صفحه‌ها که پیش از 2026-10-08 مستقیم در کد نوشته شده‌اند در این فهرست نیستند؛ ثبت آن‌ها کار جداگانه‌ای است.
