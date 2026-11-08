# برنامهٔ دستهٔ ۷ ‏L3 — Recalino ‏(P7-01 تا P7-04)

| فیلد | مقدار |
|---|---|
| نسخه | نسخهٔ 0.3.1 (2026-11-07، E168‑R: دلیل درست نوع TestPlan در §۳)؛ 0.3 (2026-11-07، همراه کارت‌ها: نوع TestPlan ‏P7-04 ‏pass_to_pass، راه پین P7-02، متن E160‑R)؛ 0.2 (2026-11-07، پس از ایست ۳۳۸ و پاسخ مالک: سه شرط بازبین، E158 = الف، Q7)؛ 0.1 (2026-11-07، پاسخ L1 به E157) |
| وضعیت | **پذیرفته (0.2، ایست ۳۴۰)؛ متن UI تأیید شد (E160‑R).** کارت‌ها و TestPlanها همراه همین برنامه در PR ‏`aeo/task-cards-17` می‌روند. هنوز هیچ Job نیست |
| بازبینی | نسخهٔ 0.1 با سه شرط پذیرفته شد (ایست ۳۳۸): فهرست قفل‌ها، سطر «شرط» ‏P7-03، متن UI ‏P7-04 پیش از PR کارت‌ها |
| پایه | Recalino ‏`main@2901521d86dae22168c85d2cae423c58b2c73740` (پس از پذیرش دستهٔ ۶، #135)؛ aeo ‏`main@6c9188a` |
| مرجع‌ها | پذیرش دستهٔ ۶ ‏`docs/aeo/l3/phase6-acceptance.md` §۶؛ جمع‌بندی دستهٔ ۶ ‏`docs/l3/phase6-closeout.md` ‏0.2 §۶-۲؛ گزارش L1 بلوک ۸۰ و خروجی Job ‏AUD-4 ‏(`job-20261103-5c69a625`، F-1 و F-2)؛ `docs/l3/phase5-plan.md` §۴ |
| قید X1 | متن کد Recalino خوانده نشد. نام فایل‌ها و تاریخچه از `git ls-tree` و `git log` روی `2901521` است. sha256 قفل‌ها از blobهای `2901521` است. متن و خط UI از خروجی Job ‏AUD-4 است |

برچسب‌ها: **Documented** (با مسیر سند) / **Observed by model** / **Not Verified**.

## ۱. هدف و مرز
- مورد دامنه: چهار کار Recalino از یافته‌های محصولی phase6-acceptance §۶ و AUD-4. سه کار فقط آزمون پین‌کننده‌اند و یک کار اصلاح کوچک UI است (E158 = الف).
- مورد اجرا (E157 §۸): اجرای دستی با همان روال دسته‌های ۱ تا ۶، تا پایان بلوک D. ‏P7-03 برای بلوک D نگه داشته می‌شود (§۲، سطر «شرط»).
- مورد بیرون از دسته (E157 §۸): پنج یافتهٔ هسته به L-dev می‌روند، نه به دستهٔ ۷. یکی از آن‌ها، `max_turns_source` در export، به‌عنوان R101 از 2026-11-07 در جریان است (استثنای مالک).
- مورد بی‌تغییر: E145 = د (موکول) و E136 بی‌تغییر. policy، registry و `write_paths` تغییر نمی‌کنند.

## ۲. فهرست و ترتیب کارت‌ها
| ترتیب | کارت | منبع | نوع | ریسک کارت | ریسک gate (برآورد) | ‏merge | ‏owns_paths | مسیر اجرا |
|---|---|---|---|---|---|---|---|---|
| گام ۱ | ‏P7-01 | ‏minor ‏code ‏P5-03، `job-20261106-f1467201` ‏(#125): شاخه‌های شرطی قالب prompt پین نیستند | test | ‏low | ‏medium | ‏D7 | `packages/core/src/proc/prompt-version.test.ts` | دستی |
| گام ۲ | ‏P7-02 | ‏minor ‏security ‏P5-04، `job-20261106-e32cf916` ‏(#126): عددهای درون‌خطی `voice-engine-quality.mjs` پین نیستند | test | ‏low | ‏medium | ‏D7 | `apps/web/src/server/voice-engine.test.ts`؛ `apps/web/src/server/voice-engine-quality.mjs` (فقط `export`) | دستی؛ Task هم‌ردیف مقایسهٔ بلوک D |
| گام ۳ | ‏P7-04 | ‏AUD-4 ‏F-1 (bug، high، confirmed، S)، `job-20261103-5c69a625`؛ E158 = الف | fix | ‏medium | ‏medium | ‏D7 | `apps/web/src/ui/workspace/file-processing.ts`، `file-processing.test.ts`، `SourcesView.tsx` | دستی |
| گام ۴ | ‏P7-03 | سند P6-01 §۱، `job-20261106-24fe2f22` ‏(#134): منطق `remapVoiceSegments` و `boundaryUnsafe` ‏(`34862cb`) پین نیست | test | ‏low | ‏medium | ‏D7 | `apps/web/src/server/voice-source-windows.test.ts` | **از راه Paperclip، بلوک D** |

- مورد **شرط P7-03** (شرط ۲ بازبین؛ Q7 مالک): P7-03 به ADR 0021، shim و نصب بسته است (بلوک‌های A تا C).
  - مورد قاعدهٔ ۵ روز: اگر ۵ روز پس از ادغام سومین Task دستهٔ ۷ ‏(P7-04) بلوک C پذیرفته نشده باشد، P7-03 دستی اجرا می‌شود. آنگاه Task اول دستهٔ ۸ جای آن را در مقایسهٔ بلوک D می‌گیرد.
  - مورد Q7: همچنان الف (موازی).
- مورد ترتیب: نخستین Task اجراشده **P7-01** است. یک Task در هر بلوک.
- مورد مقایسهٔ بلوک D: P7-02 و P7-03 هم‌ردیف‌اند: هر دو آزمون پین در `apps/web/src/server/`، ریسک low، بی کد تولیدی. رویدادهای ledger هر دو در export ‏L-bench می‌آیند. `max_turns_source` با R101 به export افزوده می‌شود.
- مورد جدایی (Observed by model، نام فایل‌ها): owns_paths چهار کارت هم‌پوشانی ندارند. هیچ TestPlan فایلی را قفل نمی‌کند که کارت دیگری آن را دارد. سنجش با اسکریپت در مرحلهٔ کارت.

## ۳. قفل هر TestPlan (شرط ۱ بازبین؛ sha256 در `2901521`)
| کارت | ‏kind | فایل قفل | ‏sha256 |
|---|---|---|---|
| ‏P7-01 | ‏pass_to_pass | `packages/core/src/proc/knowledge-generation.ts` | `c00d18ecd0fd4aecb3d70e739225c93a422f47adf7a761e86027c8fae064150c` |
| ‏P7-01 | ‏pass_to_pass | `packages/core/src/proc/study-prompt.ts` | `c7195a4fafbac6b6a17588eef1a6d6bbc4ca8c5f5c286d18c125c2c6030278d7` |
| ‏P7-01 | ‏pass_to_pass | `config/openrouter-defaults.json` | `06a6e6e305f966eedc53a02137a5f40f49c64f064bd06e7c063efb23610dd5d7` |
| ‏P7-01 | ‏pass_to_pass | `packages/core/src/proc/steps/publish.ts` | `871270bc67927c1c56431fb2461cf1d11cae8395a5ed8ab6196917c6b341970c` |
| ‏P7-02 | ‏pass_to_pass | `apps/web/src/server/voice-engine.ts` | `db46effe92f1d3abe984f751400fc790f1f3d859f0bada71af5ba2d1bbf63ad0` |
| ‏P7-02 | ‏pass_to_pass | `apps/web/src/server/audio-preparer.ts` | `768bf5b10ec1b1d049e47318c971dfdd4b4072b80ee7dbe5cdb8a628215fafef` |
| ‏P7-04 | ‏pass_to_pass | `apps/web/src/ui/workspace/learning-progress.ts` | `eff806324e9cebe14bc2aa4f007b42b37aaeb62f5f0972202346d7e319b25f62` |
| ‏P7-04 | ‏pass_to_pass | `apps/web/src/ui/workspace/AutomaticLearningView.tsx` | `f0588f0fc3cbceea30ce21529ff7b390adbc68e3bb4430ecdabe89cb1e17eb2b` |
| ‏P7-04 | ‏pass_to_pass | `apps/web/src/ui/workspace/process-session-copy.ts` | `8560fe2a4f72bb2c4c7cfeab51e3377a16e1c21a71e776da9aaed1d26f335d0e` |
| ‏P7-03 | ‏pass_to_pass | `apps/web/src/server/voice-source-windows.ts` | `96caa5bb73b36e8831dfcad427c8713c3b858bd24d8f4ddfd50f8bd6b49831ea` |
| ‏P7-03 | ‏pass_to_pass | `apps/web/src/server/voice-engine.ts` | `db46effe92f1d3abe984f751400fc790f1f3d859f0bada71af5ba2d1bbf63ad0` |

- مورد الگو: قفل‌های P7-01 همان چهار فایل P5-03 است، با همان sha256؛ پس از `7897a68` تغییر نکرده‌اند. قفل‌های P7-02 همان قفل‌های P6-04 است، جز `voice-engine-quality.mjs`: P7-02 فقط می‌تواند `export` بیفزاید.
- مورد P7-04: کارت وضعیت بالای صفحه (`AutomaticLearningView.tsx`، `learning-progress.ts`) و متن تأییدشدهٔ D107 ‏(`process-session-copy.ts`) قفل‌اند. پس اصلاح فقط در پنل feedback است.
- مورد نوع TestPlan (0.3.1): هر چهار TestPlan ‏`pass_to_pass` هستند، با قفل ورودی‌ها. schema هر دو نوع را می‌پذیرد، و فقط `refactor` در حالت brownfield یا continuation را به `pass_to_pass` محدود می‌کند (`task-card.v1.json`، `allOf`). قرارداد پروژه از دستهٔ ۱ برای کارت‌های brownfield ‏`pass_to_pass` است، با قفل ورودی‌ها و شاهد شکست در AC، چون آزمون تازه در base نیست (اصلاح E168‑R). شاهد «پیش از اصلاح شکست می‌خورد» در P7-04 معیار AC-3 کارت است (تغییر موقت Implementer)، مثل AC-3 پین‌ها.
- مورد راه پین P7-02 (0.3): عددها درون‌خطی‌اند (یافتهٔ منبع: qualifySegments، embeddingSpans و mergeVoices). پس «فقط export» خود عددها را پین نمی‌کند. کارت sha256 متن سه تابع صادرشده را همراه VOICE_MODEL_REVISION ترجیح می‌دهد، درون همان مرز. اگر ممکن نشد، Implementer ‏blocked برمی‌گرداند. همین راه برای P7-03 هم مجاز است.
- مورد P7-03: اگر طبق قاعدهٔ ۵ روز دیرتر اجرا شود، sha256 قفل‌هایش پیش از قفل TestPlan دوباره از main همان روز گرفته می‌شود.

## ۴. P7-04: رفتار و متن UI (شرط ۳ بازبین؛ E158؛ برای تأیید مالک پیش از PR کارت‌ها)
- مورد رفتار کنونی (Documented، خروجی Job ‏AUD-4 ‏F-1؛ این فایل‌ها پس از audit تغییر نکرده‌اند: `file-processing.ts` آخرین بار `cbe6719` در 2026-10-19، `SourcesView.tsx` آخرین بار `ffce0f2` در 2026-10-20):
  - مورد زنجیره: پس از «Upload & Process»، ‏`fileProcessingFeedback` حالت D107 را نمی‌شناسد (state=`waiting_sources` و processRequest برابر `not_requested` یا `new_material`). پس به شاخهٔ آخر می‌افتد (`file-processing.ts:114-122`).
  - مورد نتیجه: پنل با نوار پیشرفت نشان داده می‌شود (`SourcesView.tsx:510-527`) و صفحه مدام refresh می‌شود (`SourcesView.tsx:241-245`). کارت بالای همان صفحه «Ready to process» و دکمهٔ «Process this session» را نشان می‌دهد.
- مورد رشتهٔ موجود (بی‌تغییر می‌ماند و برای پردازش واقعی به کار می‌رود)، در `apps/web/src/ui/workspace/file-processing.ts:114-122`:
  - «Verifying and preparing your files… processing continues on the server even if you close the app. Your result appears in Notifications.»
- مورد **رشتهٔ تازه** (تنها رشتهٔ تازه؛ به زبان UI موجود، انگلیسی). جای آن یک شاخهٔ تازه در `apps/web/src/ui/workspace/file-processing.ts` است، پیش از شاخهٔ آخر (`:114`)، برای حالت D107:
  - «Your files are uploaded. To create your notes and flashcards, choose “Process this session”.»
  - مورد ارجاع: نام دکمه، «Process this session»، همان متن تأییدشدهٔ D107 است (Documented، AUD-4 ‏F-1 و F-2).
- مورد رفتار تازه: در این حالت پنل نوار پیشرفت و `aria-busy` ندارد، و polling ‏`SourcesView` ادامه نمی‌یابد (waiting=false). شاخهٔ پردازش واقعی بی‌تغییر می‌ماند.
- مورد آزمون (`pass_to_pass` با قفل؛ 0.3): در `file-processing.test.ts`، حالت D107 پیام تازه و state غیر `processing` بدهد. Implementer نشان می‌دهد این آزمون بی شاخهٔ تازه شکست می‌خورد (AC-3 کارت).
- مورد متن تأییدشده (E160‑R): همان رشتهٔ تازهٔ بالا، بی تغییر. شناسه‌های حالت D107 در کارت «نقل از ممیزی، سنجش با Implementer» آمده‌اند، نه معیار حرفی (ایست ۳۴۰).
- مورد مسیر تأیید copy (Documented، AUD-4 ‏F-2): مخزن مسیر تأیید copy دارد (`apps/web/src/ui/approved-copy.test.ts`، `docs/design/UI_COPY_PENDING.md`). اگر قاعدهٔ مخزن ثبت رشتهٔ تازه را آنجا بخواهد، کارت همان را می‌خواهد. پس این دو فایل در owns_paths می‌آیند، فقط برای افزودن همین یک رشته (Not Verified تا Job).
- مورد بیرون از P7-04: برچسب «Upload & Process» و متن‌های «automatically» ‏(AUD-4 ‏F-2) بی‌تغییر می‌مانند.

## ۵. جریان و تاریخ‌ها
- مورد 2026-11-07: نسخهٔ 0.2 به بازبین می‌رود، و رشتهٔ UI §۴ به مالک.
- مورد 2026-11-08 (مشروط به پذیرش 0.2 و تأیید متن): PR کارت‌ها روی `aeo/task-cards-17`، با چهار کارت، چهار TestPlan و `docs/aeo/l3/phase7-plan.md`. این PR ‏high است (`docs/aeo/**`) و approve مالک می‌خواهد.
- مورد **2026-11-09 = تاریخ شروع اجرا** (مشروط به approve مالک و قفل TestPlanها): Job نخست ‏P7-01. سپس P7-02 و P7-04، هر کدام در یک بلوک. این روز آغاز هفتهٔ بودجهٔ تازه است.
- مورد P7-03: طبق سطر «شرط» در §۲.
- مورد پایان: closeout دستهٔ ۷ و PR پذیرش با ستون «مسیر اجرا» (E157 §۷، بلوک E).

## ۶. بودجه
- مورد برآورد: میانگین دستهٔ ۶ برابر 1.74 دلار برای هر Task بود. پس حدود ۷ دلار برای چهار Task (برآورد، نه تعهد).
- مورد سقف: D8 بی‌تغییر است (۲۰ دلار در هر بلوک و ۱۰۰ دلار در هفته). سقف نوبت از `limits.max_turns` هر کارت می‌آید (R98).

## ۷. پیشرفت دستهٔ ۷
- مورد خط ثابت: برنامه‌ریزی‌شده ۴ / در اجرا ۰ / ادغام‌شده ۰ / blocked ‏۰؛ آخرین حرکت 2026-11-07 (کارت‌ها ‏#136 و برنامهٔ 0.3.1).
