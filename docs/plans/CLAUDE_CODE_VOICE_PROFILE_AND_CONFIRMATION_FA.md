# پرامپت مستقل Claude Code: پروفایل صدا، تشخیص در کلاس‌های بعد و بازیابی پخش

تاریخ تهیه: 2026-10-08. پروژه: **Recalino / ریکالینو**. این سند برای شروع یک کار مستقل در Claude Code نوشته شده است و به خواندن تاریخچهٔ چت نیاز ندارد.

## ۱. مأموریت و خواستهٔ مالک محصول

مالک محصول می‌خواهد تشخیص صدای زبان‌آموز این تجربه را داشته باشد:

1. کاربر با رضایت مستقل و اختیاری، یک نمونهٔ واضح از صدای خودش ثبت کند؛ معمولاً حدود ۳۰ ثانیه.
2. در نخستین کلاس دارای صوت، صدای خودش را از میان گویندگان تأیید کند تا مرجع کلاس با نمونهٔ اولیه تطبیق داده شود.
3. در کلاس‌های بعد، سیستم با همان پروفایل، صدا را تطبیق دهد. اگر شواهد کافی و سیاست پذیرش معتبر وجود دارد، تأیید خودکار انجام شود و کاربر هر بار مجبور به تأیید دستی نباشد.
4. اگر صدا مبهم، ناکافی، متفاوت، دارای هم‌پوشانی، ناسازگار با نمونهٔ اولیه، یا خارج از دامنهٔ ارزیابی است، سیستم سؤال کند و تا تصمیم معتبر کاربر، اشتباهات گفتاری را به او نسبت ندهد.
5. کاربر بتواند قطعهٔ واقعی صدای نامزد را بشنود. اگر پخش ممکن نیست، علت روشن و مسیر بازیابی واقعی داشته باشد؛ پیام «گوش بده» بدون امکان گوش‌دادن کافی نیست.

هدف «یک ثبت اولیه و یک تأیید نخستین کلاس، سپس تطبیق خودکار قابل اعتماد در شرایط مناسب» است؛ تضمین شناسایی صددرصدی یا تأیید خودکار در همهٔ فایل‌ها خواسته نشده است. رضایت ضبط کلاس، رضایت پروفایل صوتی، ثبت موفق نمونه، تحلیل گویندگان و تأیید هویت پنج مفهوم جدا هستند.

**وظیفهٔ تو:** یافته‌های این سند را مستقل بررسی کن، طرح بهتر خودت را با توجه به هزینهٔ MVP پیشنهاد بده، سپس دامنهٔ مجاز را تا نتیجهٔ قابل بررسی پیاده‌سازی و آزمون کن. پیشنهاد ما حکم فنی نهایی نیست. صرفاً توضیح یا فهرست TODO تحویل نده؛ اشکالات قابل رفع را اصلاح کن و برای هر بخش باقی‌مانده علت و مدرک مشخص ارائه بده.

## ۲. وضعیت مخزن و نحوهٔ شروع امن

مسیر shared checkout هنگام تهیهٔ سند:

`D:/Claude Projects/Recalino`

در بررسی 2026-10-08، این checkout روی branch `codex/voice-check-recovery` و HEAD برابر `a80fb14c2c8f3f7e28e6b1ec75a913d88eb95988` بود و تغییرهای commit‌نشدهٔ متعدد از کارهای دیگر داشت. این تغییرها به این مأموریت تعلق ندارند. آن‌ها را reset، clean، stash، stage، commit یا بازنویسی نکن.

آخرین production بررسی‌شده در آن زمان commit **`83e51f4`** و deployment فعال بررسی‌شده **`dpl_GtfDCwiG1FBWMfmSjGJzPhAFzyoE`** بود. این یک snapshot تاریخی است، نه تضمین وضعیت هنگام شروع تو. ابتدا آخرین branch/commit/remote و هر انتشار بعدی را بررسی کن. منطق `voc/matching.ts`، `voc/profile.ts`، `VoiceProfile.tsx` و `VoiceClips.tsx` در بررسی ما بین shared checkout و `83e51f4` یکسان بود؛ `voc/analysis.ts` در فهرست برخی خطاهای inference تفاوت داشت. به‌خصوص با نسخهٔ قدیمی‌تر، اصلاحات جدید پردازش صوت و کلاس طولانی را از بین نبر.

در یک branch و worktree مستقل با نامی مانند `codex/voice-profile-recovery` کار کن؛ پایه را پس از بررسی آخرین وضعیت معتبر انتخاب و SHA آن را ثبت کن. تغییرهای لازم از کارهای موازی را فقط با هماهنگی و diff مشخص منتقل کن. فقط فایل‌های متعلق به این مأموریت را stage کن.

اصلاح جداگانهٔ **دکمهٔ تلفظ واژه در Recall و Class Notes** روی branch `codex/pronunciation-speakers` و worktree `C:/Users/Ali-PC/.codex/worktrees/pronunciation-speakers/Recalino` انجام می‌شود. پیش از شروع، commit و وضعیت نهایی آن کار را بررسی کن؛ انتشارش را فرض نکن. آن موضوع را وارد این branch نکن و فایل‌های مشترک UI را پیش از ویرایش هماهنگ کن. «پخش صدای واقعی کلاس برای تشخیص گوینده» با «تلفظ TTS واژه» متفاوت است.

**فعال‌سازی Haiku 5.5 جزو این مأموریت نیست.** تنظیم مدل تولید جزوه و کارت، migration مدل، کلید API، تنظیم ابری AI و ارزیابی‌های پولی آن را تغییر نده. ابزارهای آزمایش مدل را به‌عنوان تست این قابلیت اجرا نکن.

در audit قبلی فقط کد، تاریخچه، اسناد و تست‌های موجود خوانده شدند. کلاس مشخص کاربر، IndexedDB مرورگر او یا فایل واقعی او بررسی نشده است. بنابراین علت دقیق نبود پخش در کلاس او هنوز اثبات نشده؛ این سند شرایط قطعی کد را گزارش می‌کند.

## ۳. اسناد مرجع و حدود اختیار

پیش از تغییر، این اسناد و دستورهای نزدیک به فایل را بخوان:

