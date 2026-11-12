# برنامهٔ دستهٔ ۱۱ ‏L3 — Recalino (پیش‌نویس)

| فیلد | مقدار |
|---|---|
| نسخه | نسخهٔ 0.12 (2026-11-11، E287‑R: پیش‌سنجی v6: ADR نهایی، چهار کارت و برنامهٔ 0.11 پذیرفته؛ قفل‌های TestPlan ‏P11-02 و P11-08 بی فایل‌های owns کارت‌های پیشین و بی تازه‌سازی؛ قید متنی E283 در P11-08؛ `plt/index.ts` ‏P11-01 پذیرفته؛ §۱۶ به‌روز)؛ 0.11 (sha256 ‏`5bd138e8…`؛ E286‑R: حکم بازبین ساختاری بر ADR-0004 ‏0.6 = پذیرفته؛ E274 بر 0.6 و فایل نهایی ADR؛ E283 = الف و E284 = الف ⇒ PR سیاست aeo ‏#110؛ کارت‌های v6 نهایی و TestPlan ‏P11-08؛ §۱۵ به پیشینه؛ §۱۶)؛ 0.10 (sha256 ‏`a4a71572…`؛ E285‑R: پیش‌سنجی ADR ‏0.6 پذیرفته با اصلاح §۵؛ 0.6 در inbox؛ جملهٔ ردیف‌های NULL در P11-01 ‏AC-6؛ تفسیر حالت (۴) P11-08 ‏AC-6 پذیرفته؛ §۱۵ به‌روز)؛ 0.9 (sha256 ‏`90c7a148…`؛ ایست‌های ۵۱۳ و ۵۱۴: حکم بازبین ساختاری بر delta ‏0.5 (رد)؛ ADR ‏0.6؛ دستورهای مالک: E282 = الف، سه حالت آزمون، ADR-0002 به inbox، هیچ PR کارت دور دوم تا حکم 0.6؛ کارت‌های v5؛ E283 و E284 معلق؛ §۱۵)؛ 0.8 (sha256 ‏`f40567db…`؛ ایست ۵۱۲: E274 و E279 مالک؛ کارت‌های v4 با سه اصلاح E281‑R و قیدهای E279؛ ADR در context_refs؛ E282 معلق؛ §۱۴)؛ 0.7 (sha256 ‏`6de07698…`؛ E280‑R: ساختار دور دوم پس از P11-07 و بازبینی معماری آن: کارت migration ‏P11-09، P11-01 ‏v3، P11-02 ‏v3 با نوشتن‌های دامنه، P11-08؛ §۱۱ پیشینه؛ §۱۳)؛ 0.6 (sha256 ‏`62519a0d…`؛ E276‑R: پاسخ Q-1 تا Q-5؛ کارت‌های v2؛ §۱۲)؛ 0.5 (sha256 ‏`8bf0bfce…`؛ E275‑R: پیش‌نویس دفتری کارت‌ها و TestPlanهای دور دوم؛ §۸ و §۱۱)؛ 0.4 (sha256 ‏`ff4ddccb…`؛ E268 و E269‑R: کارت P11-07 ‏investigate؛ §۳، §۴، §۸ و §۱۰)؛ 0.3 (sha256 ‏`dae8d1be…`؛ E263‑R: کارت P11-03 ‏v2، C11-2، §۹)؛ 0.2 (sha256 ‏`7ef09fd1…`؛ E249‑R: پاسخ شش پرسش؛ قاعدهٔ قفل؛ دور اول P11-03 تا P11-05 با کارت و TestPlan، §۶ و §۷)؛ 0.1 (sha256 ‏`7c6a1c7c…`؛ پذیرفته با شرط) |
| وضعیت | **0.1 با شرط پذیرفته شد (E249‑R).** دور اول (P11-03، P11-04، P11-05) ادغام شد (`main@0b82c9f`). PR کارت P11-07 ادغام شد (#169، `main@7cc035d`)؛ audit ‏P11-07 و بازبینی معماری آن انجام و پذیرفته شد (E277‑R، E280‑R)؛ نامزدهای C11-6 تا C11-13. Recalino ADR-0004 ‏0.3 را بازبین ساختاری در سطح تصمیم معماری پذیرفت؛ 0.4 تحریری؛ **0.5 محتوایی** (E280‑R؛ delta: بند 2 شرط چهارم، بند 3، بند 4، یادداشت F-10). **حکم بازبین ساختاری بر delta ‏0.5: رد ⇒ ADR ‏0.6؛ حکم بر 0.6: پذیرفته (2026-11-11؛ بی یافته، بی شرط؛ §۱۶).** E274 بر 0.6 جاری است: فایل نهایی `docs/l3/adr-0004-job-lease-fencing.md` ‏(`86ff32da…`) در inbox. E279 = الف/الف؛ E282 = الف با قید؛ E283 = الف؛ E284 = الف ⇒ PR سیاست aeo ‏#110 (diff در inbox؛ منتظر حکم بازبین ساختاری و approve مالک). کارت‌های دور دوم v6 نهایی (همه high؛ پیش‌سنجی‌شده، E287‑R) و TestPlan ‏P11-08 در دفترند (§۱۶)؛ **PR کارت‌ها (+ ADR) پس از merge ‏#110؛ تا آن وقت هیچ Job و هیچ PR در Recalino** |
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
- مورد وضعیت (0.5): کارت‌ها و TestPlanهای P11-01 و P11-02 پیش‌نویس دفتری‌اند (§۱۱). بندهای زیر پیشینهٔ 0.4 است.
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

## ۱۱. دور دوم: پیش‌نویس کارت‌های P11-01 و P11-02 (0.5؛ E275‑R) — پیشینه (جانشین: §۱۲ و §۱۳)
- مورد وضعیت ADR: Recalino ADR-0004 ‏0.3 ‏(`aa5b0a37…`) را بازبین ساختاری در سطح تصمیم معماری پذیرفت؛ هیچ blocker، major یا minor؛ یک nit ‏(R2-R0004-04) که در 0.4 تحریری ‏(`f6f56949…`) رفع شد. **E274 باز** (Q5-1 پذیرش رسمی 0.4؛ Q5-2 جای ثبت: در PR کارت‌های دور دوم یا PR جدا).
- مورد P11-07: audit روی `main@7cc035d` در جریان. خروجی AC-7 ورودی Q-1 تا Q-3 است.
- مورد پایه: نام فایل‌ها از `git ls-tree` و sha256 قفل‌ها از `git show` روی `main@7cc035d` (Observed by model). sha256 چهار قفل دور اول بی‌تغییر است.

| فایل | نوع / ریسک | owns | قفل‌های TestPlan | پیوند با ADR-0004 |
|---|---|---|---|---|
| `P11-01.json` | bugfix / high (E249‑R پرسش ۲ = ب) | `plt/jobs.ts`، `plt/jobs.test.ts`، `plt/jobs.int.test.ts` | TP-1 ‏`proc/maintenance.test.ts`؛ قفل: `proc/maintenance.test.ts`، `ops/admin-tasks.test.ts`، `proc/steps/runtime.test.ts`، `plt/storage-compose-module.test.ts` | بندهای 2، 3 و 4؛ V3-01 (بخش PLT)، V3-02، V3-03، V3-07؛ چهار حالت لازم E268 |
| `P11-02.json` | bugfix / medium | `proc/steps/runtime.ts`، `plt/storage.ts`، `plt/storage.int.test.ts`، `media/assets.ts`، `priv/media.int.test.ts` | TP-1 ‏`plt/jobs.test.ts`؛ قفل: `plt/jobs.test.ts`، `plt/jobs.int.test.ts`، چهار قفل P11-01 (تازه‌سازی پس از ادغام P11-01) | بندهای 4 و 6؛ V3-01 (بخش provider)، V3-04 (رد commit)، V3-06 (مرز اختیار)؛ C11-4 |

- مورد ACهای P11-01: AC-1 اختیار با چهار شرط (running، توکن برابر، `lease_until > now()`، نسل کنونی) و ابطال بی استثنا؛ AC-2 ‏completeJob و failJob زیر همان guard؛ AC-3 ساعت SQL در هر چهار منبع زمان در یک تغییر؛ AC-4 timeout تمدید و بی‌اثری پاسخ دیرهنگام؛ AC-5 بررسی اتمی در runJobStep، A:33 و A:34 حفظ؛ AC-6 سنجش نسل (محل طبق Q-1) بی هیچ مسیر خودکار بالا بردن نسل؛ AC-7 بی فعال‌سازی، merge تابع مانع استقرار (Q-2 و Q-3)؛ AC-8 آزمون‌های واقعی V3 در int و unit با شاهد شکست پیش از اصلاح؛ AC-9 شاهد اجرایی (unit در verify، int در CI روی head، و دوباره روی commit ادغام‌شده)؛ AC-10 و AC-11 معمول.
- مورد ACهای P11-02: AC-1 guard در providerStep و رد commit نتیجهٔ کهنه، بی ردیف هزینه از اجراکنندهٔ کهنه؛ AC-2 ردپای نتیجهٔ ردشده فقط با شناسه، بی جدول تازه؛ AC-3 ‏writeOwnedObject زیر اختیار؛ AC-4 حذف بیرونی: علامت شرطی و bytes فقط پس از commit علامت (C11-4)؛ AC-5 آزمون int ‏F-2 با شاهد شکست پیش از اصلاح؛ AC-6 شاهد ترکیب نهایی روی head و commit ادغام‌شده؛ AC-7 بی فعال‌سازی؛ AC-8 و AC-9 معمول.
- مورد وابستگی به AC-7 ‏P11-07: **P11-01 به آن وابسته است.** قفل TestPlan و «شروع» implement ‏P11-01 پس از رسیدن خروجی AC-7 است، چون محل نسل و شرط merge (اینکه ادغام در main خود استقرار است یا نه) از آن می‌آیند. پیشنهاد L1: سازوکار مانع استقرار کارت جدای **P11-08** باشد که پس از AC-7 نوشته می‌شود.
- مورد ترتیب پیشنهادی: پاسخ E274 ⇒ خروجی AC-7 ‏P11-07 ⇒ پاسخ Q-1 تا Q-5 ⇒ PR کارت‌ها (و ADR اگر Q5-2 = الف) با approve مالک ⇒ قفل TestPlan ‏P11-01 ⇒ P11-01 ⇒ ادغام (با شرط Q-3) ⇒ تازه‌سازی و قفل TestPlan ‏P11-02 ⇒ P11-02 ⇒ P11-08 (مانع و فعال‌سازی).

### پرسش‌ها برای بازبین (هر کدام با گزینه)
- مورد Q-1، محل نسل مهلت: الف) یک کلید در ساختار تنظیمات موجود (`plt/settings.ts`)، بی migration (پیشنهاد L1، اگر AC-7 یا Implementer نشان دهد شدنی است)؛ ب) ستون یا جدول تازه با migration (کلاس ۱، مالک؛ نقش implementer.database و owns ‏`migrations/**`)؛ ج) بی شمارندهٔ جدا: چرخش همهٔ توکن‌های running در cutover به‌جای نسل (با بند 2 ADR که «نسل» را شرط چهارم می‌داند ناسازگار است). Not Verified: اینکه جدول jobs اکنون ستونی برای نسل دارد یا نه.
- مورد Q-2، مانع استقرار: الف) کارت جدای P11-08 پس از AC-7: بستن پذیرش در نسخهٔ قدیم، اثبات توقف اجراهای قدیم، بالا بردن نسل و چرخش توکن‌ها، فعال‌سازی، و آزمون اجرای قدیم نگه‌داشته‌شده (پیشنهاد L1)؛ ب) درون P11-01.
- مورد Q-3، merge پیش از مانع: اگر AC-7 نشان دهد ادغام در main خود استقرار است: الف) PRهای P11-01 و P11-02 سبز و پذیرفته می‌مانند و پس از آماده شدن P11-08 به ترتیب و درون پنجرهٔ مانع ادغام می‌شوند (پیشنهاد L1؛ هر PR کهنه با E22)؛ ب) کد تازه پشت یک کلید خاموش ادغام می‌شود و P11-08 آن را روشن می‌کند (هم‌زیستی دو تعریف در کد، که E257 شرط ۲ آن را ناممکن می‌خواهد).
- مورد Q-4، دامنهٔ P11-02: الف) فقط C8-6، C9-13 (fencing) و C11-4؛ C11-2، C11-3 و C11-5 به دستهٔ ۱۲ (پیشنهاد L1)؛ ب) C11-2 هم در P11-02، چون V3-06 «شیء معتبر خارج از اختیار حذف نشود» را می‌خواهد. و اگر guard در providerStep به تغییر fake ‏`proc/steps/runtime.test.ts` نیاز داشت: الف) blocked و کارت v2 (پیشنهاد L1)؛ ب) همین حالا آن فایل فقط برای fake در owns، مانند P11-03 v2.
- مورد Q-5، ریسک P11-02: الف) medium، با D7 (برنامهٔ 0.2)؛ ب) high، با approve مالک، چون اثر پولی و storage را fencing می‌کند (پیشنهاد L1).

