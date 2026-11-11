# برنامهٔ دستهٔ ۱۱ ‏L3 — Recalino (پیش‌نویس)

| فیلد | مقدار |
|---|---|
| نسخه | نسخهٔ 0.4 (2026-11-11، E268 و E269‑R: کارت P11-07 ‏investigate؛ §۳، §۴، §۸ و §۱۰)؛ 0.3 (sha256 ‏`dae8d1be…`؛ E263‑R: کارت P11-03 ‏v2، C11-2، §۹)؛ 0.2 (sha256 ‏`7ef09fd1…`؛ E249‑R: پاسخ شش پرسش؛ قاعدهٔ قفل؛ دور اول P11-03 تا P11-05 با کارت و TestPlan، §۶ و §۷)؛ 0.1 (sha256 ‏`7c6a1c7c…`؛ پذیرفته با شرط) |
| وضعیت | **0.1 با شرط پذیرفته شد (E249‑R).** کارت‌ها و TestPlanهای دور اول (P11-03، P11-04، P11-05) در دفتر، برای پیش‌سنجی بازبین. کارت‌های دور دوم (P11-01، P11-02، P11-06) اکنون نوشته نمی‌شوند. هیچ Job و PR تا پیش‌سنجی |
| پایه | Recalino ‏`main@8742a9aec7af3a26691cf114f7b750af052c5b5d` (پس از P10-06، #163)؛ aeo ‏`main@90964c2` |
| مرجع‌ها | `docs/l3/phase10-findings-candidates.md` (C10-1 تا C10-6 و نامزد تابع PLT)؛ `docs/l3/phase9-findings-candidates.md` (C9-9، C9-12، C9-13)؛ `docs/l3/phase8-findings-candidates.md` (C8-6)؛ `docs/l3/audit/P10-01.*`؛ `docs/l3/phase10-closeout.md` ‏0.2؛ `docs/l3/adr-0003-amendment-draft.md` ‏0.1 |
| قید X1 | متن کد Recalino خوانده نشد. نام فایل‌ها از `git ls-tree` روی `8742a9a` است. مسیرها، شماره‌خط‌ها و گزینه‌های اصلاح از خروجی Jobهاست. ریسک از `policy/risk-rules.yaml` در aeo ‏`90964c2` |
| قاعدهٔ مالک | ‏E152: یافته‌ها فقط با منبع. ترتیب §۴ پیشنهاد L1 است و تصمیمش با بازبین |
| تاریخ‌ها | همه برآوردند (E172)، نه شرط |

## ۱. هدف و مرز
- مورد هدف: بستن ریشهٔ هم‌روندی job پس از از دست رفتن lease (C10-1) و پیامدهای آن (C8-6، C9-9، C9-13، C10-3، C10-5)، به شرط پذیرش اصلاحیهٔ ADR-0003؛ و بستن نامزدهای مستقل C10-4، C10-6 و تابع PLT.
- مورد مرز:
  - هیچ تغییری در `docs/adr/**` مخزن تا تصمیم مالک (E233؛ کلاس ۳؛ `architecture-decisions` ‏high).
  - هیچ migration، تغییر schema یا داده (کلاس ۱).
  - هیچ پاک‌سازی دسته‌جمعی hold یا شیء موجود.
- مورد بیرون از این دسته: P8-01 (بلوک D یا Q7 از 2026-11-13 ‏14:14 UK)، تحلیل L-bench دسته‌های ۸ تا ۱۰، و OQهای باز.

## ۲. دسته‌بندی نامزدها (فقط با منبع)
| نامزد | منبع | دسته | یادداشت |
|---|---|---|---|
| ‏C10-1 | P10-01، F-1 | Task‌شدنی، وابسته به ADR | fencing در `plt/jobs.ts`؛ گزینه‌ها در `adr-0003-amendment-draft.md` §۲ |
| ‏C10-2 | P10-01، F-7 | کلاس ۳ | خودِ اصلاحیهٔ ADR-0003؛ سند جدا، نزد بازبین ساختاری |
| ‏C8-6 | P8-02، F-6؛ P10-01، F-2 | Task‌شدنی، وابسته به C10-1 | پاسخ پولی worker بازپس‌گرفته؛ رفع ریشه با fencing در `providerStep` |
| ‏C9-9 | review:security ‏P9-03؛ P10-01، F-3 | Task‌شدنی | گزینهٔ محلی در media، یا رفع ریشه با C10-1 |
| ‏C9-13 | بازبینی P9-05؛ P10-01، F-5 | Task‌شدنی، پس از C10-1 | usage واقعی در مسیر تحمل؛ گزینه‌ها: update همان ردیف یا بیشینهٔ دو مقدار |
| ‏C10-3 | بازبینی معماری P10-01 ذیل F-3 | Task‌شدنی | `confirmObject` شمار ردیف را بسنجد (`plt/storage.ts`) |
| ‏C10-5 | review:security ‏P10-03 | Task‌شدنی | update شرطی `state = 'pending'` در علامت deleted |
| نامزد تابع PLT | E239‑R | Task‌شدنی | علامت deleted بی حذف bytes در `plt/storage.ts`؛ جایگزین wrapper ‏`byteDeleteFailureLogged` |
| ‏C10-4 | review:security ‏P10-02 | Task‌شدنی، مستقل | رد `actualMicros` غیر null در مسیر hold_maximum |
| ‏C10-6 | review:security ‏P10-04 | Task‌شدنی، مستقل | آزمون int ‏reconcile چندکاربره بی گزینهٔ `userId` |
| ‏C9-12 | P10-01، F-4 | بدهی | نارسیدنی در main؛ هر دو Job: «Task فوری لازم نیست» |
| ‏C11-1 | بازبینی‌های P11-05 | test-robustness، بی Task | ناپایداری احتمالی پاس دوم آزمون C10-6 (`phase11-findings-candidates.md`) |
| ‏C11-2 | implement ‏P11-03 ‏a1 (E263‑R) | Task‌شدنی، دامنهٔ P11-02/ADR-0004 یا دستهٔ ۱۲ | علامت deleted بی‌شرط در catchهای `writeOwnedObject` و `composeOwnedObjects`؛ هم‌راستا نیست با V3-06 |

## ۳. Taskهای پیشنهادی
| کارت | منبع | نوع | ریسک کارت (برآورد) | ریسک gate (برآورد) | ‏owns_paths (برآورد؛ نام از ls-tree) | TP-1 و قفل‌ها (پیشنهاد) |
|---|---|---|---|---|---|---|
| ‏P11-01 (دور دوم) | C10-1 | bugfix (هسته) | high (E249‑R، پرسش ۲ = ب؛ approve مالک) | medium | `packages/core/src/plt/jobs.ts`، `plt/jobs.test.ts`، `plt/jobs.int.test.ts` | TP-1 ‏`proc/maintenance.test.ts`؛ قفل: `proc/steps/runtime.test.ts`، `plt/storage.ts` |
| ‏P11-02 (دور دوم) | C8-6، C9-13 (بخش fencing) | bugfix | medium | medium | `packages/core/src/proc/steps/runtime.ts`، و آزمون int پیشنهادی F-2 در `priv/media.int.test.ts` یا آزمون تازه | TP-1 ‏`plt/jobs.test.ts` (پس از P11-01)؛ قفل: `plt/jobs.ts`، `plt/storage.ts` |
| ‏P11-03 (دور اول) | C10-3، C10-5، نامزد تابع PLT | bugfix | medium | medium | `packages/core/src/plt/storage.ts`، `plt/storage.int.test.ts`، `media/assets.ts` و `media/index.ts` (فقط export، اگر لازم شد) | قفل‌های دور اول (§۶) |
| ‏P11-04 (دور اول) | C10-4 | bugfix | low | medium | `packages/core/src/quota/costs.ts`، `quota/costs.int.test.ts` | قفل‌های دور اول (§۶) |
| ‏P11-05 (دور اول) | C10-6 | test | low | medium | `packages/core/src/priv/media.int.test.ts` | قفل‌های دور اول (§۶) |
| ‏P11-06 (اختیاری) | C9-13 (usage واقعی) | bugfix | medium | medium | `packages/core/src/quota/costs.ts`، و به‌روزرسانی عمدی `proc/steps/runtime.test.ts:887-893` (به گفتهٔ F-5) | پس از P11-02؛ TestPlan جدا، چون یک آزمون قفل‌شدهٔ پیشین را عمداً تغییر می‌دهد |
| ‏P11-07 (investigate) | E268 شرط ۵؛ ADR-0004 ‏0.3 §۴ و §۶؛ J2 ‏F-2 و F-4 | investigate (audit، فقط‌خواندنی) | low | — | ندارد (`docs/aeo/audit/**` مانند P10-01)؛ خروجی `docs/l3/audit/P11-07.report.json` (دفتری) | ندارد (R92، audit معاف) |

- مورد شمار: ۵ Task، و ۱ Task اختیاری.
- مورد ریسک gate: هیچ‌کدام از owns زیر قاعدهٔ high نیست (`plt/**`، `quota/**`، `proc/**`، `priv/**` فقط `default-medium`). کارت‌های low در gate به medium می‌رسند (C5)، مانند دستهٔ ۱۰. اگر diff الگوی `sql-destructive` داشته باشد، high می‌شود.
- مورد هم‌پوشانی قفل‌ها (0.2): قاعدهٔ E249‑R آن را حل کرد: هیچ فایل owns یک کارت در TestPlan کارت هم‌دور قفل نمی‌شود (§۶). ستون قفل‌های 0.1 برای دور دوم فقط برآورد است. درس دستهٔ ۱۰: مسیر کامل در هر قفل.
- مورد اندازه:
  - P11-01: بزرگ‌ترین؛ API تازه روی JobContext، شرط توکن در `runJobStep`، ساعت پایگاه داده، timeout تمدید. effort ‏M در هر دو Job.
  - P11-02: سنجش leaseLost پیش از dispatch و commit در `providerStep`، و ثبت رویداد پاسخ دیرهنگام فقط با شناسه.
  - P11-03: update شرطی و شمار ردیف در `plt/storage.ts`، و تابع علامت deleted بی حذف bytes. اگر `media/assets.ts` هم در owns باشد، wrapper ‏P10-03 با تابع تازه جایگزین می‌شود.
- مورد برآورد هزینه (روند دستهٔ ۱۰): Task بی rework ‏1.4 تا 1.8 دلار؛ با rework تا 5.7 دلار. P11-01 و P11-02 بزرگ‌ترند: هر کدام 3 تا 8 دلار. جمع: حدود 15 تا 30 دلار. هفتهٔ D8 تا 2026-11-16 ‏40.13 دلار مصرف دارد؛ بخشی از دسته شاید به هفتهٔ بعد برود.

## ۴. ترتیب (پیشنهاد L1؛ تصمیم با بازبین)
1. P11-04 (C10-4): کوچک و مستقل. در همان زمانی که اصلاحیهٔ ADR نزد بازبین ساختاری است.
2. P11-05 (C10-6): کوچک و مستقل؛ owns مشترکی با دیگران ندارد.
3. P11-03 (storage): مستقل از ADR، ولی پیش از قفل TestPlanهای P11-01 و P11-02، چون `plt/storage.ts` را تغییر می‌دهد.
4. P11-01 (fencing در PLT): فقط پس از پذیرش اصلاحیهٔ ADR-0003 به‌دست مالک.
5. P11-02 (fencing در providerStep): پس از ادغام P11-01.
6. P11-06 (اختیاری): پس از P11-02، اگر بودجه بماند.
7. P11-07 (investigate، E268 شرط ۵): موازی با پیش‌نویس ADR-0004 ‏0.3 و مستقل از پذیرش آن؛ پس از PR کارت آن. ورودی کارت‌های بازیابی دستهٔ ۱۲.

## ۵. پرسش‌ها برای بازبین (هر کدام با گزینه)
- مورد پرسش ۱، مسیر ADR: الف) fencing؛ ب) at-least-once صریح؛ ج) ترکیب (پیشنهاد L1). پرسش اصلی نزد بازبین ساختاری است؛ این‌جا فقط برای ترتیب.
- مورد پرسش ۲، ریسک کارت P11-01: الف) medium، با D7 پس از gate؛ ب) high، با approve مالک، چون هستهٔ هم‌روندی است (پیشنهاد L1).
- مورد پرسش ۳، دامنهٔ P11-03: الف) فقط `plt/storage.ts` و آزمون آن؛ wrapper ‏P10-03 می‌ماند؛ ب) همراه `media/assets.ts` و جایگزینی wrapper با تابع تازه (پیشنهاد L1، چون یک مسیر واحد می‌ماند).
- مورد پرسش ۴، C9-13: الف) در P11-02، فقط بخش fencing؛ usage واقعی در P11-06 (پیشنهاد L1)؛ ب) هر دو در P11-02.
- مورد پرسش ۵، آزمون بازتولید F-2: الف) آزمون int پیشنهادی Job در P11-02، که پس از اصلاح سبز است (پیشنهاد L1)؛ ب) یک investigate جدا پیش از P11-02.
- مورد پرسش ۶، ترتیب با P8-01: الف) Taskهای مستقل (P11-04، P11-05، P11-03) پیش از Q7، و P8-01 در زمان خود؛ ب) P8-01 نخست.

