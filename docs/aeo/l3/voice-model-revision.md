# نسخهٔ مدل صدا و اثر `e460366` ‏(P6-01)

| فیلد | مقدار |
|---|---|
| نسخه | 0.1 (2026-11-06) |
| کارت | ‏P6-01 (دستهٔ ۶ ‏L3؛ E141 = الف؛ AUD-3 ‏F-9) |
| پایه | Recalino ‏`9067b54` (پس از P6-04، P6-02 و P6-03) |
| روش | فقط خواندن کد در `9067b54` و تاریخچهٔ git (`git log`، `git show`). هیچ پرس‌وجویی روی پایگاه اجرا نشد و هیچ دادهٔ کاربر خوانده نشد |
| دامنه | فقط سند. هیچ کد، داده یا رفتاری تغییر نمی‌کند. تصمیم bump با مالک است (E145) |

برچسب‌ها:
- **Observed by model**: مدل این را در کد یا git دید. ارجاع با `مسیر:خط` در `9067b54` یا با شناسهٔ commit است.
- **Not Verified**: شاهد اجرایی یا داده‌ای پشتش نیست، یا به داده‌ای وابسته است که خوانده نشد.

## ۱. تغییرهای `e460366`
commit ‏`e460366` (2026-10-08، «pre-registered AMI evaluation and tuned class voiceprints») سه تنظیم pipeline صدا را عوض کرد. ثابت `VOICE_MODEL_REVISION` را عوض نکرد.

| تنظیم | فایل | پیش | پس | برچسب |
|---|---|---|---|---|
| `VOICE_SPAN_MODE` | `apps/web/src/server/voice-engine.ts:20` | `"whole-turns"` | `"clean-parts"` | Observed by model (`git show e460366`) |
| `VOICE_MERGE_THRESHOLD` | `apps/web/src/server/voice-engine.ts:22` | `null` | `0.65` | Observed by model (`git show e460366`) |
| `VOICE_WINDOW_PLAN` | `apps/web/src/server/voice-source-windows.ts:12` | `{ windowMs: 30000, maxWindows: 15 }` | `{ windowMs: 58000, maxWindows: 8 }` | Observed by model (`git show e460366`) |

- مورد revision ثابت: رشتهٔ `VOICE_MODEL_REVISION` در `apps/web/src/server/voice-engine.ts:11-12` فقط نسخهٔ runtime و hash دو مدل را دارد، نه تنظیمات pipeline. `git log -S` این رشته را فقط در `28447be` (2026-10-07) می‌یابد. پس پس از آن هرگز عوض نشده است (Observed by model).
- مورد `VOICE_CLUSTER_THRESHOLD`: مقدار `0.5` در `voice-engine.ts:17` در `1ba7d34` (2026-10-08، پیش از `e460366`) آمد. پیام آن commit می‌گوید پیش‌فرض‌های production بی‌تغییر ماندند. `e460366` آن را عوض نکرد (Observed by model).
- مورد اثر هر تنظیم بر voiceprint (Observed by model):
  - مورد span: worker برای هر صدا spanها را با `embeddingSpans(segments, speakerId, configuration.spanMode)` می‌سازد و بردار صدا را از pool آن‌ها (`apps/web/src/server/voice-engine-worker.mjs:89-100`). در `whole-turns` هر turn هم‌پوشان کنار گذاشته می‌شود. در `clean-parts` تکه‌های دست‌کم ۲۰۰ میلی‌ثانیه دور از صدای دیگر نگه داشته می‌شوند (`apps/web/src/server/voice-engine-quality.mjs:80-109`). پس span ‏voiceprint صدای کلاس عوض می‌شود.
  - مورد merge: با مقدار غیر null، worker پیش از ساختن voiceprint صداهای بیش‌ازحد شکسته را با `mergeVoices` یکی می‌کند (`voice-engine-worker.mjs:84-87`؛ `voice-engine-quality.mjs:149-167`). پس مرز صداها و در نتیجه بردار pool‌شده عوض می‌شود.
  - مورد پنجره: `diarizeVoiceRecording` برش‌های ضبط کلاس را با `voiceSourceWindows(durationMs, ranges, plan)` برمی‌گزیند (`apps/web/src/server/voice-processing.ts:64`؛ `voice-source-windows.ts:25-28`). پس صوتی که voiceprint صدای کلاس از آن ساخته می‌شود عوض می‌شود.