## ۱۲. پاسخ پرسش‌ها و کارت‌های v2 (0.6؛ E276‑R)
- مورد وضعیت (0.7): پاسخ‌های Q-2 تا Q-5 برقرارند. Q-1 الف با F-12 ناشدنی شد و جای آن را E279 (migration) گرفت؛ جدول کارت‌ها و ترتیب زیر پیشینه است (جانشین: §۱۳).
- مورد Q-1 = الف (موقت): نسل در ساختار تنظیمات موجود (`plt/settings.ts`)، بی migration، به شرط آنکه Implementer یا حکم بازبینی معماری بر F-7 شدنی نشان دهد. اگر migration لازم شد، Task با پرسش باز blocked می‌شود و گزینهٔ ب به مالک می‌رود (کلاس ۱). گزینهٔ ج رد شد. ردیف «build مجاز» و نسل ممکن است یک چیز باشند؛ طراحی نهایی در P11-08. (AC-6 ‏P11-01)
- مورد Q-2 = الف: کارت جدای **P11-08** پس از حکم بازبینی معماری. دامنه:
  - claim با شناسهٔ build و ردیف «build مجاز» (هم‌راستا با Q-1)؛
  - بستن Instant Rollback به نسخهٔ قدیم؛
  - آزمون «اجرای قدیم عمداً نگه‌داشته‌شده»؛
  - requeue برای payload_version ناشناخته، به‌عنوان گزینه؛
  - سازگاری با runner قدیم، تا استقرار خودِ مانع به مانع نیاز نداشته باشد.

  شاهد بیرون از کد (مستند رسمی Vercel برای سه مورد Not Verified ‏F-7، و لاگ runtime به تفکیک deployment پس از یک promote) کار مالک یا اپراتور است و در کارت با عنوان «ورودی مالک» می‌آید.