## ۶. کارهای باز مالک (یادآوری)
- مورد اصلاحیهٔ ADR-0003: پیش‌نویس `docs/l3/adr-0003-amendment-draft.md` ‏0.1 را مالک به بازبین ساختاری می‌دهد (E233).
- مورد قفل TestPlanها: پس از PR کارت دستهٔ ۱۱ (R92).
- مورد پاک‌سازی worktreeها و شاخه‌ها: فرمان مالک از بازبین (کلاس ۵)؛ L1 چیزی حذف نمی‌کند.

## ۶. تصمیم‌های 0.2 (E249‑R، ایست ۴۷۰)
- مورد پاسخ پرسش ۱: فرض ترتیب = ترکیب؛ تصمیم ADR با بازبین ساختاری و مالک (E250).
- مورد پاسخ پرسش ۲: ب. کارت P11-01 ‏high، با approve مالک در PR.
- مورد پاسخ پرسش ۳: ب. P11-03 همراه `media/assets.ts` و جایگزینی wrapper ‏`byteDeleteFailureLogged` با تابع PLT. سه آزمون C9-15 ‏P10-03 و آزمون C9-16 ‏P10-04 بی‌تغییر و سبز؛ رفتار B حفظ.
- مورد پاسخ پرسش ۴: الف. P11-02 فقط بخش fencing ‏C9-13؛ usage واقعی در P11-06.
- مورد پاسخ پرسش ۵: الف. آزمون int ‏F-2 در P11-02، با شاهد شکست پیش از اصلاح.
- مورد پاسخ پرسش ۶: الف. Taskهای مستقل دور اول پیش از Q7؛ P8-01 در زمان خود.
- مورد قاعدهٔ قفل: هیچ فایل owns یک کارت در TestPlan کارت هم‌دور قفل نمی‌شود.
- مورد دور اول: P11-03، P11-04 و P11-05. هر سه با TP-1 ‏`packages/core/src/proc/maintenance.test.ts` و قفل‌های:
  - `packages/core/src/proc/maintenance.test.ts` ‏(`af8cb3b1…`)؛
  - `packages/core/src/ops/admin-tasks.test.ts` ‏(`53168072…`)؛
  - `packages/core/src/proc/steps/runtime.test.ts` ‏(`759e18ce…`).

  ‏sha256 از `main@8742a9a`. هیچ‌کدام در owns کارت‌های دور اول نیست.