- مورد تغییرهای دیگر همان commit: `e460366` رفتار تصمیم را هم عوض کرد: هر صدای دارای voiceprint در `decideVoiceMatch` رقابت می‌کند (`packages/core/src/voc/policy.ts:138-148`)، و برش شنیداری از turn هم‌پوشان بی شریک ساخته نمی‌شود (`packages/core/src/proc/voice-processing.ts`، `acousticClips`). این‌ها بردار ذخیره‌شده را عوض نمی‌کنند (Observed by model).
- مورد تغییر بعدی بی bump: `34862cb` (2026-10-09) در `remapVoiceSegments` هر turnی را که با turn ردشدهٔ صدای دیگر در لبهٔ برش هم‌پوشان است `boundaryUnsafe` می‌کند (`voice-source-windows.ts`، تابع `remapVoiceSegments`). `embeddingSpans` هر segment ‏`boundaryUnsafe` را کنار می‌گذارد (`voice-engine-quality.mjs:89`). پس این commit هم voiceprint صدای کلاس را، بی تغییر revision، اندکی عوض می‌کند (Observed by model از کد؛ اندازهٔ اثر Not Verified).
- مورد تغییر worker پس از آن: `99c0bde` (2026-10-12) فقط `turns` گذرا را افزود (`voice-engine-worker.mjs:102-118`) و ساخت `speakers` را عوض نکرد (Observed by model، `git show 99c0bde`).
- مورد pin ‏P6-04: آزمون `voice-engine.test.ts:188-217` (`e196009`) مقدارهای کنونی `clusterThreshold`، `spanMode`، `mergeThreshold` و `windowPlan` را به همین revision پین می‌کند. پس هر تغییر بعدی این چهار مقدار بی bump شکست می‌خورد. این pin مقدارهای پس از `e460366` را پین می‌کند و گذشته را درست نمی‌کند. منطق `embeddingSpans`، `mergeVoices` و `remapVoiceSegments` را هم پوشش نمی‌دهد (Observed by model).

## ۲. برچسب‌گذاری با revision و جای سنجش آن
### ۲-۱. برچسب‌ها
- مورد منبع برچسب: موتور `modelRevision: VOICE_MODEL_REVISION` را به worker و خروجی می‌دهد (`voice-engine.ts:216` و `226`؛ `voice-engine-worker.mjs:122`). برچسب فقط همین رشته است (Observed by model).
- مورد نمونهٔ کاربر (sample): `prepareVoiceSample` بردار را از `engine.diarize` روی کل نمونه می‌گیرد و `modelRevision: engine.modelRevision` را برمی‌گرداند (`apps/web/src/server/voice-sample.ts:33-47`). route آن را با نام `modelVersion` به `saveVoiceSample` می‌دهد (`apps/web/src/server/voice-routes.ts:100-109`). `saveVoiceSample` بردار را در `voc.profile.embeddings` با `modelVersion` و `analysisId: null` ذخیره می‌کند، و `voc.profile.model_version` را هم می‌نویسد (`packages/core/src/voc/profile.ts:251-288`). نمونه از `VOICE_WINDOW_PLAN` نمی‌گذرد (Observed by model).
- مورد مرجع کلاس (lesson): پس از تأیید دستی، بردار صدای انتخاب‌شده با `modelVersion: row.model_version` و `analysisId` همان تحلیل در `voc.profile.embeddings` می‌رود، حداکثر چهار مرجع (`packages/core/src/voc/analysis.ts:820-848`). schema هر ورودی `vector`، `modelVersion`، `analysisId` و `createdAt` است (`profile.ts:28-37`؛ `packages/core/src/voc/contracts.ts:242-252`) (Observed by model).
- مورد تحلیل کلاس: `voc.analysis.model_version` از `diarization.modelRevision` می‌آید (`packages/core/src/proc/voice-processing.ts:311`؛ `analysis.ts:260`). بردارهای گذرای صداها در `private_embeddings` با انقضای ۲۴ ساعت ذخیره می‌شوند و برچسب جدا ندارند، بلکه برچسب ردیف را دارند (`analysis.ts:289-290`) (Observed by model).
- مورد feedback: جدول `voc.feedback` ستون `model_version` دارد (`packages/core/src/db/types.ts:1156-1162`)، و calibration حساب با آن فیلتر می‌شود (`packages/core/src/voc/calibration.ts:34`) (Observed by model).
- مورد enrollment: `packages/core/src/voc/enrollment.ts` فقط رضایت، lease و تلاش ثبت را نگه می‌دارد و هیچ برچسب revision ندارد (Observed by model).
- مورد نبود برچسب تنظیمات: هیچ‌جا تنظیمات pipeline (span، merge، پنجره) کنار بردار ذخیره نمی‌شود. تنها برچسب `modelVersion` است (Observed by model، از schemaهای بالا).