- مورد Q-3 = الف (پیامد ADR): PRهای P11-01 و P11-02 پس از سبز شدن و approve نگه داشته می‌شوند و فقط درون پنجرهٔ مانع، پس از آماده شدن P11-08 و به ترتیب، ادغام می‌شوند؛ PR کهنه با E22. کلید خاموش رد (E257 شرط ۲). اجرای cutover = محیط production (کلاس ۲) ⇒ با کارت P11-08 به مالک. (AC-7 هر دو کارت)
- مورد Q-4 = الف برای دامنه: P11-02 = C8-6، C9-13 (بخش fencing)، C11-4؛ C11-2، C11-3 و C11-5 به دستهٔ ۱۲. ب برای fake: `proc/steps/runtime.test.ts` و `plt/storage-compose-module.test.ts` فقط برای fake یا wiring در owns ‏P11-02 (AC-9)، و بیرون از قفل‌های TestPlan آن.
- مورد Q-5 = ب: P11-02 ‏high، با approve مالک، هم‌تراز P11-01.
- مورد افزودهٔ P11-01: تابع یا شرط اختیار افزودنی است و امضاهای export‌شدهٔ موجود `plt/jobs.ts` تا جای ممکن حفظ می‌شوند؛ اگر با این حال آزمون قفل‌شده به تغییر fake نیاز داشت ⇒ blocked با شاهد. (AC-1)
- مورد context_refs: پس از E274، اگر Q5-2 = الف، مسیر ADR-0004 در `docs/adr/` مخزن به هر دو کارت افزوده می‌شود.

| فایل (v2) | ریسک | owns | قفل‌های TestPlan |
|---|---|---|---|
| `P11-01.json` | high | `plt/jobs.ts`، `plt/jobs.test.ts`، `plt/jobs.int.test.ts` | maintenance، admin-tasks، runtime.test، storage-compose-module.test (بی‌تغییر از 0.5) |
| `P11-02.json` | high | `proc/steps/runtime.ts`، `plt/storage.ts`، `plt/storage.int.test.ts`، `media/assets.ts`، `priv/media.int.test.ts`، و فقط برای fake: `proc/steps/runtime.test.ts`، `plt/storage-compose-module.test.ts` | jobs.test، jobs.int.test (تازه‌سازی پس از ادغام P11-01)، maintenance، admin-tasks |