- مورد ترتیب اجرای دور اول: P11-04 ⇒ P11-05 ⇒ P11-03، هر کدام با «شروع» جداگانه.

## ۷. کارت‌ها و TestPlanهای دور اول (0.2؛ Observed by model)
| فایل | نوع / ریسک | owns | ACها |
|---|---|---|---|
| ‏`P11-03.json` | bugfix / medium | `plt/storage.ts`، `plt/storage.int.test.ts`، `media/assets.ts`، `media/index.ts` | AC-1 علامت deleted شرطی (pending) و شمار ردیف؛ AC-2 شمار ردیف در `confirmObject`؛ AC-3 تابع PLT بی حذف bytes و جایگزینی wrapper، رفتار B حفظ؛ AC-4 آزمون‌های int تازه و آزمون‌های موجود بی‌تغییر؛ AC-5 شاهد و قفل؛ AC-8؛ AC-9؛ AC-10 فقط export |
| ‏`P11-04.json` | bugfix / low | `quota/costs.ts`، `quota/costs.int.test.ts` | AC-1 رد `actualMicros` غیر null در hold_maximum بی نوشتن ردیف؛ AC-2 رفتار موجود و آزمون P10-02 بی‌تغییر؛ AC-3 آزمون تازه با شاهد شکست؛ AC-5؛ AC-8؛ AC-9 |
| ‏`P11-05.json` | test / low | `priv/media.int.test.ts` | AC-1 آزمون reconcile چندکاربره بی `userId`؛ AC-2 بی کد تولیدی، ۲۰ آزمون موجود بی‌تغییر، درس‌های fixture (session جدا، kind جدا)؛ AC-3 شکست ⇒ blocked؛ AC-5؛ AC-8؛ AC-9 |