### ۲-۲. کدام مقایسه برابری revision را می‌سنجد
| مسیر مقایسه | جای کد | برابری revision | برچسب |
|---|---|---|---|
| رتبه‌بندی صداها با همهٔ مراجع (نمونه و lesson) | `packages/core/src/voc/matching.ts:19-43` (فیلتر در خط ۳۰) | بله: فقط ورودی‌هایی با `item.modelVersion === modelVersion` | Observed by model |
| مراجع تصمیم خودکار (`voiceReferences`) | `packages/core/src/voc/policy.ts:34-43` (خط ۳۸) | بله | Observed by model |
| policy ارزیابی‌شده در `decideVoiceMatch` | `policy.ts:136` | بله: `policy.modelVersion !== input.modelVersion` ⇒ پرسش | Observed by model |
| calibration حساب در `autoAcceptVoice` | `matching.ts:145-147`؛ `calibration.ts:34` | بله | Observed by model |
| سازگاری مرجع با نمونه (`voiceReferenceConsistency`) | `policy.ts:76-86`؛ ورودی از `voiceReferences` در `analysis.ts:817` | بله، غیرمستقیم از راه `voiceReferences` | Observed by model |
| نگه داشتن مراجع هنگام تعویض نمونه | `profile.ts:240-242` | بله | Observed by model |
| نمرهٔ turnهای تک (target-speaker) با نمونه | `analysis.ts:311-320` (خط ۳۱۹) | بله؛ بردار turn گذراست و ذخیره نمی‌شود | Observed by model |
| پیوند صداهای بخش‌های یک کلاس | `packages/core/src/voc/linking.ts:42-52` (خط ۴۶) | بله: جفت با revision متفاوت پیوند نمی‌خورد | Observed by model |
| لنگر مرجع برای بخش تأییدشده در پیوند | `analysis.ts:362-367` (خط ۳۶۵) | بله | Observed by model |
| خود cosine ‏(`voiceCosine`) | `matching.ts:3-17` | نه؛ فقط طول و متناهی بودن را می‌سنجد | Observed by model |
| enrollment | `enrollment.ts` | ربطی ندارد؛ برداری مقایسه نمی‌کند | Observed by model |

- مورد نتیجه: همهٔ مسیرهای مقایسهٔ نمونه، مرجع و پیوند برابری revision را می‌سنجند. فقط تابع پایهٔ `voiceCosine` نمی‌سنجد و همیشه از پشت یکی از این فیلترها صدا زده می‌شود (Observed by model). آزمون P6-04 همین را می‌گوید: مقایسه‌ها فقط به برابری `modelVersion` اعتماد دارند (`voice-engine.test.ts:188-189`).
- مورد پیش و پس از `e460366`: چون revision عوض نشد، بردارهای ساخته‌شده پیش از `e460366` و پس از آن یک برچسب دارند. هر فیلتر بالا آن‌ها را هم‌نسخه می‌داند. **پس اکنون با هم مقایسه می‌شوند**، اگر چنین بردارهایی در پایگاه باشند (Observed by model از کد؛ وجود آن‌ها در پایگاه Not Verified).