- مورد ترتیب: کارت‌های v2 و برنامهٔ 0.6 ⇒ پیش‌سنجی بازبین ⇒ E274 ⇒ PR کارت‌ها (و ADR اگر Q5-2 = الف) ⇒ approve مالک ⇒ پس از ادغام PR کارت‌ها و حکم بازبینی معماری: قفل TestPlan ‏P11-01 و «شروع» implement ⇒ P11-01 (نگه‌داشته تا پنجرهٔ مانع) ⇒ P11-02 ⇒ P11-08 ⇒ ادغام به ترتیب درون پنجرهٔ مانع.

## ۱۳. ساختار دور دوم پس از P11-07 (0.7؛ E280‑R)
- مورد ورودی: audit ‏P11-07 (`docs/l3/audit/P11-07.report.json`) و بازبینی معماری آن (`docs/l3/audit/P11-07.review-architecture.json`)؛ نامزدهای C11-6 تا C11-13 در `phase11-findings-candidates.md`.
- مورد F-12: نسل در `plt/settings.ts` بی migration ناشدنی است ⇒ Q-1 ب ⇒ E279 نزد مالک (Q6-1 تصویب migration افزایشی؛ Q6-2 کارت جدا پیش از P11-01، پیشنهاد بازبین، یا درون P11-01). پیش‌نویس بر فرض «کارت جدا» است.
- مورد ADR: Recalino ADR-0004 ‏0.5 (محتوایی) — نوشتن‌های دامنه در بند 4، قید سمت پایگاه داده و ترتیب سه‌گامه در بند 3، محل نسل در بند 2.

| کارت | نقش اجرا | ریسک | owns | وابستگی | پیوند با ADR و نامزدها |
|---|---|---|---|---|---|
| `P11-09.json` (migration؛ گام 1) | implementer.database | high | `supabase/migrations/20261112120000_plt_job_lease_generation.sql` (نام دقیق؛ E282، 0.9)، `plt/lease-generation.int.test.ts`، `db/types.ts`، `apps/web/src/server/schema-version.generated.ts` | E279 | بند 2 شرط چهارم، بند 3 گام 1؛ F-12 |
| `P11-01.json` ‏v3 (گام 2) | implementer.backend | high | `plt/jobs.ts`، `plt/jobs.test.ts`، `plt/jobs.int.test.ts` | P11-09 | بندهای 2 و 4؛ V3-01، V3-02، V3-03، V3-07؛ F-10؛ نسل در SQL و JobContext |
| `P11-02.json` ‏v3 | implementer.backend | high | `proc/steps/runtime.ts`، `proc/steps/fail-run.ts`، `plt/storage.ts`، `plt/storage.int.test.ts`، `media/assets.ts`، `priv/media.int.test.ts`؛ فقط fake: `proc/steps/runtime.test.ts`، `plt/storage-compose-module.test.ts`، `proc/steps/fail-run.test.ts` | P11-01 | بندهای 4 و 6؛ V3-01، V3-04، V3-06؛ C8-6، C9-13، C11-4، C11-12 |
| `P11-08.json` (گام 3) | implementer.database | high | `supabase/migrations/20261112130000_plt_job_claim_barrier.sql` (نام دقیق؛ 0.9)، `plt/jobs.ts`، `plt/jobs.test.ts`، `plt/claim-barrier.int.test.ts`، `apps/web/src/server/jobs.ts`، `db/types.ts`، `schema-version.generated.ts`، `docs/runbooks/JOB_LEASE_BARRIER.md` | P11-01، P11-02 | بند 3؛ C11-10، C11-13؛ «ورودی مالک» (AC-8) |

- مورد نوشتن‌های دامنه (پرسش (پ) E280‑R): پیشنهاد L1 = **P11-02 ‏v3** (AC-10 تازه؛ owns + `proc/steps/fail-run.ts` و فقط برای fake `proc/steps/fail-run.test.ts`)، چون liveRun، commitProviderOutput و storeExtraction در `proc/steps/runtime.ts` همین کارت‌اند. کارت جدا هم‌پوشانی owns با P11-02 می‌ساخت.
- مورد TestPlanها: P11-09 ‏`f12b9630…` (قفل‌ها: maintenance، admin-tasks، `plt/jobs.test.ts`، `plt/schema-version.test.ts`، `tools/schema-version/build.test.ts`؛ هیچ‌کدام در owns خودش نیست). P11-01 و P11-02 بی‌تغییر از 0.6 (`proc/steps/fail-run.test.ts` قفل نیست). P11-08 پس از ادغام P11-02 (قفل‌های پیشنهادی در assumptions کارت). همهٔ قفل‌ها پیش از قفل مالک از main همان روز دوباره سنجیده می‌شوند.
- مورد هم‌پوشانی owns: P11-08 ‏`plt/jobs.ts` و `plt/jobs.test.ts` را با P11-01 مشترک دارد و `db/types.ts` و `schema-version.generated.ts` را با P11-09؛ دور ترتیبی است و هیچ دو کارتی هم‌زمان اجرا نمی‌شوند.
- مورد ترتیب اجرا: E274، E279 و حکم بازبین ساختاری بر delta ‏0.5 ⇒ PR کارت‌ها (و ADR اگر Q5-2 = الف) با approve مالک ⇒ P11-09 (ادغام عادی پس از approve؛ افزایشی) ⇒ P11-01 ⇒ P11-02 ⇒ P11-08 ⇒ ادغام P11-01، P11-02 و P11-08 به ترتیب درون پنجرهٔ cutover ⇒ cutover (مالک؛ کلاس ۲؛ runbook ‏P11-08).
- مورد برآورد هزینه: P11-09 ‏1.5 تا 3 دلار؛ P11-01، P11-02 و P11-08 هر کدام 3 تا 8 دلار؛ جمع حدود 11 تا 27 دلار؛ بیشتر آن به هفتهٔ D8 پس از 2026-11-16 می‌رود.

