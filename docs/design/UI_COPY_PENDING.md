# متن‌های رابط در انتظار تأیید مالک محصول

متن رابط باید از طرح مصوب بیاید (CLAUDE.md، «پیاده‌سازی رابط کاربری»؛ D34 و D35). متن‌های زیر برای حالت‌هایی نوشته شده‌اند که نه در `handoff/copy.md` هستند و نه در گزارش‌های بازطراحی 2026-10-04. هیچ‌کدام هنوز تأیید نشده‌اند. همه در [`apps/web/src/ui/pending-copy.ts`](../../apps/web/src/ui/pending-copy.ts) نگه داشته می‌شوند و آزمون `pending-copy.test.ts` بررسی می‌کند که هر متن عیناً در همین فهرست ثبت شده باشد.

پس از تأیید یا اصلاح هر مورد، متن نهایی به جای خودش در متن صفحه منتقل و ردیفش از این فهرست حذف می‌شود.

| کلید | متن | حالت | منشأ | وضعیت |
|---|---|---|---|---|
| `classDeletion.receiptPending` | It is now hidden from your list, but deleting it is not finished yet. Try deleting it again in a few minutes. | کلاس پنهان شده، اما رسید حذف آن (دفتر حذف پشتیبان) هنوز ذخیره نشده است؛ حذف دوباره با همان کلید آن را کامل می‌کند | درخواست مالک محصول برای پیام خطای درست حذف کلاس (2026-10-09) | در انتظار تأیید |
| `processingReview.recorded` | Your processing review is recorded. Follow its status below; your saved material will be used when processing continues. | پردازش کلاس به‌دلیل سرویس متوقف شده و کاربر قبلاً درخواست بازبینی داده است | merge `83e51f4` (2026-10-08) | در انتظار تأیید |
| `processingReview.resolvedPartial` | Your session notes and flashcards are available with some source limitations. Open the notes to see what could not be processed. | بازبینی با نتیجهٔ جزئیِ منتشرشده بسته شده است | merge `83e51f4` (2026-10-08) | در انتظار تأیید |
| `voice.partialCoverage` | Some parts of this recording could not be read during the voice check and were skipped. Speech in those parts cannot contribute spoken mistakes. Your full transcript and session notes remain available. | بخشی از صدا در بررسی صدا خوانده نشد (`partial_audio`) | commit `d8dedeb` (2026-10-08) | در انتظار تأیید |
| `voice.serviceBlockedSummary` | Spoken mistakes were not checked because this session reached a Recalino service limit. This is not your personal allowance. Your session notes remain available. | خلاصهٔ بالای صفحه وقتی سقف هزینهٔ سرویس اصلاح گفتاری را متوقف کرده است | commit `6dc3789` (2026-10-08) | در انتظار تأیید |
| `voice.serviceBlockedDetail` | Speakers were prepared, but spoken mistakes were not checked because this session reached a Recalino service limit. This is not your personal allowance, and retrying the voice check will not change it. You can still confirm your speaker below. | توضیح همان حالت برای هر منبع کلاس (`voice_correction_service_blocked`) | commit `6dc3789` (2026-10-08) | در انتظار تأیید |
| `learningMemory.setProduction` | core cards | سطر شواهد «Your learning»: نوع کارت‌های تولیدی | بازبینی D49 (2026-10-09)؛ جایگزین «recalled from its meaning» که برای مورد ناموفق نتیجه به نظر می‌رسید | در انتظار تأیید |
| `learningMemory.setRecognition` | supplementary cards | همان سطر: نوع کارت‌های بازشناسی | بازبینی D49 (2026-10-09)؛ جایگزین «recognised its meaning» | در انتظار تأیید |
| `learningMemory.setLegacy` | other cards | همان سطر: کارت‌های قدیمی | بازبینی D49 (2026-10-09)؛ هم‌نام برچسب صفحهٔ کارت‌ها | در انتظار تأیید |
| `learningMemory.recalledTitle` | Recalled in your latest answers | عنوان گروه «یادآوری در دو پاسخ آخر» | بازبینی D49 (2026-10-09)؛ پاسخ Hard هم یادآوری است، پس «well» حذف شد | در انتظار تأیید |
| `learningMemory.simplerReason` | Asked on {date}. When this session, or a session in the same course that teaches it, is processed again, Recalino can use this request to ask for a simpler explanation. | فهرست درخواست‌های «ساده‌تر توضیح بده» | بازبینی D49 (2026-10-09)؛ وعدهٔ قطعی قبلی حذف شد، چون حداکثر هشت نکته در هر اجرا می‌رود | در انتظار تأیید |
| `learningMemory.adaptationAskedSimpler` | “{target}” appears in this lesson. You asked for a simpler explanation of it on {date}. | «Prepared for you» در جزوه برای نکتهٔ درخواست‌شده | بازبینی D49 (2026-10-09)؛ تاریخ، تاریخ درخواست است نه شواهد مرور | در انتظار تأیید |

متن‌های پیشین همین صفحه‌ها که پیش از 2026-10-08 مستقیم در کد نوشته شده‌اند در این فهرست نیستند؛ ثبت آن‌ها کار جداگانه‌ای است.