## ۳. اثر عملی ناسازگاری
- مورد پیش‌شرط: اثر فقط وقتی هست که بردار ذخیره‌شده‌ای از پیش از deploy ‏`e460366` باقی مانده باشد. تاریخ commit ‏2026-10-08 است. تاریخ deploy آن، و اینکه آیا کاربری پیش از آن نمونه یا مرجع ثبت کرده است، دیده نشد (Not Verified). پیام `1ba7d34` می‌گوید migration آن روی پروژهٔ cloud اعمال نشده است، و پیام `34862cb` از پیش‌نیاز migration برای merge می‌گوید. پس ممکن است پیش از `e460366` هیچ دادهٔ production نبوده باشد (Not Verified).
- مورد نمونهٔ کاربر: برای نمونه‌ای که پذیرفته شده، span تقریباً همان می‌ماند. نمونه یک صدا دارد (`voice-sample.ts:35-40`)، پس turn هم‌پوشان ندارد، و `whole-turns` و `clean-parts` روی turn بی هم‌پوشانی یکی‌اند (`voice-engine-quality.mjs:90-92`). merge فقط صداهای بیش از یکی را یکی می‌کند. نمونه‌ای که پیش‌تر دو صدا داشت رد شده بود و ذخیره نشده است. پنجره هم روی نمونه اعمال نمی‌شود. پس بردار نمونهٔ قدیمی احتمالاً همان است که اکنون ساخته می‌شود (Observed by model از کد؛ برابری عددی Not Verified).
- مورد مرجع کلاس (lesson) و تحلیل کلاس: هر سه تنظیم بر بردار صدای کلاس اثر دارند. مرجع ثبت‌شده پیش از `e460366` از span، مرز صدا و برش‌های دیگری ساخته شده است، ولی با بردار تازهٔ کلاس مقایسه می‌شود (`matching.ts:28-34`؛ `policy.ts:53-70`). اثر احتمالی: نمرهٔ رتبه‌بندی جابه‌جا می‌شود و صدای پیشنهادی (`candidate_id`) ممکن است عوض شود (Observed by model از کد؛ اندازهٔ جابه‌جایی Not Verified).
- مورد پذیرش خودکار: `VOICE_ACCEPTANCE_POLICIES` خالی است (`packages/core/src/voc/policy-registry.ts:10`). پس `decideVoiceMatch` با `policy_unavailable` می‌پرسد (`policy.ts:136-137`)، و `voiceReferenceConsistency` بی policy ‏`"unchecked"` می‌دهد (`policy.ts:81`). تنها راه پذیرش خودکار calibration خود حساب است (`analysis.ts:236-249`). آن calibration دست‌کم ۲۰ کلاس تأییدشده و ۲۰ کلاس ردشده از همان revision می‌خواهد (`matching.ts:125`). نمره‌های feedback پیش و پس از `e460366` زیر یک برچسب جمع می‌شوند (`calibration.ts:34`)، پس آستانهٔ calibration ممکن است از دو توزیع آمده باشد (Observed by model از کد). اینکه حسابی به ۲۰ و ۲۰ رسیده باشد Not Verified است، چون پایگاه خوانده نشد.
- مورد پیوند: پیوند در یک کلاس، بردار زندهٔ هر بخش (کمتر از ۲۴ ساعت) یا لنگر مرجع بخش تأییدشده را به کار می‌برد (`analysis.ts:359-379`). اگر کلاسی بخشی تأییدشده پیش از `e460366` و بخشی تازه پس از آن داشته باشد، لنگر قدیمی با بردار تازه پیوند می‌خورد، با آستانهٔ ۰٫۶۵ و حاشیهٔ ۰٫۰۵ (`linking.ts:20-21`). اثر: پیوند خطا یا علامت ambiguous ممکن است (Observed by model از کد؛ وجود چنین کلاسی Not Verified).
- مورد merge در تحلیل‌های تازه: پس از `e460366`، شمار صداها در یک بخش ممکن است کمتر از پیش باشد. پس ردیف‌های تحلیل پیش و پس از آن برای یک ضبط شکل نامزد متفاوتی دارند. این بر بردار ذخیره‌شده اثر ندارد، فقط بر فهرست نامزدها (Observed by model از کد).
- مورد ایمنی: هیچ مسیری بی تأیید کاربر یا calibration کامل حساب صدایی را خودکار نمی‌پذیرد. پس بدترین اثر محتمل پیشنهاد یا پیوند نادرست است، نه پذیرش خودکار نادرست، مگر برای حسابی با calibration کامل (Observed by model از کد).