- `CLAUDE.md`، `docs/PROJECT_SPEC.md` و `apps/web/CLAUDE.md` / `apps/web/AGENTS.md`.
- `docs/fr/VOC.md`، خصوصاً FR-VOC-001 تا FR-VOC-008.
- `docs/design/VOICE_IDENTITY_2026-10-06.md`.
- بخش **D29** در `docs/PRODUCT_DECISIONS_LOG.md`، خطوط حدود 22–50: نگهداری صوت کلاس و پخش محلی.
- بخش **D46** همان سند، خطوط حدود 278–289، و `docs/design/RECALL_PRONUNCIATION_PERSONALIZED_NOTES_2026-10-07.md`: محدودهٔ تلفظ Recall و شخصی‌سازی تدریس؛ این‌ها مجوز تشخیص تلفظ یا تغییر مدل تولید نیستند.
- `tools/voice/README.md` و manifest مدل‌های موجود.
- قواعد design handoff و راهنمای Next.js موجود در وابستگی نصب‌شده، اگر UI یا API را تغییر می‌دهی.

کار محلی، audit، طراحی، کد، تست با دادهٔ مصنوعی/دارای مجوز و آماده‌سازی migration محلی لازم در دامنهٔ این درخواست مجاز است. برای انتخاب‌های معمول پیاده‌سازی، دوباره مجوز نخواه. اگر برای رفتار تازه باید FR یا تصمیم محصول نسخه‌دار شود، متن دقیق تغییر و اثرش را همراه نتیجهٔ قابل بررسی آماده کن؛ خواستهٔ جدید کاربر را پنهانی با الزام قدیمی جایگزین نکن.

مرزهای `PROJECT_SPEC.md`، بخش «اول بپرس» حدود خطوط 225–233، همچنان برقرارند: استقرار، ادغام PR کد در main، تغییر تنظیم ابری، migration یا نوشتن/حذف در دیتابیس ابری، تغییر CI، بسته یا سرویس خارجی تازه و تغییر تصمیم/ADR مصوب خارج از خواستهٔ مشخص، مجوز مستقل می‌خواهند. پیش از این مرحله‌ها، کد، diff، آزمون، migration و برنامهٔ rollout/rollback را کامل و قابل بررسی آماده کن؛ تأیید باید آخرین مرحلهٔ مشخص باشد. مجوز نشر تاریخی یک قابلیت را مجوز خودکار این انتشار تلقی نکن.

کلید و فایل `.env` را چاپ یا commit نکن. به حساب یا پروژهٔ ابری دیگر دست نزن. برای این کار از دادهٔ خصوصی یا صوت دیگران بدون مجوز استفاده نکن. آزمون و CI تماس واقعی پولی AI ندارند. این درخواست مجوز خرید، سرویس پولی تازه یا تماس پولی آزمایشی تازه نیست.

## ۴. آنچه اکنون واقعاً در کد وجود دارد

شماره‌خط‌های زیر در snapshot خوانده‌شدهٔ 2026-10-08 هستند؛ در ابتدای کار خودت دوباره آن‌ها را با نسخهٔ انتخاب‌شده تطبیق بده.

### ۴.۱. رضایت و ثبت نمونه

- `apps/web/src/ui/voice/VoiceProfile.tsx`: مسیر onboarding اختیاری `/setup/voice` و تنظیمات صدا. رضایت و ذخیرهٔ نمونه جدا از ضبط کلاس‌اند؛ شروع نمونه هنگام ضبط کلاس مسدود می‌شود. نمونه پیش از ثبت preview دارد و ضبط نمونه حدود ۳۰ ثانیه متوقف می‌شود.
- `apps/web/src/server/voice-routes.ts:56`: GET/PUT/DELETE پروفایل. PUT نمونه را decode و با موتور واقعی diarize می‌کند؛ صوت چندگوینده/نامناسب نباید به enrollment موفق تبدیل شود. حدود خطوط 105–124، مدت ۱۵ تا ۳۵ ثانیه و embedding واقعی بررسی می‌شوند.
- `packages/core/src/voc/profile.ts:141`: مدت نمونه **۱۵ تا ۳۵ ثانیه** و اندازهٔ حداکثر **2,100,000 bytes** کنترل می‌شود.
- `profile.ts:148` به بعد: نمونهٔ جداگانهٔ پروفایل با رضایت، به‌صورت خصوصی و با retention ماندگار ثبت می‌شود. این استثنا برای نمونهٔ خود کاربر است، نه صوت کامل کلاس.
- `profile.ts:68–86`: `enabled`، `enrolled`، `sampleDurationMs`، `modelVersion` و تعداد کلاس‌های واقعاً تأییدشدهٔ دستی جداگانه گزارش می‌شوند. `enabled=true` به‌تنهایی یعنی نمونهٔ معتبر یا هویت تأییدشده وجود دارد نیست.
- `packages/core/src/voc/enrollment.ts` و تست‌ها: idempotency، receipt، lease/epoch و جلوگیری از انتشار worker قدیمی پس از revoke مهم‌اند و باید حفظ شوند.

### ۴.۲. تحلیل کلاس، رتبه‌بندی و مانع پذیرش خودکار

- `packages/core/src/voc/matching.ts:22`: `rankVoiceCandidates` فقط شباهت آکوستیکی بردارهای سازگار با `modelVersion` را محاسبه می‌کند. میانگین نمونه‌های تأییدشده برای رتبه‌بندی استفاده می‌شود. تعداد صحبت‌کردن، بلندی صدا، متن یا حدس نقش «مدرس/شاگرد» اجازهٔ تعیین هویت ندارند.
- `matching.ts:51–94`: `calibrateVoiceAcceptance` بازخوردها را با کلید ترکیبی `accepted:sessionId` به مشاهده‌های مستقل محدود می‌کند؛ تکرار تحلیل همان کلاس پوشش تازه نمی‌سازد. برای کلاس تکراری، سخت‌ترین score/margin نگه داشته می‌شود.
- `matching.ts:83`: calibration فقط با حداقل **۲۰ positive و ۲۰ negative معتبر، با استقلال جلسه در هر دسته** ساخته می‌شود. این الزام را «دقیقاً ۴۰ کلاس متفاوت» تفسیر نکن؛ یک جلسه ممکن است در هر دو دسته مشاهده داشته باشد. شرط اصلی پوشش مستقل و معتبر هر دسته است.
- همان تابع: مثبت‌ها باید از منفی‌ها جدا شوند و margin معتبر مثبت وجود داشته باشد؛ صرف رسیدن شمارنده به ۲۰ کافی نیست.
- `matching.ts:96–117`: `autoAcceptVoice` به calibration با **همان نسخهٔ مدل**، حداقل یک کلاس تأییدشده، **دو نامزد دارای score**، حداقل **۲۰ ثانیهٔ speech تمیز برای نامزد اول** و گذر از score/margin کالیبره‌شده نیاز دارد. یک نامزدِ تنها خودبه‌خود قابل قبول نیست.
- `packages/core/src/voc/analysis.ts:128–166`: این سیاست واقعاً در مسیر ذخیرهٔ تحلیل اجرا می‌شود. positive فقط وقتی معتبر است که همان نامزد هنوز با روش دستی تأیید شده باشد؛ خروجی قبلی سیستم را بی‌دلیل truth تازه نمی‌سازد.