- مورد مشترک: `max_turns` ‏60، `max_rework_rounds` ‏1، `install_assets` ‏ffmpeg-static، `context_refs` ‏`docs/aeo/l3/phase11-plan.md`؛ TestPlan ‏`pass_to_pass` با `pnpm test:unit` روی `8742a9a`.
- مورد PR کارت: پس از پیش‌سنجی بازبین. شش فایل `docs/aeo/tasks/P11-03` تا `P11-05` (کارت و TestPlan) و `docs/aeo/l3/phase11-plan.md`. ریسک high (`docs/aeo/**`)، پس approve مالک. سپس قفل سه TestPlan به‌دست مالک (R92).

## ۸. دور دوم (پس از تصمیم ADR مالک)
- مورد P11-01: کارت high پس از پذیرش Recalino ADR-0004 (E257 و E268؛ جانشین «اصلاحیهٔ ADR-0003»)؛ owns ‏`plt/jobs.ts` و آزمون‌های آن؛ قفل‌ها بیرون از owns.
- مورد P11-02: پس از ادغام P11-01؛ قفل `plt/jobs.test.ts`؛ آزمون int ‏F-2 با شاهد شکست پیش از اصلاح.
- مورد P11-06 (اختیاری): usage واقعی C9-13؛ TestPlan جدا، چون `proc/steps/runtime.test.ts:887-893` را عمداً تغییر می‌دهد.
- مورد زمان نوشتن: کارت‌های دور دوم اکنون نوشته نمی‌شوند.