## ۴. گزینه‌ها برای مالک (E145)
| گزینه | چه می‌شود | پیامد | برچسب |
|---|---|---|---|
| الف: bump ‏`VOICE_MODEL_REVISION` و ضبط دوبارهٔ نمونه | رشتهٔ revision عوض می‌شود (مثلاً با پسوند تنظیمات) و pin ‏P6-04 با آن به‌روز می‌شود | هر مرجع، نمونه، calibration و لنگر پیوند با revision قدیم از همهٔ مقایسه‌ها بیرون می‌رود (فیلترهای §۲-۲). کاربر باید نمونه را دوباره ضبط کند و کلاسی را دوباره تأیید کند تا مرجع بسازد. calibration حساب از صفر شروع می‌شود. `getVoiceProfile` با revision تازه `needs_sample` نشان می‌دهد (`profile.ts:84-123`). تحلیل‌های قدیم با revision قدیم می‌مانند ولی با مرجع تازه مقایسه نمی‌شوند | Observed by model از کد؛ شمار کاربران اثرپذیر Not Verified |
| ب: نگه داشتن، بی bump | هیچ تغییری؛ pin ‏P6-04 از این پس تغییر بی bump را می‌گیرد | تجربهٔ کاربر بی‌تغییر است. ناسازگاری §۳ برای هر مرجع و calibration قدیمی می‌ماند. اگر پیش از deploy ‏`e460366` دادهٔ production نبوده، اثری نیست | Observed by model از کد؛ وجود داده Not Verified |
| ج: نخست شمارش فقط‌خواندنی، سپس الف یا ب | کارت جدا برای شمارش تجمیعی (پایین) | تصمیم الف یا ب بر عدد تکیه می‌کند. هزینه: یک کارت DB با بازبینی امنیتی، چون داده بیومتریک است | پیشنهاد؛ Not Verified |

- مورد پیشنهاد مدل (تصمیم با مالک): گزینهٔ ج پیش از الف. اگر شمار ورودی‌های پیش از deploy صفر است، ب کافی است. وگرنه الف، و bump باید `34862cb` را هم پوشش دهد (Not Verified تا شمارش).
- مورد شکل شمارش فقط‌خواندنی (برای کارت بعدی؛ در این کارت اجرا نشد):
  - مورد خروجی: فقط عددهای تجمیعی، بی `user_id`، بی بردار و بی شناسهٔ تحلیل.
  - مورد شمار ۱: شمار ردیف‌های `voc.profile` با `enabled = true`، به تفکیک `model_version`.
  - مورد شمار ۲: شمار ورودی‌های `voc.profile.embeddings`، به تفکیک `modelVersion`، نوع (`analysisId` تهی یعنی نمونه، وگرنه مرجع) و `createdAt` پیش یا پس از زمان deploy ‏`e460366`.
  - مورد شمار ۳: شمار ردیف‌های `voc.feedback` و `voc.analysis` به تفکیک `model_version` و پیش یا پس از همان زمان.
  - مورد زمان مرز: زمان deploy ‏`e460366` و `34862cb` را مالک یا log deploy باید بدهد. تاریخ commit جایگزین آن نیست (Not Verified).
  - مورد جا: `voc` فایل job دوره‌ای ندارد (phase6-plan §۴). پس کارت بعدی یک فرمان operator فقط‌خواندنی می‌خواهد، با owns_paths و بازبینی امنیتی جدا.