**نتیجهٔ قطعی:** ذخیرهٔ یک نمونه و تأیید یک کلاس در نسخهٔ فعلی، خودکارشدن کلاس بعد را تضمین نمی‌کند. پروفایل قابل استفاده است، اما calibration حساب به شواهد بسیار بیشتری نیاز دارد. این فاصله با هدف محصول باید با طراحی و ارزیابی حل شود؛ تبدیل ۲۰ به ۱ یا انتخاب عدد دلخواه برای cosine راه‌حل معتبر نیست.

### ۴.۳. چرا تأیید دستی همیشه پروفایل را بهتر نمی‌کند

- `packages/core/src/proc/voice-processing.ts:179–184`: بردار قابل enrollment کلاس فقط از گوینده با حداقل **۲۰ ثانیهٔ cleanSpeechMs** استخراج/پذیرفته می‌شود. cleanSpeechMs مقدار واقعاً واردشده به embedding است، نه همهٔ زمان صحبت یا طول فایل.
- `packages/core/src/voc/analysis.ts:196–199`: بردار نامزدهای تأییدنشده خصوصی و موقت است؛ TTL حدود ۲۴ ساعت دارد. در پذیرش خودکار، بردارهای موقت دیگران نگه داشته نمی‌شوند.
- `analysis.ts:439–462`: افزودن مرجع کلاس به پروفایل نیازمند **بردار موجود، انتخاب همان گوینده، تأیید و منقضی‌نشدن TTL، و حداقل ۲۰ ثانیه گفتار تمیز** است. چهار مرجع اخیر کلاس همراه نمونهٔ مستقل حفظ می‌شوند.
- بنابراین تأیید هویت از روی متن، یا تأیید دیرهنگام پس از انقضای بردار، می‌تواند کلاس را دستی verified کند ولی مرجع صوتی قابل استفادهٔ بعدی ایجاد نکند. UI نباید در این حالت بگوید «سیستم صدایت را یاد گرفت».
- TTL بردار موقت با TTL فایل کامل سرور دو قاعدهٔ متفاوت است. حذف موقت کلاس را با نگهداری نمونهٔ پروفایل اشتباه نگیر.

برای جبران انقضا، TTL را پنهانی تمدید یا reset نکن، بردار ساختگی نساز و از متن embedding صوتی تولید نکن. اگر بازتحلیل صوت لازم شد، نیاز به صوت واقعی و اجازهٔ مسیر مربوط را صریح نشان بده؛ آن کار از بازیابی صرفاً محلی پخش جداست.

### ۴.۴. موتور فعلی و حد شواهد کیفیت

- `apps/web/src/server/voice-engine.ts:11–12`: نسخهٔ فعلی `sherpa-onnx-1.13.8_pyannote3-220ad67c_wespeaker-resnet34lm-e9848563` است؛ وزن‌ها و checksum بررسی می‌شوند.
- `voice-engine-worker.mjs`: inference واقعی CPU در worker جدا با `sherpa-onnx-node 1.13.8`، pyannote segmentation و WeSpeaker embedding اجرا می‌شود؛ سرویس پولی تشخیص هویت تازه‌ای وجود ندارد.
- `voice-engine-quality.mjs`: هم‌پوشانی و مرزهای splice/turn کنترل می‌شوند. تأیید کلاس نباید این محدودیت‌های evidence را دور بزند.
- `apps/web/src/server/voice-source-windows.ts` و تست‌های آن: کلاس طولانی به پنجره‌های محدود نمونه‌برداری می‌شود، timestamp به فایل اصلی بازگردانده می‌شود و از seamهای ساختگی evidence تولید نمی‌شود. پوشش «بخش‌های بررسی‌شده» را با تحلیل تمام فایل یکی ندان.
- گزارش‌های موجود `tools/voice/evaluation-report.json`، `evaluation-long-turns.json` و `evaluation-overlap.json` فقط شبیه‌سازی گفت‌وگو با گفتار خوانده‌شدهٔ دارای مجوز هستند. گزارش کوتاه ۲/۳ و گزارش نوبت طولانی ۳/۳ نامزد اول درست داشتند؛ این نمونهٔ کوچک، کلاس واقعی و calibration تولید نیست. رقم `realClassroomRecordingsTested: 0` در این گزارش‌ها باید صادقانه باقی بماند.
- threshold مربوط به **clustering گویندگان** را با threshold **پذیرش هویت** اشتباه نگیر. score خام cosine احتمال یا confidence کالیبره‌شده نیست.

## ۵. اشکال پخش: شرایط قطعی و موارد اثبات‌نشده

کاربر گفت Check Class Voice تمام می‌شود و دستور شنیدن قطعه/خطوط گوینده را می‌بیند، اما محل شنیدن نمی‌بیند و نمی‌تواند با اطمینان صدایش را تأیید کند.