## ۹. کارت P11-03 ‏v2 (0.3؛ E263‑R)
- مورد علت: attempt 1 ‏(`job-20261111-2a86f358`، JobBlocked ‏6486) با commit ‏`d36d133` (push نشده) ایستاد. آزمون unit موجود `plt/storage-compose-module.test.ts` با fake DB که برای هر update صفر ردیف برمی‌گرداند با AC-2 جور نبود.
- مورد تصمیم E263‑R: پرسش ۱ = بله (owns + `plt/storage-compose-module.test.ts`، فقط رفتار fake برای update؛ بی تغییر assertion؛ شمار آزمون ۴)؛ پرسش ۲ = شکل کنونی (`deleteObject` با `pendingOnly` و `onByteDeleteFailure`؛ بی owns تازه برای `plt/index.ts`). انحراف void ⇒ boolean پذیرفته. انحراف (ج) ⇒ C11-2.
- مورد تغییر کارت: owns ‏۴ ⇒ ۵؛ AC-3 بازنویسی به شکل پذیرفته؛ AC-4 + قید fake؛ assumptions ‏۸ ⇒ ۹ (بند v2). AC-1، AC-2، AC-5، AC-8، AC-9 و AC-10 بی‌تغییر. TestPlan بی‌تغییر (`fcbfcc45…`، قفل 6413)؛ owns∩قفل تهی.
- مورد ورودی attempt 2: `docs/l3/cards/P11-03.rework-2.md` با `--rework-findings`، روی همان worktree از `d36d133`. این ادامهٔ blocked است، نه دور rework؛ دور یگانهٔ rework برای یافته‌های CI یا بازبینی می‌ماند.

## ۱۰. کارت P11-07 ‏investigate (0.4؛ E268 و E269‑R)
- مورد تصویب: مالک (E268 شرط ۵) investigate فقط‌خواندنی پیش از کارت‌های بازیابی دستهٔ ۱۲ را همین حالا تصویب کرد؛ منتظر پذیرش ADR-0004 نمی‌ماند.
- مورد کارت: `P11-07.json`؛ نقش auditor.debt؛ بازبینی reviewer.architecture با `--step audit --context` در صورت نیاز (مانند P10-01)؛ max_turns ‏80؛ بی TestPlan (R92)؛ task_type ‏docs و owns ‏`docs/aeo/audit/**` مانند P10-01، چون schema ‏task-card/v1 ‏investigate ندارد و owns خالی نمی‌پذیرد.
- مورد AC (پنج خروجی عین شرط ۵): AC-1 نگهداری یا بازیابی خروجی بی پرداخت تازه برای هر مسیر provider؛ AC-2 هویت عملیات و حدود idempotency؛ AC-3 حالت «نتیجهٔ نامعلوم»؛ AC-4 مسیر تحویل نتیجهٔ worker کهنه به عامل دارای اختیار تازه؛ AC-5 اثر settle دیرهنگام بر فرض‌های J2/F-4؛ AC-6 جمع‌بندی هر مسیر؛ AC-7 (E271‑R) سازوکار مانع استقرار: بستن پذیرش کار تازه در نسخهٔ قدیم و اثبات توقف اجراهای قدیم (ADR-0001، مسیر Cron، maxDuration)، ورودی طراحی P11-01؛ AC-8 و AC-9 معمول.
- مورد ترتیب: موازی با ADR-0004 ‏0.3؛ پس از PR کارت (high، approve مالک)؛ base ‏main روز اجرا.