## ۱۴. تصمیم‌های مالک و کارت‌های v4 (0.8؛ E274، E279، E281‑R؛ E282 معلق) — پیشینه؛ جانشین بخش‌های الگوی migration، E282 و ترتیب: §۱۵
- مورد E274 (مالک): Q5-1 الف، Q5-2 الف. پذیرش 0.5 فقط پس از حکم «پذیرفته» بازبین ساختاری بر delta است؛ اگر حکم یافته داشت، تصمیم تا نسخهٔ بعد معلق می‌ماند. متن پذیرفته = 0.5، که رفع nit ‏R2-R0004-04 را دارد (بند 2: «هرگز با مهلت اجراکنندهٔ کهنه»؛ Observed by model در inbox 0.5، خط‌های 73 و 74)؛ وضعیت «پذیرفته» و تاریخ = تاریخ حکم delta. فایل `docs/adr/0004-job-lease-fencing.md` (نام هم‌الگو با `0001` تا `0003` در `git ls-tree`) بایت‌به‌بایت همان کپی inbox پذیرفته است و sha256 آن در توضیح PR می‌آید؛ نسخه‌های بعدی کارت‌ها ADR را دست نمی‌زنند.
- مورد E279 (مالک؛ کلاس ۱): Q6-1 الف، Q6-2 الف. قیدهای Q6-1 در P11-09 ‏v4: فقط افزودن، بی DEFAULT و backfill، بی قید و trigger بر plt.job (AC-1، AC-2)؛ بی حذف یا تغییر داده (AC-9)؛ idempotent (AC-10، تازه)؛ down مستند در بلوک توضیح انتهای همان فایل (AC-11، تازه)؛ RLS فعال و بی policy و بی grant عمومی، exposed schemas شاهد مالک و Not Verified (AC-12، تازه)؛ CI از صفر و سازگاری با کد قدیم (AC-5، AC-6)؛ production فقط در cutover با مالک (AC-7).
- مورد سه اصلاح E281‑R: owns migration با الگو در P11-09 و P11-08؛ AC-1 هر دو: «دقیقاً یک فایل migration تازه با این پسوند و timestamp بزرگ‌تر از همهٔ migrationهای موجود base»؛ P11-09 ‏AC-2 هر دو ستون nullable (نسل و build) را قطعی می‌سازد و P11-08 ‏AC-3 به ستون build ‏P11-09 ارجاع می‌دهد، پس migration ‏P11-08 فقط قید یا trigger است.
- مورد context_refs: هر چهار کارت `docs/adr/0004-job-lease-fencing.md` را دارند؛ در P11-01 و P11-02 تغییر دیگری نیست.
- مورد E282 (نزد مالک): قید مالک «owns فقط `supabase/migrations/**`» با درس OPS-05 (P2-02 ‏attempt 1 ‏blocked) و با آزمون int خود Q6-1 ناسازگار است؛ پیشنهاد بازبین: همان چهار فایل. owns ‏P11-09 در v4 جز الگوی نام migration دست نخورد. شاهد L1: CI گام «Generated DB types match the migrations» دارد (Documented در گزارش بلوک ۹۹ و ۱۱۲؛ Observed by model در CI run 43048889702 روی main@7cc035d، pass).
- مورد مانع ۱ سیاست AEO (Observed by model، `policy/targets.json` و `controller/src/pr.ts` روی aeo ‏`main@90964c2`): `write_paths.recalino` نه `docs/adr/**` را دارد، نه الگوی migration دو کارت، نه `docs/runbooks/JOB_LEASE_BARRIER.md` (فقط دو migration فاز ۲ به‌شکل فایل دقیق، E105 الف، و یک runbook، E122). `aeo pr open` پیش از push بیرون از write_paths می‌ایستد، پس ADR نه در PR کارت‌ها و نه در PR جدا از راه AEO به Recalino نمی‌رسد؛ `aeo run` کارت P11-09 و P11-08 را پیش از هر رویداد رد می‌کند (R87). هر دو تصمیم مالک‌اند (PR ‏policy(targets) با approve، مانند #99 و #103) یا ثبت ADR به دست خود مالک.
- مورد ترتیب مالک (پس از حکم delta): PR کارت‌ها (+ ADR) ⇒ approve مالک ⇒ P11-09 ⇒ P11-01 ⇒ P11-02 ⇒ P11-08 (مانع استقرار با شاهد سکوی استقرار و لاگ، AC-8) ⇒ cutover با مالک (کلاس ۲). تا شاهد P11-08، فعال‌سازی ممنوع است (ADR-0004).
- مورد پیش رو: migration ‏P11-08 (قید یا trigger غیرفعال) خودش کلاس ۱ است و پیش از اجرای P11-08 پرسش جداگانهٔ مالک می‌خواهد؛ E279 فقط migration ‏P11-09 را پوشاند. TestPlan ‏P11-08 پس از ادغام P11-02 نوشته می‌شود.

| فایل v4 | sha256 | خط | تغییر نسبت به v3 |
|---|---|---|---|
| `P11-09.json` | `8d187f6f…` | ۹۸ | AC-1، AC-2، AC-3، AC-7، AC-9 بازنوشته؛ AC-10 تا AC-12 تازه؛ owns الگو؛ context_refs؛ assumptions (E279، E282، سیاست AEO، گام CI) |
| `P11-01.json` | `f0054fc7…` | ۹۱ | فقط context_refs و assumption آن |
| `P11-02.json` | `eea93d42…` | ۹۳ | فقط context_refs و assumption آن |
| `P11-08.json` | `ee019d91…` | ۹۷ | AC-1 و AC-3 بازنوشته؛ owns الگو؛ context_refs؛ assumptions (پرسش کلاس ۱ پیش رو، سیاست AEO) |

- مورد TestPlanها: P11-09 ‏`f12b9630…`، P11-01 ‏`5a6d958e…` و P11-02 ‏`3726d4fb…` بی‌تغییرند؛ هر هفت فایل VALID.

## ۱۵. حکم delta ‏0.5، دستورهای مالک و کارت‌های v5 (0.9؛ ایست‌های ۵۱۳ و ۵۱۴) — پیشینه؛ جانشین: §۱۶
- مورد حکم: بازبین ساختاری delta ‏0.5 را برای پذیرش نهایی رد کرد با دو یافته: R2-R0004-05 (major؛ بند 3 و ردیف P11-08: افزایش payloadVersion پیش از مانع، و requeue بی تعویق run_at) و R2-R0004-06 (minor؛ سرآیند: جدا کردن ادعاهای J1/J2 روی `6ff97eb` از J3/J4 روی `7cc035d`). مالک هر دو را پذیرفت. R2-R0004-04 بسته است.
- مورد ADR ‏0.6: `docs/l3/adr-0004-job-lease-fencing-draft.md` ‏`c3ced02f…` (۲۹۵ خط؛ نسبت به 0.5: 27+/19−): عنوان و ردیف‌های نسخه و وضعیت؛ ردیف‌های «قید X1» و «پایهٔ ادعاهای کد» (دو پایه با commit کامل و محدودهٔ اعتبار)؛ §۵: خط دامنه زیر عنوان و برچسب ستون «(main هنگام 0.3)»، ردیف‌های جدول بی‌تغییر (E285‑R)؛ بند 3 «نسخهٔ payload» (منع افزایش payloadVersion تا فعال‌سازی مانع و استقرار requeue در همهٔ buildهای مجاز؛ requeue = پس‌دادن attempt و تعویق run_at؛ kind ناشناخته جدا)؛ ردیف P11-08 «تحویل پلکانی»؛ §۱۰ = delta نسبت به 0.5. هیچ تغییر دیگر. پیش‌سنجی بازبین: پذیرفته با اصلاح §۵ (E285‑R) ⇒ رونوشت بایت‌به‌بایت در inbox ‏`2026-11-11-adr-0004-draft-0.6.md` با MANIFEST و CHANGES ⇒ منتظر حکم بازبین ساختاری.
- مورد E274: معلق تا حکم «پذیرفته» بر 0.6؛ آن‌گاه همان پاسخ مالک (Q5-1 الف، Q5-2 الف با قیدها) بر 0.6.
- مورد ADR-0002 (دستور مالک): رونوشت مکانیکی ADR-0002 در inbox (روی `7cc035d`؛ `8c093523…`) برای سنجش سازگاری migration؛ L1 آن را نخواند (E261 ب). بازبین آن را با GitHub سنجید و پذیرفت (E285‑R).
- مورد E282 (مالک) = الف با قید: owns ‏P11-09 همان چهار مسیر دقیق v3، بی الگو؛ P11-08 هم نام دقیق migration. AC-1 هر دو: همین نام؛ timestamp نه بزرگ‌تر از همهٔ migrationهای base ⇒ blocked. قیدهای P11-09: فایل‌های تولیدی فقط خروجی ابزار، db/types.ts فقط افزودنی (AC-4)؛ آزمون int فقط فایل تازه (AC-5)؛ هیچ کد رفتاری و مسیر پنجم ⇒ blocked (AC-7).
- مورد E283 (نزد مالک): شاهد اینکه db/types.ts فقط خروجی tools/db-types.mjs است؛ Job آن ابزار را اجرا نمی‌تواند (سیاست Job ‏pnpm db:*، supabase * و pnpm exec supabase * را deny می‌کند؛ Observed by model) و verify ‏Postgres ندارد. پیشنهاد بازبین: افزودنی + گام CI «Generated DB types match the migrations» روی همان head. در AC-4 ‏P11-09 «معلق E283».
- مورد E284 (نزد مالک؛ کلاس ۳): مانع سیاست §۱۴؛ پیشنهاد بازبین: یک PR ‏policy(targets) در aeo با approve مالک و چهار ورودی دقیق: `docs/adr/0004-job-lease-fencing.md`، دو نام دقیق migration، `docs/runbooks/JOB_LEASE_BARRIER.md`. تا پاسخ هیچ اقدامی.
- مورد سه حالت آزمون مالک (claim با NULL، مقدار باقی‌مانده از claim قبلی، build بیرون از مجموعهٔ مجاز): در P11-09 ‏AC-5 به شکل سازگاری گام 1 (بی قید)؛ شکل «رد» در P11-08 ‏AC-6، همراه Job تازه، Job برداشته‌شده به دست build تازه و Instant Rollback. P11-08 ‏AC-4: requeue = پس‌دادن attempt و تعویق run_at، با دو سناریوی R2-R0004-05. تفسیر حالت (۴) P11-08 ‏AC-6 پذیرفته شد (E285‑R): مقدار باقی‌مانده، حتی برابر نسل کنونی، به claimی که ستون را در همان update نمی‌نویسد اختیار نمی‌دهد؛ سازوکار با Implementer.
- مورد افزوده‌های v4: AC-11 و AC-12 ‏P11-09 پذیرفته شدند.
- مورد نکته‌های تفسیری حکم: «همان بررسی اختیار بند 2» در بند 4 یعنی هر چهار شرط، از جمله نسل جاری؛ استقرار کد پرکنندهٔ ستون در گام 2 مجوز فعال‌سازی نیست. P11-02 ‏AC-10 نسل کنونی را دارد. جملهٔ ردیف‌های NULL در P11-01 ‏AC-6 با متن پذیرفتهٔ E285‑R جایگزین شد: «ردیف Job با ستون null نسل کنونی ندارد، پس در هیچ بررسی اختیار کد تازه پذیرفته نمی‌شود؛ رفتار sweep برای آن در گزارش صریح می‌آید.»
- مورد ترتیب (دستور مالک): حکم «پذیرفته» بر 0.6 و E284 ⇒ PR کارت‌ها (+ ADR) ⇒ approve مالک ⇒ P11-09 ⇒ P11-01 ⇒ P11-02 ⇒ P11-08 (پرسش کلاس ۱ migration آن پیش از اجرا؛ شاهد سکوی استقرار و لاگ) ⇒ cutover با مالک (کلاس ۲). تا شاهد P11-08 فعال‌سازی ممنوع است.
- مورد یافتهٔ جانبی: شکست job ‏End-to-end در CI ‏main (DNS ‏apt در runner) ثبت شد؛ اگر در run بعدی main تکرار شود، گزارش می‌شود.

| فایل v5 | sha256 | خط | تغییر نسبت به v4 |
|---|---|---|---|
| `P11-09.json` | `747c2e65…` | ۹۸ | owns[0] نام دقیق؛ AC-1، AC-4، AC-5، AC-7، AC-9 بازنوشته؛ assumptions (E282، E283، E284، ترتیب)؛ برچسب ADR ‏0.6 |
| `P11-01.json` | `378845a5…` | ۹۱ | برچسب نسخهٔ ADR ‏(0.5 ⇒ 0.6)؛ جملهٔ ردیف‌های NULL در AC-6 (E285‑R) |
| `P11-02.json` | `08f14823…` | ۹۳ | فقط برچسب نسخهٔ ADR ‏(0.5 ⇒ 0.6) |
| `P11-08.json` | `ce5ca349…` | ۹۷ | owns[0] نام دقیق؛ AC-1، AC-4، AC-6 بازنوشته؛ AC-5 بند ۵؛ assumptions (E284، دستور مالک)؛ برچسب ADR ‏0.6 |

- مورد TestPlanها: P11-09 ‏`f12b9630…`، P11-01 ‏`5a6d958e…` و P11-02 ‏`3726d4fb…` بی‌تغییرند؛ هر هفت فایل VALID.

## ۱۶. حکم 0.6، E283 و E284، کارت‌های v6 نهایی (0.11 و 0.12؛ E286‑R و E287‑R)
- مورد حکم 0.6 (Documented: پیام بازبین E286‑R): بازبین ساختاری 0.6 (`c3ced02f…`) را در سطح تصمیم معماری پذیرفت: R2-R0004-05 و R2-R0004-06 در سطح متن بسته‌اند؛ migration افزایشی در سطح تصمیم با ADR-0002 سازگار است؛ هیچ یافتهٔ تازه و هیچ پرسش مالک. بیرون از حکم (Not Verified نزد او): SQL، کد، استقرار و شواهد آزمون. فایل حکم: `docs/reviews-2/2026-11-11-recalino-adr-0004-v0.6-review.md` ‏(`814a00978f1b6e5a…`)؛ L1 آن را نخواند.
- مورد یادداشت‌های تفسیری حکم و جای آن‌ها در کارت‌ها: (الف) بررسی یا قفل جدول Job از مسیرهای دامنه فقط از راه API عمومی PLT و در همان تراکنش؛ SQL مستقیم بر plt در ماژول دیگر مجاز نیست (مرز مالکیت ADR-0002، به نقل حکم؛ E261 = ب) ⇒ P11-01 ‏AC-12 (تازه)، P11-02 ‏AC-1 و AC-10. (ب) «بی migration» در مثال بند 4 نیاز به migration مشترک نسل را حذف نمی‌کند ⇒ P11-02 ‏AC-10 و assumption ترتیب P11-09.
- مورد E274 بر 0.6: فایل نهایی `docs/l3/adr-0004-job-lease-fencing.md` ‏(`86ff32daaed1e0dc…`، ۲۹۵ خط) همان 0.6 است با تفاوت فقط در خط عنوان و ردیف‌های «نسخه» و «وضعیت» (`diff -U0`: سه hunk، خط‌های 1، 5 و 8)؛ از ردیف «قید X1» تا پایان بایت‌به‌بایت برابر `c3ced02f…`. رونوشت inbox: `2026-11-11-adr-0004-final.md`. مسیر Recalino: `docs/adr/0004-job-lease-fencing.md`. توضیح PR کارت‌ها هر دو sha256 (0.6 پذیرفته‌شده و فایل نهایی) را با جملهٔ «تفاوت فقط عنوان و ردیف‌های نسخه/وضعیت» می‌آورد.
- مورد E284 = الف (مالک، کلاس ۳): PR سیاست aeo ‏**#110** (head ‏`a2be1d9037723935df5a661209bc1138d5b93952` روی `90964c2`؛ patch-id ‏`8ca2419f…`): چهار مدخل دقیق در `write_paths.recalino`، بی glob، و آزمون pinned وابسته؛ `comment` بی‌تغییر؛ ۴۳۳/۴۳۳ و typecheck 0؛ gate جز owner-approval ‏pass. diff ‏#110 در inbox (روی `a2be1d9`؛ `5853840b…`). بازبین آن را پذیرفت؛ head تا حکم بازبین ساختاری دست نمی‌خورد. سنجش R87 (Observed by model، `ownsOutsideWrite` کنترلر): با سیاست #110 هر چهار کارت v6 می‌گذرند؛ با سیاست main، P11-09 و P11-08 بیرون‌اند.
- مورد E283 = الف (مالک): P11-09 ‏AC-4 نهایی شد: db/types.ts فقط افزودنی؛ شاهد = گام CI «Generated DB types match the migrations» سبز روی همان head ‏PR و صفر سطر حذف‌شده در diff آن فایل؛ بازبین هر دو را پیش از فرمان approve می‌سنجد؛ گام قرمز یا هر حذف ⇒ blocked و گزارش. قید ۱ ‏E282 برای schema-version.generated.ts بی‌تغییر. همین قاعده برای P11-08 که همان دو فایل تولیدی را در owns دارد: AC-12 تازه (پیشنهاد L1؛ E287‑R: می‌ماند، منوط به پاسخ مالک به پرسش کلاس ۱ migration ‏P11-08، چون E283 مالک فقط برای P11-09 بود).
- مورد P11-01: owns + `packages/core/src/plt/index.ts`، مشروط و فقط برای export ‏AC-12 (پیشنهاد L1؛ پذیرفته در E287‑R: فقط خط export و فقط اگر لازم شد؛ هر تغییر دیگر در آن فایل ⇒ blocked). سابقه: P2-03 تابع PLT را از `plt/index.ts` export کرد و `tools/test/core-exports-allowlist.test.ts` تغییر نکرد، چون فقط subpathهای package.json را قفل می‌کند (Documented: توضیح PR ‏P2-03). مسیر درون write_paths است (`packages/core/**`).
- مورد TestPlanها (E286‑R، E287‑R): هر چهار روی `main@7cc035d` با فرمان `pnpm test:unit`، بی تازه‌سازی پس از ادغام کارت‌های پیشین. gate ‏testplan-lock هر قفل را روی head ‏PR با sha256 درون TestPlan می‌سنجد (Observed by model: `controller/src/gate/gates.ts`، `testPlanLockChecks`)، پس هیچ TestPlan فایلی را که کارت پیشین در ترتیب در owns دارد قفل نمی‌کند؛ چنین فایلی بیرون از owns کارت بعدی است و gate ‏scope تغییرش را رد می‌کند. قفل‌ها: P11-09 پنج (maintenance، admin-tasks، plt/jobs.test.ts، plt/schema-version.test.ts، tools/schema-version/build.test.ts)؛ P11-01 چهار (maintenance، admin-tasks، proc/steps/runtime.test.ts، plt/storage-compose-module.test.ts؛ دو فایل آخر از owns ‏P11-02 که پس از آن می‌آید)؛ P11-02 دو (maintenance، admin-tasks)؛ P11-08 چهار (maintenance، admin-tasks، plt/schema-version.test.ts، tools/schema-version/build.test.ts). TP-1 هر چهار = proc/maintenance.test.ts. سنجش مکانیکی L1: هیچ قفلی در owns کارت خود یا کارت پیشین نیست. فهرست‌های قفل و «تازه‌سازی» در §۱۱ تا §۱۳ جانشین شده‌اند. پیش از قفل مالک، sha256 قفل‌ها از main همان روز دوباره سنجیده می‌شود.
- مورد ترتیب (دستور مالک): حکم بازبین ساختاری بر diff ‏#110 ⇒ approve مالک ⇒ merge ‏#110 ⇒ PR کارت‌ها (+ ADR؛ یک PR، Q5-2 الف) ⇒ approve مالک ⇒ P11-09 ⇒ P11-01 ⇒ P11-02 ⇒ P11-08 (پرسش کلاس ۱ migration آن پیش از اجرا؛ شاهد سکوی استقرار و لاگ) ⇒ cutover با مالک (کلاس ۲). تا شاهد P11-08 فعال‌سازی ممنوع است.
- مورد §۱۱: از 0.6 پیشینه است (برچسب «پیشینه (جانشین: §۱۲ و §۱۳)»)؛ در 0.11 §۱۵ هم پیشینه شد و جانشین آن همین بخش است.

| فایل v6 | sha256 | خط | تغییر نسبت به v5 |
|---|---|---|---|
| `P11-09.json` | `e8d52bda…` | ۹۸ | AC-4 نهایی (E283 = الف)؛ assumptions: نگاشت E283، سیاست (#110)، شاهد، ترتیب و یادداشت (ب)، context_refs |
| `P11-01.json` | `d9ab3535…` | ۹۶ | AC-12 تازه (API عمومی اختیار؛ یادداشت الف)؛ AC-11 (`plt/index.ts` فقط خط export؛ تغییر دیگر ⇒ blocked)؛ owns + `plt/index.ts`؛ goal و assumptions (حکم 0.6، وابستگی، برنامهٔ 0.11، قفل‌ها E287‑R، context_refs) |
| `P11-02.json` | `1f6ee389…` | ۹۳ | AC-1 و AC-10 (API عمومی PLT در همان تراکنش؛ یادداشت‌های الف و ب)؛ goal و assumptions (حکم 0.6، وابستگی و TestPlan بی تازه‌سازی، TP-1 و قفل‌ها E287‑R، context_refs) |
| `P11-08.json` | `7747385f…` | ۱۰۱ | AC-12 تازه (فایل‌های تولیدی؛ E283، منوط به پاسخ کلاس ۱ مالک)؛ assumptions (TestPlan و قفل‌ها E287‑R، #110، کلاس ۱، context_refs، حکم 0.6) |
| `P11-02.test-plan.json` | `3dc13081…` | ۳۲ | دو قفل (maintenance، admin-tasks)؛ TP-1 ⇒ proc/maintenance.test.ts (E287‑R) |
| `P11-08.test-plan.json` | `4d8ea53e…` | ۴۰ | تازه؛ چهار قفل (E287‑R) |

- مورد TestPlanهای دیگر: P11-09 ‏`f12b9630…` و P11-01 ‏`5a6d958e…` بی‌تغییرند؛ هر هشت فایل VALID (اعتبارسنج قرارداد aeo).