- `apps/web/src/ui/voice/VoiceConfirmation.tsx:24`: نامزد با clip **یا فقط line متنی** قابل نمایش/تأیید دستی تلقی می‌شود.
- `VoiceConfirmation.tsx:515`: متن فعلی `Listen to the excerpts or read the speaker’s lines, then confirm which voice is yours.` برای هر دو وضعیت نمایش داده می‌شود.
- `VoiceConfirmation.tsx:519`: اگر audio URL محلی نباشد، می‌گوید `Original audio is not on this device. Use these saved speaker excerpts to identify your voice.` این «saved excerpts» ممکن است فقط متن/زمان باشد، نه فایل صوت قابل پخش.
- `VoiceConfirmation.tsx:452`: سربرگ `Class source N` هویت فایل اصلی را واضح نشان نمی‌دهد؛ شمارهٔ source یا Voice N هویت پایدار شخص نیست. اگر کاربر چند فایل دارد، انتخاب فایل برای بازیابی بدون نام/اطلاعات منبع دشوار است. این یک ابهام رابط است، نه علت اثبات‌شدهٔ مشکل آن کلاس.
- `apps/web/src/ui/voice/VoiceClips.tsx:8–31`: `useLocalVoiceAudio` فقط `IndexedRecordingStore` همان account/origin/device را می‌خواند و با `(sourceAssetId ?? id) === sourceId` فایل را پیدا می‌کند. fallback سرور ندارد. خطای خواندن با missing Blob در یک نتیجهٔ `url:null` ادغام می‌شود.
- `VoiceClips.tsx:112` و `:141`: پخش/دکمه فقط با **audioUrl محلی و intervalهای clip** وجود دارد. element صوتی native controls عمومی ندارد؛ دکمه‌های clip راه پخش هستند.
- `VoiceClips.tsx:152`: وقتی clip نیست، فقط خطوط متنی نمایش داده می‌شوند. وجود local Blob به‌تنهایی برای این شاخه دکمه ایجاد نمی‌کند.
- `packages/core/src/proc/voice-processing.ts:134–147`: clip فقط از نوبت eligible با مدت حداقل ۶ ثانیه انتخاب می‌شود؛ حداکثر سه clip و هر clip حداکثر ۱۰ ثانیه. نوبت کوتاه می‌تواند line داشته باشد ولی clip نداشته باشد.
- `voice-processing.ts:478–489`: fallback برچسب‌های transcript عمداً embeddings و clips خالی و lines متنی دارد؛ این نتیجه صوت ساختگی یا هویت صوتی معتبر نیست.
- `packages/core/src/voc/contracts.ts:5–11`: clip فقط `{startMs,endMs,text}` است، نه URL یا Blob ذخیره‌شدهٔ سرور. DTO فعلی availability/recovery کامل پخش را هم بیان نمی‌کند.

بنابراین دو شرط قطعی برای نبود Play عبارت‌اند از **نداشتن Blob محلی قابل خواندن** و **نداشتن clip زمان‌دار**. account/origin/browser/device دیگر، پاک‌شدن IndexedDB، خرابی chunk، block شدن storage یا fallback متنی از علت‌های ممکن‌اند؛ هیچ‌کدام برای مرورگر این کاربر اثبات نشده‌اند. خطای autoplay/codec را هم با missing file یکی نکن؛ در صورت رخداد واقعی باید جدا گزارش شود.

### اصلاح یک فرض غلط دربارهٔ آپلود دستی

این ادعا که «فایل انتخاب‌شده همیشه فقط در manual store می‌ماند و VoiceClips آن را نمی‌بیند» در production بررسی‌شده صحیح نیست:

- `apps/web/src/ui/workspace/upload-file.ts:234–271` فایل صوت انتخابی را در **همان RecordingStore** با `id/sourceAssetId` متعلق به source ثبت می‌کند؛ hash فایل ذخیره‌شدهٔ قبلی را نیز مقایسه می‌کند.
- `manual-audio-store.ts:3` صریحاً می‌گوید اصل فایل در RecordingStore است؛ manual store اطلاعات انتقال/Run را نگه می‌دارد.
- `apps/web/src/ui/recording/store.ts:220–237` تعداد، ترتیب و مجموع bytes chunkها را پیش از ساخت Blob کنترل می‌کند.
- `apps/web/src/ui/workspace/SourcesView.tsx:1132` Open original برای صوت فقط وقتی localAvailable درست است نمایش داده می‌شود. لینک Open class sources در VoiceConfirmation، خودش relink کامل فایلِ missing را انجام نمی‌دهد. مسیر فعلی انتخاب/آپلود معمولی را بدون آزمون و بررسی idempotence «بازیابی همان فایل بدون تولید مجدد» معرفی نکن.

## ۶. ثابت‌های حریم خصوصی و جلوگیری از انتساب غلط

**D29 حفظ شود:** اصل کلاس روی دستگاه است؛ نسخهٔ سرور فقط موقت، حداکثر ۲۴ ساعت پس از رونویسی موفق و در پردازش ناموفق با سقف ۷ روز طبق تصمیم محصول. سرور بریدهٔ صوت کلاس را نمی‌سازد و نگه نمی‌دارد. جزوه، کارت و transcript می‌توانند پس از حذف صوت باقی بمانند.

`packages/core/src/src/audio.ts:40–63` به original موقتِ owned/verified/not-expired برای پردازش دسترسی می‌دهد. `packages/core/src/src/service.ts` مسیر `sourceReadLink` معمول را برای audio رد می‌کند. endpoint صوت ماندگار یا server clip برای راحتی UI اضافه نکن.

نمونهٔ مستقل پروفایل فقط با opt-in و رضایت روشن قابل نگهداری است. حضور کاربر در کلاس به‌معنای رضایت ذخیرهٔ بیومتریک همهٔ همکلاسی‌ها نیست. بردار دیگران بعد از پایان تصمیم/انقضا پاک شود. متن/صوت/بردار در log، analytics عمومی، error report یا artifact قابل اشتراک ثبت نشود.

`packages/core/src/voc/profile.ts:260` revoke بلافاصله رضایت، نمونه و داده‌های مشتق‌شده را با نسخهٔ تازه بی‌اعتبار می‌کند؛ worker دیررس نتواند آن‌ها را منتشر کند. `analysis.ts:419–437` پس‌گرفتن مرجع اشتباه، اعتماد خودکار وابسته را نیز پس می‌گیرد. نگه‌داشتن این رفتار ضروری است.

اشتباه گفتاری فقط با projection مجاز سرور و evidence معتبر نسبت داده شود. هیچ LLM، transcript role، تعداد نوبت، صدای بلندتر، ترتیب speaker ID یا نقش حدسی حق انتخاب «این کاربر است» ندارد. TTS قطعهٔ کلاس نیست و برای اثبات هویت استفاده نمی‌شود. خاموش‌بودن/خرابی قابلیت صوت نباید جزوهٔ عادی را خراب یا دائماً قفل کند.

## ۷. طرح پیشنهادی؛ خودت مستقل نقد و بهترش کن

ابتدا حداقل سه گزینه را از نظر صحت، هزینه و زمان بررسی کن:

