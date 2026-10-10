# متن‌های رابط در انتظار تأیید مالک محصول

متن رابط باید از طرح مصوب بیاید (CLAUDE.md، «پیاده‌سازی رابط کاربری»؛ D34 و D35). متن‌های زیر برای حالت‌هایی نوشته شده‌اند که نه در `handoff/copy.md` هستند و نه در گزارش‌های بازطراحی 2026-10-04. هیچ‌کدام هنوز با متن نهایی تأیید نشده‌اند. همه در [`apps/web/src/ui/pending-copy.ts`](../../apps/web/src/ui/pending-copy.ts) نگه داشته می‌شوند و آزمون `pending-copy.test.ts` بررسی می‌کند که هر متن عیناً در همین فهرست ثبت شده باشد.

پس از تأیید یا اصلاح هر مورد، متن نهایی به جای خودش در متن صفحه منتقل و ردیفش از این فهرست حذف می‌شود.

**تأیید 2026-10-10:** مالک محصول همهٔ ۴۳ متنی را که در این تاریخ در فهرست بودند تأیید کرد (پیگیری D54). ۳۴ متن عیناً منتقل شدند: متن‌های صدا به [`voice/voice-copy.ts`](../../apps/web/src/ui/voice/voice-copy.ts)، متن‌های بازبینی پردازش به `AutomaticLearningView.tsx` و متن‌های `learningMemory.*` به `learning-memory-copy.ts`. نُه متن زیر با شرط همان تأیید نگه داشته شدند، چون ممکن است در حالتی نمایش داده شوند که calibration خود حساب (D54، ۲۰ تأیید و ۲۰ رد) کلاس‌های بعد را خودکار بپذیرد. این متن‌ها فقط پس از تأیید متن دقیق اصلاح‌شده منتقل می‌شوند.

| کلید | متن | حالت | منشأ | وضعیت |
|---|---|---|---|---|
| `voice.reference.short` | This session had less than 20 seconds of your clear speech, so it was not saved as a voice reference. Later sessions still ask you. | تأیید دستی با کمتر از ۲۰ ثانیه گفتار تمیز | این تغییر (2026-10-08) | نگه‌داشته برای بررسی متن پس از D54 (2026-10-10) |
| `voice.reference.expired` | Confirmed after the 24-hour window for voice patterns, so this session was not saved as a voice reference. Later sessions still ask you. | تأیید دستی پس از انقضای ۲۴ ساعتهٔ بردار موقت | این تغییر (2026-10-08) | نگه‌داشته برای بررسی متن پس از D54 (2026-10-10) |
| `voice.reference.missing` | No voice pattern was available for this speaker, so this session was not saved as a voice reference. Later sessions still ask you. | تأیید دستی بدون بردار (تحلیل متنی یا بردار پاک‌شده) | این تغییر (2026-10-08) | نگه‌داشته برای بررسی متن پس از D54 (2026-10-10) |
| `voice.match.no_sample` | Recalino asked because no voice sample was saved when this session was checked. Automatic matching of later sessions would need a sample and one confirmed session. | بررسی صوتی بدون نمونهٔ صدا؛ پذیرش خودکار ممکن نیست | این تغییر (2026-10-08) | نگه‌داشته برای بررسی متن پس از D54 (2026-10-10) |
| `voice.match.no_reference` | Recalino asked because, when this session was checked, none of your confirmed sessions could be used as a voice reference. | نمونه هست ولی هیچ کلاس تأییدشده‌ای مرجع نشده است | این تغییر (2026-10-08) | نگه‌داشته برای بررسی متن پس از D54 (2026-10-10) |
| `voice.match.policy_unavailable` | Automatic voice matching was not switched on when this session was checked, so it needs your confirmation. | سیاست ارزیابی‌شده برای این نسخهٔ مدل فعال نیست | این تغییر (2026-10-08) | نگه‌داشته برای بررسی متن پس از D54 (2026-10-10) |
| `voice.readiness.needs_sample` | Automatic matching needs a voice sample. Save one below; until then, each session asks you. | تنظیمات صدا: نمونه برای مدل فعلی نیست | این تغییر (2026-10-08) | نگه‌داشته برای بررسی متن پس از D54 (2026-10-10) |
| `voice.readiness.needs_class` | Automatic matching also needs one session where you confirmed your voice with enough clear speech. Until then, each session asks you. | تنظیمات صدا: نمونه هست ولی کلاس مرجع نیست | این تغییر (2026-10-08) | نگه‌داشته برای بررسی متن پس از D54 (2026-10-10) |
| `voice.readiness.unavailable` | Your sample and confirmed sessions are saved. Automatic matching is not available yet, so each session asks you. Confirming or rejecting more sessions can make it available. | تنظیمات صدا: نمونه و مرجع هست ولی calibration حساب هنوز آماده نیست، یا سیاست ثبت‌شده `autoAccept: false` دارد | این تغییر (2026-10-08)؛ متن پیشنهادی مالک در PR #23 (`8ac7b2f`، 2026-10-10) | نگه‌داشته برای بررسی متن پس از D54 (2026-10-10) |

متن‌های پیشین همین صفحه‌ها که پیش از 2026-10-08 مستقیم در کد نوشته شده‌اند در این فهرست نیستند؛ ثبت آن‌ها کار جداگانه‌ای است.
