# متن‌های رابط در انتظار تأیید مالک محصول

متن رابط باید از طرح مصوب بیاید (CLAUDE.md، «پیاده‌سازی رابط کاربری»؛ D34 و D35). متن‌های زیر برای حالت‌هایی نوشته شده‌اند که نه در `handoff/copy.md` هستند و نه در گزارش‌های بازطراحی 2026-10-04. هیچ‌کدام هنوز تأیید نشده‌اند. همه در [`apps/web/src/ui/pending-copy.ts`](../../apps/web/src/ui/pending-copy.ts) نگه داشته می‌شوند و آزمون `pending-copy.test.ts` بررسی می‌کند که هر متن عیناً در همین فهرست ثبت شده باشد.

پس از تأیید یا اصلاح هر مورد، متن نهایی به جای خودش در متن صفحه منتقل و ردیفش از این فهرست حذف می‌شود.

**تأیید 2026-10-10:** مالک محصول همهٔ ۴۳ متنی را که در این تاریخ در فهرست بودند تأیید کرد (پیگیری D54). ۳۴ متن عیناً منتقل شدند: متن‌های صدا به [`voice/voice-copy.ts`](../../apps/web/src/ui/voice/voice-copy.ts)، متن‌های بازبینی پردازش به `AutomaticLearningView.tsx` و متن‌های `learningMemory.*` به `learning-memory-copy.ts`. نُه متن صدا (`voice.reference.short`، `expired` و `missing`؛ `voice.match.no_sample`، `no_reference` و `policy_unavailable`؛ `voice.readiness.needs_sample`، `needs_class` و `unavailable`) با D54 نمی‌خواندند، چون ممکن بود در حالتی نمایش داده شوند که calibration خود حساب (۲۰ تأیید و ۲۰ رد) کلاس‌های بعد را خودکار بپذیرد. مالک محصول در همان روز متن اصلاح‌شدهٔ هر نُه متن را عیناً تأیید کرد و آن‌ها هم به `voice-copy.ts` رفتند. پیشنهاد PR #23 برای `voice.readiness.unavailable` بدون جملهٔ سوم پذیرفته شد، چون آن جمله با سیاست `autoAccept: false` درست نیست.

پس از آن تأیید فهرست خالی شد. ردیف‌های زیر بعداً اضافه شده‌اند.

| کلید | متن | حالت | منشأ | وضعیت |
|---|---|---|---|---|
| `voice.confirmBlockedSummary` | Voice check finished. To confirm your voice, its excerpts must first play on this device; the next step is shown below. Your session notes stay available. | خلاصهٔ بالای پنل وقتی هر منبعی که تأیید می‌خواهد، منتظر پخش‌شدن کلیپ‌ها روی این دستگاه است؛ جای «Next, confirm which speaker is you below» (D55) | D55 (2026-10-10) | در انتظار تأیید |
| `voice.playback.clipFailed` | This clip could not play. Try again. | پخش یک کلیپ شکست خورد؛ جای متن قدیمی که تشخیص گوینده از روی متن را پیشنهاد می‌کرد (D55) | D55 (2026-10-10) | در انتظار تأیید |
| `voice.playback.listenFirst` | You confirm your voice by listening to these excerpts. Until they can play here, spoken mistakes from this source are withheld; your session notes stay available. | هشدار منبعی که کلیپ دارد ولی صوت اصلی روی این دستگاه پخش‌شدنی نیست؛ زیر هشدار فقط برچسب گوینده‌ها و متن کلیپ‌ها بدون Play دیده می‌شود و دکمه‌های تأیید نمایش داده نمی‌شوند (D55) | D55 (2026-10-10)؛ جایگزین `voice.readPrompt` که تأیید فقط با خواندن متن را پیشنهاد می‌کرد | در انتظار تأیید |

متن‌های پیشین همین صفحه‌ها که پیش از 2026-10-08 مستقیم در کد نوشته شده‌اند در این فهرست نیستند؛ ثبت آن‌ها کار جداگانه‌ای است.