| گزینه | اثر | محدودیت |
|---|---|---|
| حفظ فقط calibration فعلی هر حساب | امن‌تر از عددسازی و نزدیک به کد موجود | هدف استفادهٔ ساده پس از یک کلاس را برآورده نمی‌کند؛ صرفاً بهبود copy و playback کافی نیست |
| سیاست مدل‌نسخه‌دار با calibration مستقل روی دادهٔ مجاز، همراه نمونهٔ اولیه و مرجع دستی نخستین کلاس هر حساب | می‌تواند مانع انتظار برای ۲۰+۲۰ بازخورد حساب را بدون کنارگذاشتن ارزیابی برطرف کند | نیازمند دادهٔ مناسب، holdout مستقل، معیار abstain و نسخه‌بندی/ابطال روشن است |
| الگوی کوچک شخصی از نمونهٔ اولیه و مرجع دستی با سازگاری چند شاهد/پنجره | از موتور موجود و نمونه‌های محدود استفاده می‌کند؛ شاید برای MVP عملی باشد | توافق چند score همبسته یا یک صدا در همان کلاس، به‌تنهایی calibration و استقلال آماری نیست |

گرایش پیشنهادی، استفادهٔ مجدد از موتور CPU و زیرساخت فعلی، با **پذیرش محافظه‌کارانهٔ نسخه‌دار و ارزیابی‌شده** و fallback به سؤال است. از میان گزینه‌ها یا ترکیب بهترشان، یک طرح مشخص انتخاب کن. سیستم چندعامل، سرویس بیومتریک پولی، ASR دوباره برای هر کلیک، TTS برای speaker identity یا ذخیرهٔ دائمی کلاس لازم نیست.

برای طرح انتخابی روشن کن:

1. ثبت نمونه چه وقت واقعاً آماده است و از شکست/چندگویندگی/کمبود speech چگونه جدا می‌شود؟
2. اولین تأیید چگونه با نمونهٔ اولیه تطبیق می‌شود؟ اگر کاربر اشتباهاً مدرس را تأیید کرد و با نمونه ناسازگار است، بدون silently poisoning profile چه remediationای وجود دارد؟
3. بعد از یک مرجع معتبر، کدام شرایط اجازهٔ پذیرش خودکار می‌دهند؟ سیاست single-speaker، دو نامزد، same-model، duration، noise، overlap، margin و mismatch صریح باشد. شرط دو نامزد را بی‌دلیل حذف نکن؛ اگر مسیر تک‌گوینده پیشنهاد می‌دهی باید کیفیت آن جدا اثبات شود.
4. changed mic، زبان/لهجه، صدای نزدیک دیگران، دوربودن میکروفون، نبود شاگرد، speech کوتاه و کلاس نمونه‌برداری‌شده چگونه به abstain می‌رسند؟
5. شواهد feedback از کجا می‌آیند؟ automatic result را truth تازه نکن و runهای یک کلاس را جلسهٔ مستقل نشمار.
6. profileVersion، modelVersion، policy/calibration version، consent و reference provenance چه اثری بر cache، idempotency و invalidate دارند؟
7. re-enrollment/revoke/تصحیح یک مرجع چگونه اعتماد بعدی و spoken projections را لغو می‌کند؟
8. reference منقضی یا ناکافی چگونه در UI توضیح داده می‌شود؟ ریکاوری به صوت واقعی نیاز دارد؛ reset خودکار TTL راه‌حل نیست.

یک state machine صریح پیشنهاد بده: consent off → sample recording → processing → sample ready → first-class confirmation → reference ready → later match accepted/needs review/unavailable. این stateها لزوماً ستون‌های DB تازه نیستند؛ ساده‌ترین ساختار سازگار را انتخاب کن. class verified با reference ready را یکی نکن. از برچسب «درصد اطمینان» تا وقتی احتمال واقعاً calibrated نیست استفاده نکن.

## ۸. بازیابی واقعی پخش بدون پردازش یا هزینهٔ تازه

playback recovery را مستقل از enrollment و re-analysis طراحی کن:

1. وضعیت‌ها را جدا کن: loading، playable، missing original، corrupt/inaccessible local store، transcript-only/no timed clip، و play/decode failure.
2. برای source نام فایل و شناسهٔ ارتباطی روشن، طول/زمان لازم و علت نبود پخش را نمایش بده؛ Voice N را نام شخص یا هویت پایدار فایل دیگر معرفی نکن.
3. فقط وقتی Play قابل استفاده است دستور «listen» بده. برای متن-only صریح بگو خطوط ذخیره‌شده‌اند و صوت قابل پخش موجود نیست. کاربر را به تأیید اجباری از متن نامطمئن وادار نکن.
4. برای missing original گزینهٔ **Select original recording** فراهم کن. فایل را **محلی** به همان user/source وصل کن؛ source تازه، Run تازه، STT، LLM، آپلود سرور یا هزینهٔ تازه برای این کار نساز.
5. پیش از relink، metadata معتبر source و hash/اندازهٔ دقیق فایل اصلی و ارتباط account/source را بررسی کن. نام فایل به‌تنهایی کافی نیست. اگر hash معتبر نسخهٔ اصلی موجود نیست، «همان فایل تأیید شد» ادعا نکن؛ مسیر ایمن مشخص یا محدودیت روشن بده.
6. relink باید atomic/recoverable باشد: فایل درست، ناقص/خراب، cancellation، quota/storage failure، فایل اشتباه و حساب دیگر پوشش داده شوند. original سالم را با فایل نامنطبق بازنویسی نکن. حذف account/خروج از حساب نباید فایل حساب دیگر را قابل پخش کند.
7. hook پس از relink بدون reload کامل، با وضعیت جدید هماهنگ شود؛ object URL قبلی revoke شود و Play واقعاً از start تا end صحیح پخش/متوقف شود. destroy/unmount/تغییر source نشت صوت یا URL نسازد.
8. اگر clip نیست ولی interval کوتاه معتبر همان گوینده و صوت محلی وجود دارد، امکان excerpt کوتاه یا چند interval روشن را ارزیابی کن. برای متن بی‌زمان یا turn ناامن interval حدسی نساز و شواهد اصلاح گفتاری را با این راحتی UI تضعیف نکن.
9. نبود interval معتبر باید نتیجهٔ terminal قابل فهم داشته باشد: متن، ادامهٔ جزوه، review later یا انتخاب none؛ Play نمایشی و TTS جای آن نباشد.

اگر پس از relink، تحلیل گویندگان قبلاً انجام نشده یا بردار منقضی است، این فایل فقط پخش را بازیابی کرده است. «تحلیل دوبارهٔ کلاس» عمل جدا با ورودی واقعی، رضایت، نسخه‌ها، resource limits و سیاست هزینهٔ مربوط است. در این مأموریت برای بازیابی محلی، خودکار فراخوانی پولی نکن.

## ۹. معیارهای پذیرش پیشنهادی این کار

این ACها را به FRهای مرتبط نگاشت کن؛ شمارهٔ FRهای مصوب را جابه‌جا نکن.

- **VOICE-AC-01:** بدون opt-in، میکروفون نمونه و نگهداری الگوی تازه آغاز نمی‌شود؛ ضبط کلاس جاری مختل نمی‌شود.
- **VOICE-AC-02:** نمونهٔ معتبر ۱۵–۳۵ ثانیه واقعاً پردازش/ثبت شده و نمونهٔ نامعتبر موفق نشان داده نمی‌شود؛ consent-only با enrollment آماده متفاوت است.
- **VOICE-AC-03:** تأیید اول دستی است؛ مرجع کافی، ناکافی، منقضی و ناسازگار با نمونهٔ اولیه به‌وضوح تفکیک می‌شوند.
- **VOICE-AC-04:** با نمونهٔ اولیه و یک کلاسِ دستیِ معتبر، کلاس بعدی مستقل و واجد شرایط در سیاست ارزیابی‌شده می‌تواند خودکار پذیرفته شود؛ در همهٔ کلاس‌ها review بی‌دلیل تکرار نمی‌شود. این رفتار باید با موتور واقعی و holdout مستقل نشان داده شود، نه صرفاً mock.
- **VOICE-AC-05:** نبود learner، نامزد نزدیک، speech کوتاه/overlap/noise، بردار نامعتبر یا نسخهٔ ناسازگار به سؤال/abstain می‌رسد؛ قبول غلط بحرانی به‌عنوان شکست gate گزارش می‌شود.
- **VOICE-AC-06:** run دوبارهٔ همان کلاس پوشش calibration نمی‌سازد؛ خروجی automatic حقیقت دستی تولید نمی‌کند؛ threshold یا confidence ساختگی وجود ندارد.
- **VOICE-AC-07:** local Blob سالم و clip معتبر → Play قابل استفاده با شروع/پایان درست. متن-only یا Blob ناموجود → copy درست و بدون دکمهٔ خراب.
- **VOICE-AC-08:** فایل اصلی درست، بدون source/Run/آپلود/پردازش/مصرف پولی تازه، به همان source محلی relink می‌شود و پخش در همان صفحه فعال می‌شود. فایل اشتباه/خراب/حساب دیگر رد می‌شود.
- **VOICE-AC-09:** revoke، حذف account، تصحیح انتخاب و retry/worker دیررس، reference و derived trust را بازنمی‌گردانند؛ projection اشتباه شخص دیگری باقی نمی‌ماند.
- **VOICE-AC-10:** کلاس طولانی، sourceهای چندگانه و timestampهای windows حفظ می‌شوند؛ speaker ID بین فایل‌ها/chunkها خودبه‌خود یک شخص نیست.
- **VOICE-AC-11:** شکست اختیاری صوت، notes/cards موجود را از بین نمی‌برد؛ هزینه/سهمیه/idempotence موجود حفظ می‌شود؛ پیام pending یا finished با نتیجهٔ واقعی سازگار است.
- **VOICE-AC-12:** D29 و حذف vectorهای موقت حفظ می‌شوند؛ نه server clip تازه، نه retention پنهانی، نه لاگ صوت/متن/embedding، نه فعال‌سازی Haiku 5.5.

اگر شواهد ارزیابی برای پذیرش خودکار ایمن کافی نیست، آن مسیر را فعال نکن و «هدف کامل شد» گزارش نده. بهبود پخش و readiness را تحویل بده، دقیقاً نشان بده کدام gate باز است و چه داده/تصمیم مشخصی کم است. راه‌حل را طوری طراحی کن که کاربرِ دارای شواهد کافی مجبور به جمع‌کردن دستی ده‌ها کلاس صرفاً برای bootstrap نشود.

## ۱۰. آزمون نرم‌افزار و ارزیابی مستقل کیفیت

تست‌های mock برای state/accounting/privacy هستند، نه اثبات دقت تشخیص شخص. حداقل این سناریوها لازم‌اند:

### تست واحد و یکپارچه

- lifecycle رضایت، valid/invalid/multi-speaker sample، replay receipt، concurrency و revoke در میانهٔ inference/upload.
- same/different model، incompatible vector، score غیرمتناهی، missing runner-up، profile mismatch و مستقلبودن کلاس‌های feedback.
- class confirmation با vector expired/کمتر از ۲۰ ثانیه؛ verified شدن دستی بدون وعدهٔ reference جدید.
- تضاد sample و first-class انتخاب‌شده؛ نباید اعتماد به صدای اشتباه را خودکار تکثیر کند.
- reference revoke و invalidate پذیرش‌های وابسته؛ projection لحظه‌ای دادهٔ مجاز و عدم نشت متن دیگری.
- playback state و hook refresh، local relink idempotent/atomic، chunk corruption، mismatch hash، quota/cancel، account isolation و URL cleanup.
- کلیپ کوتاه/متنی، صدا موجود ولی no clip، و عدم ساخت turn از خطوط بی‌زمان.
- پنجره‌های کلاس طولانی، overlap/seam، timestamp و multi-source identity؛ اصلاحات production قبلی حفظ شوند.

فایل‌های موجود برای شروع:

`packages/core/src/voc/matching.test.ts`، `enrollment.int.test.ts`، `analysis.int.test.ts`، `revocation.int.test.ts`، `spoken-evidence.test.ts`؛ `packages/core/src/proc/voice-processing.test.ts` و تست‌های voice-jobs؛ `apps/web/src/server/voice-enrollment.int.test.ts`، `voice-engine.test.ts`، `voice-source-windows.test.ts`، `cross-account/classVoice.int.test.ts`؛ تست‌های RecordingStore و upload-file؛ `apps/web/e2e/voice.spec.ts` و `source-original.spec.ts`.

در `voice.spec.ts:792–881` پخش bounded و account isolation موجود است؛ حدود خط 869 source متعلق به account دیگر عمداً **صفر Play button** دارد. این protection را برای حل missing play حذف نکن. تست‌های جدید باید رفتار کاربر و شکست واقعی را بسنجند، نه خط‌به‌خط implementation را.

### ارزیابی موتور واقعی، بدون API پولی

از موتور و دادهٔ مجاز موجود شروع کن. برای آزمایش جدید، **پیش از دیدن نتایج** پروتکل و dataset manifest/hash را freeze کن. enrollment، کلاس نخستِ دستی، دادهٔ تنظیم سیاست و کلاس‌های بعدی holdout را جدا کن؛ calibration/evaluation در سطح speaker/session استقلال داشته باشند. صوت ارزیابی همان reference یا split همان فایل را کلاس مستقل جا نزن. ground truth هویت از منشأ معتبر dataset/برچسب انسانی دارای مجوز بیاید، نه از prediction سیستم یا LLM.

پوشش: حداقل چند هویت مستقل، learner غیردominant، گویندگان نزدیک، no-learner، تک‌گوینده، چند فایل، sample/class mismatch، تغییر میکروفون/نویز، نوبت کوتاه، overlap، speech کم و پنجره‌های طولانی. مدل واقعی اجرا شود؛ vectors و match scores را برای گرفتن pass در تست کیفیت hardcode نکن. fixture قطعی unit مجاز است و باید به‌عنوان mock مشخص باشد.

پیشاپیش معیارها و gateها را ثبت کن: false accept/false attribution با مخرج و تعداد خام، false reject، abstain/manual-review rate، پوشش autoaccept در کلاس‌های واجد شرایط، خطای رتبهٔ اول، confusion موارد no-learner، latency median/p95، CPU/memory/runtime، و تعداد calls/مصرف افزوده. کارایی تشخیص را فقط روی subsetهای موفق گزارش نکن. شکست‌ها و outcomeهای نامعلوم را حفظ کن. صفر خطای مشاهده‌شده در مجموعهٔ کوچک معادل دقت صددرصدی یا مجوز عمومی نیست؛ ریسک پذیرفتنی تولید باید تصمیم روشن محصول و evidence متناسب داشته باشد.

پس از freeze، تغییر policy/dataset/gate برای قبولی همان round مجاز نیست. اگر شکست رخ داد، round را نگه دار؛ اصلاح و ارزیابی بعدی با نسخه و holdout تازه گزارش شود. تست قبلی LibriSpeech را می‌توان regression دانست، اما آن دادهٔ دیده‌شده holdout تازه نیست. تا G11/مجوز داده روشن نشده، کلاس واقعی خصوصی را برای calibration جمع نکن.

### تست مرورگر

onboarding sample → first-class review → later autoaccepted eligible class؛ ambiguous fallback؛ local original موجود/غایب/خراب؛ انتخاب فایل درست و غلط؛ متن-only؛ صوت مناسب اما clip کوتاه؛ چند source؛ خروج/ورود account دیگر؛ remount/reload پس از relink؛ Play و pause/end صحیح؛ mobile 390 و desktop 1440، keyboard/focus و نام قابل دسترس دکمه‌ها. مرورگر و دیتابیس آزمون فقط local/isolated باشند.

## ۱۱. دستورها و اجرای قابل تکرار

ابتدا وضعیت را فقط بخوان؛ این دستورها را در checkout موجود اجرا کن و نتیجهٔ پایه را ثبت کن:

```powershell
git status --short
git branch --show-current
git rev-parse HEAD
git log -8 --oneline
git log -1 --oneline 83e51f4
git diff 83e51f4 -- packages/core/src/voc packages/core/src/proc/voice-processing.ts apps/web/src/ui/voice apps/web/src/server/voice-source-windows.ts apps/web/src/server/voice-engine.ts
```

پس از انتخاب **base معتبر واقعی** و workspace مستقل، README و scripts همان نسخه را بخوان. مثال دستورهای کیفیت موجود، فقط در محیط متعلق به این کار:

```powershell
pnpm test:unit -- packages/core/src/voc/matching.test.ts
pnpm test:unit -- apps/web/src/server/voice-engine.test.ts apps/web/src/server/voice-source-windows.test.ts
pnpm typecheck
pnpm lint
pnpm check:boundaries
```

برای integration، اتصال‌های `LOCAL_TEST_APP_DATABASE_URL`، `LOCAL_TEST_ADMIN_DATABASE_URL` و `LOCAL_TEST_POOLER_DATABASE_URL` باید به **Supabase محلیِ ایزولهٔ همین worktree** اشاره کنند. host/port و project ID را پیش از اجرا ثابت کن؛ secrets چاپ نشوند. از `.env` ابری یا دیتابیس محلی مشترک دیگران استفاده نکن. reset فقط دیتابیس محلیِ متعلق به خودت و پس از توقف تست‌های همان پروژه؛ دستور reset کلی در shared checkout ممنوع است.

در تجربهٔ اخیر Vitest 5، ENV بالاتر می‌توانست تعداد worker را برخلاف برداشت از `fileParallelism:false` بالا ببرد و روی DB مشترک race ایجاد کند. integrationها را serial اجرا کن و برای گزارش قابل اتکا worker setting را صریح ثبت کن:

```powershell
$env:VITEST_MAX_WORKERS = '1'
pnpm test:int -- packages/core/src/voc/enrollment.int.test.ts packages/core/src/voc/analysis.int.test.ts packages/core/src/voc/revocation.int.test.ts
pnpm verify
pnpm build
pnpm check:client-bundle
pnpm test:e2e -- voice.spec.ts source-original.spec.ts
```

به DB تست عامل دیگر هم‌زمان دست نزن. نام فایل، project filter و syntax Vitest/Playwright را با config نسخهٔ انتخاب‌شده تطبیق بده؛ این مثال‌ها مجوز اجرای آزمون روی production نیستند. اگر dependency/runtime آماده است بی‌دلیل نصب تازه نکن؛ Node 24 و pnpm 12 مطابق packageManager مخزن‌اند.

ارزیابی CPU موجود، پس از بررسی license، داده و تغییرندادن frozen protocol:

```powershell
node --conditions=react-server tools/voice/evaluate.mjs
node --conditions=react-server tools/voice/evaluate.mjs --long-turns
node --conditions=react-server tools/voice/evaluate-overlap.mjs
```

این سه دستور، قابلیت کلاس واقعی یا calibration تازهٔ طرح تو را به‌تنهایی اثبات نمی‌کنند. اگر ابزار frozen جدید می‌نویسی، دستور دقیق، version/hash، منابع، هزینه و output directory جدا را در تحویل ثبت کن. برای build/native packaging، تست‌های `apps/web/tools/native-build-adapter.test.mjs` و `trace-native-dependencies.test.mjs` طبق README موجود مرتبط‌اند؛ فقط با تغییر مرتبط دوباره اجرا شوند.

## ۱۲. مراحل پیشنهادی تحویل

1. **Audit مستقل:** آخرین base، فایل‌های تغییرکردهٔ هم‌زمان، مدل/runtime/retention و وضعیت موجود را تأیید یا یافته‌های ما را اصلاح کن. diff و مالکیت فایل‌ها را روشن کن.
2. **طرح و gate:** گزینه‌ها، سیاست bootstrap/accept/abstain، ریسک انتساب اشتباه، stateها، بودجهٔ محاسبات و دادهٔ frozen را مشخص کن. حداقل دامنهٔ معتبر و قابل آزمون را انتخاب کن.
3. **Playback recovery:** missing/transcript-only/error را تفکیک کن، copy/source identity را روشن و relink محلی امن را پیاده کن. بدون calls پولی و بدون ایجاد منبع/پردازش تکراری نشان بده.
4. **Profile readiness و matching:** ثبت اولیه و مرجع نخستین کلاس را قابل مشاهده کن؛ مسیر پذیرش بعدی را فقط با سیاست ارزیابی‌شده اضافه کن. revoke، version fencing و independent evidence را نگه دار.
5. **Verification:** تست‌های ضروری، کیفیت موتور واقعی روی holdout frozen، latency/resource و regression کلاس طولانی/حریم خصوصی. شکست اصلی را با skip یا تغییر assertion نپوشان.
6. **تحویل و approval نهایی:** کد محلی، اسناد تصمیم پیشنهادی، migration محلی لازم، report، دستورها و rollout/rollback را کامل کن. اگر انتشار یا write ابری لازم است، همان تغییر مشخص و evidence را برای approval نهایی ارائه بده؛ قبل از آن هیچ انتشار/تغییر production انجام نده.

ترتیب مراحل برای استقلال کار مفید است؛ اگر طرح بهتری داری توضیح بده و همان را اجرا کن. محصول را در حالت نصفه با spinner یا وعدهٔ بی‌پشتوانه رها نکن.

## ۱۳. انتخاب‌های باز؛ کدام را خودت حل کن و کدام تصمیم محصول است

خودت با بررسی و آزمون حل کن: محل stateها، reuse hook/store، نام component، راه relink atomic، hash computation محدود و قابل cancel، روش invalidate/refetch، کمترین schema change، ترکیب مرجع اولیه/کلاس، پروتکل دادهٔ مجاز و مسیردهی fallback.

تا حد ممکن از API/store/model فعلی استفاده کن. گزینه‌های برتر را کوتاه مستند کن؛ لازم نیست برای هر تابع یا copy سؤال بپرسی.

تصمیم‌های واقعی محصول را با نمونهٔ ملموس آماده کن: سطح ریسک مجاز برای autoaccept، دسترسی به دادهٔ واقعی دارای رضایت اگر آزمایش مجاز موجود کافی نیست، تغییر retention/رضایت یا خدمت خارجی، بودجهٔ جدید، و فعال‌سازی/استقرار تولید. هیچ‌کدام را از هدف «یک‌بار تأیید» به‌صورت ضمنی حدس نزن. اگر یکی مانع بخش خاصی است، بقیهٔ کار مستقل و مجاز را تمام کن و دقیقاً بگو کدام گزینه/تصمیم لازم است.

## ۱۴. بررسی‌های منفی محصول پیش از پایان

- آیا UI برای transcript-only هنوز می‌گوید گوش بده، یا saved text را audio excerpt جا می‌زند؟
- آیا ورود در مرورگر/دستگاه دیگر وعدهٔ پخش فایل device-only می‌دهد؟
- آیا relink کلیک‌شده یک source، upload، Run، STT یا پرداخت تازه می‌سازد؟
- آیا ثبت رضایت، enabled یا verified کلاس به‌اشتباه «پروفایل آمادهٔ تطبیق» نمایش داده می‌شود؟
- آیا کمبود speech یا expiry با بردار صفر/مصنوعی، TTL reset یا تأیید LLM پنهان شده؟
- آیا یک کلاس یا auto prediction بارها evidence مستقل حساب شده؟
- آیا speaker 1 بین دو فایل هویت ثابت گرفته یا صدای مدرس به‌خاطر غالب‌بودن شاگرد فرض شده؟
- آیا acceptance threshold از score دلخواه، clustering threshold، سه مثال تمیز یا نتایج همان holdout انتخاب شده؟
- آیا incorrect first confirmation می‌تواند صدای شخص اشتباه را در کلاس‌های بعد تکثیر کند؟
- آیا revoke/delete/late worker می‌تواند داده یا اعتماد قدیمی را برگرداند؟
- آیا کاربرِ نیازمند review هنوز می‌تواند جزوهٔ عادی را بخواند و بعداً برگردد؟
- آیا حفظ پخش باعث ذخیرهٔ server clip یا صوت ماندگار کلاس، لاگ شخصی یا تغییر پنهانی D29 شده؟
- آیا تلفظ Recall/Haiku 5.5/تغییرهای همکار وارد این diff شده‌اند؟

پاسخ مطلوب این checks باید با کد و تست واقعی پشتیبانی شود؛ عبارت «قرار است درست کار کند» کافی نیست.

## ۱۵. معیار پایان و شکل گزارش نهایی

کار زمانی تمام است که رفتار جدید در workspace مستقل قابل اجرا و بررسی باشد، بازیابی پخش واقعاً کار کند، ثبت/تأیید/آمادگی پروفایل جدا باشند، پذیرش خودکار بعدی با سیاست معتبر و evidence مستقل نشان داده شود، موارد نامطمئن abstain کنند و privacy/account/version/retention رعایت شود. برای هدفی که هنوز quality gate لازم دارد، completion کامل اعلام نکن.

گزارش نهایی شامل این موارد باشد:

- base و head SHA، branch/worktree، diff متعلق به کار و حفظ تغییرهای production/همکاران.
- یافته‌های مستقل تو و هر اصلاح این brief، با file:line.
- طرح انتخابی و چرایی آن، رفتار قبل/بعد برای یک کلاس معمولی و یک مورد مبهم.
- آزمون‌ها و دستورهای دقیق، محیط local، کیفیت frozen با مخرج و شکست‌ها، latency/resource/cost افزوده و محدودیت‌های داده.
- وضعیت privacy/deletion/revocation، بدون اسرار یا دادهٔ شخصی در گزارش عمومی.
- مسیر artifactهای قابل بررسی، migration محلی پیشنهادی و rollout/rollback در صورت نیاز.
- موارد انجام‌نشده و تصمیم/approval نهایی مشخص؛ انتشار را انجام‌شده معرفی نکن اگر منتشر نشده است.

با audit آخرین وضعیت شروع کن، یافته‌های ما را مستقل نقد کن و بهترین راه‌حل کم‌هزینهٔ قابل اعتماد را تا حد اختیار مجاز کامل کن.
