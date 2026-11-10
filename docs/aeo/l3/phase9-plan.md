# برنامهٔ دستهٔ ۹ ‏L3 — Recalino (پیش‌نویس)

| فیلد | مقدار |
|---|---|
| نسخه | نسخهٔ 0.8 (2026-11-10، E215‑R و E216: کارت P9-05 v2)؛ 0.7 (sha256 ‏`40712dae…`، 2026-11-09، E211‑R: §۱۰ پذیرفته؛ کارت‌های P9-05 و P9-06 ساخته شدند؛ قفل‌ها بی هم‌پوشانی)؛ 0.6 (sha256 ‏`55968d40…`، 2026-11-09، E207‑R: P9-05 و پیشنهاد L1 برای F-4؛ وضع P9-01 و P9-02)؛ 0.5 (2026-11-09، دفتر: E204‑R تا E205‑R، incident ‏P9-01 و سه نامزد هسته در §۴)؛ 0.4 (2026-11-08، دفتر: E199 = الف، اجرای دستی؛ PR ‏#147 همان 0.3 را دارد)؛ 0.3 (sha256 ‏`a13a422c…`، 2026-11-08، E200‑R: TP-1 ‏P9-02 و P9-03 روی آزمون unit موجود؛ ترتیب P9-02 ⇒ P9-03 صریح)؛ 0.2 (sha256 ‏`6f0988a6…`، 2026-11-08، E198‑R: پاسخ سه پرسش، ترتیب، C8-7، ستون مسیر اجرا؛ کارت‌ها ساخته شدند)؛ 0.1 (sha256 ‏`50892918…`، پذیرفته با شرط) |
| وضعیت | **0.1 با شرط پذیرفته شد (E198‑R).** کارت‌های P9-01 تا P9-03 (همراه TestPlan) و P9-04 (audit، دفتری) در دفتر، برای پیش‌سنجی. هیچ Job تا PR کارت‌ها و قفل‌ها |
| پایه | Recalino ‏`main@02aac693401fc911f67a60802b601168a8f70cf0` (پس از P8-05، #146)؛ aeo ‏`main@90964c2` |
| مرجع‌ها | `docs/l3/phase8-findings-candidates.md` (C8-1 تا C8-10)؛ `docs/l3/audit/P8-02.report.json`؛ `docs/l2/handoffs/dev-to-L1-045.md`؛ `docs/l3/phase8-plan.md` ‏0.6 §۴ و §۵؛ `docs/l3/phase8-closeout.md` ‏0.1 |
| قید X1 | متن کد Recalino خوانده نشد. نام فایل‌ها از `git ls-tree` و تاریخچه از `git log` روی `02aac69` است. مسیرهای کد و شماره‌خط‌ها از خروجی Jobهاست. ریسک از `policy/risk-rules.yaml` در aeo ‏`90964c2` است |
| تاریخ‌ها | همه برآوردند (E172)، نه شرط |

برچسب‌ها: **Documented** (با منبع) / **Observed by model** / **Not Verified**.

## ۱. هدف و مرز
- مورد هدف: سه بستهٔ کار از یافته‌های دستهٔ ۸. اول، ریشهٔ دانلود نیمه‌کارهٔ ffmpeg (C8-9). دوم، وضعیت asset گام speech پس از قطع (C8-2، C8-3). سوم، آزمون‌های اجرای دوباره و قطع (C8-5). یافته‌های دیگر فقط با منبع می‌آیند.
- مورد بیرون از دسته: یافته‌های هسته به L-dev می‌روند (phase8-plan §۵). E145 = د بی‌تغییر می‌ماند. policy، registry و `write_paths` بی‌تغییر می‌مانند، مگر با تصمیم مالک.
- مورد مسیر اجرا (E157 §۷): پس از پذیرش بلوک D، Taskها از راه لایهٔ هماهنگی اجرا می‌شوند. تا آن زمان دستی، مگر بازبین یا مالک چیز دیگری بگوید.
- مورد قاعدهٔ E192‑R: هر کارت این دسته که `pnpm install` در apps/web دارد، `install_assets` ‏ffmpeg را دارد.

## ۲. Taskهای پیشنهادی (بی ترتیب نهایی تا بازبینی)
| کارت | منبع | نوع | ریسک کارت | ریسک gate (برآورد) | ‏owns_paths (پیشنهاد؛ نام از ls-tree) | یادداشت |
|---|---|---|---|---|---|---|
| ‏P9-01 | C8-9 (`dev-to-L1-045.md`) | fix | medium | **high** | `patches/ffmpeg-static.patch`، و `pnpm-lock.yaml` (patch hash) | دانلود binary بی cache، یا با سنجش content-length پیش از chmod. lockfile زیر قاعدهٔ `manifests` ‏(high) است، پس approve مالک لازم است. به‌روزرسانی lockfile با `work_install` ‏(R73) |
| ‏P9-02 | C8-5 (P8-02، F-5) | test | low | medium | `packages/core/src/priv/media.int.test.ts` | سه آزمون int: اجرای دوباره پس از checkpoint ‏`speech`، attempt ‏`started` باقی‌مانده، و reconcile پس از lease منقضی. رفتار کنونی را مستند می‌کنند (پرسش طراحی §۳) |
| ‏P9-03 | C8-2 (P8-02، F-2؛ bug ‏medium) | bugfix | medium | medium | `packages/core/src/media/assets.ts` (و آزمون آن) | قطع پس از ثبت `object_id` ⇒ asset ‏ready با فایل ناخوانا. اصلاح پس از P9-02 (پیشنهاد خود Job) |
| ‏P9-04 | C8-3 (P8-02، F-3؛ risk ‏medium؛ AR-05) | investigate یا bugfix | medium | medium | `packages/core/src/proc/steps/runtime.ts`، `packages/core/src/quota/costs.ts` (پیشنهاد) | hold باز همیشگی پس از قطع در میانهٔ dispatch. قاعدهٔ `recalino-quota-cost` فقط migrationها را high می‌کند (`supabase/migrations/*quota*`)، پس `quota/costs.ts` قاعدهٔ high ندارد (Observed by model) |

- مورد برآورد: هر Task حدود ۱٫۵ تا ۳ دلار، با روند دسته‌های ۷ و ۸. P9-01 به خاطر lockfile شاید بیشتر.
- مورد هم‌پوشانی (Observed by model، نام فایل‌ها): P9-03 و P9-04 هر دو به `media/assets.ts` نزدیک‌اند. اگر هر دو آن را بخواهند، باید پشت سر هم بیایند، نه موازی. سنجش با اسکریپت در مرحلهٔ کارت.

## ۳. پرسش طراحی برای بازبین: آزمون‌های int در AEO (بی پیشنهاد دامنه)
- مورد واقعیت (Documented، فرض کارت‌ها): verify ‏AEO فقط `pnpm test:unit` را اجرا می‌کند. `*.int.test.ts` پایگاه محلی می‌خواهد و فقط در گام `pnpm test:int` ‏CI اجرا می‌شود. آزمون‌های پیشنهادی C8-2 تا C8-5 ‏int‌اند.
- مورد گزینهٔ الف: TestPlan با فرمان `pnpm test:int <file>` در verify. پیش‌شرط: پایگاه محلی در sandbox ‏Job. وجود آن Not Verified است. شاید یک R-item برای سرویس پایگاه یا شبکهٔ محلی بخواهد.
- مورد گزینهٔ ب: verify همان `pnpm test:unit` بماند، و شاهد آزمون int از CI بیاید (gate ‏`required-checks`، که «Lint, types, boundaries, tests, build» را می‌خواند). TestPlan فقط ورودی‌ها را قفل می‌کند. نکته: آیا گام CI ‏`test:int` را اجرا می‌کند؟ Not Verified.
- مورد گزینهٔ ج: همان رفتار با آزمون unit، با mock پایگاه یا store. پوشش تراکنش واقعی کمتر می‌شود.
- مورد گزینهٔ د: R-item ‏controller برای فرمان دوم verify، مثلاً `command` آرایه‌ای یا `int_command`. تغییر کد است و از راه L-dev می‌رود، پس از ADR 0021.
- مورد پیوند: انتخاب روی نوع TestPlan ‏P9-02 تا P9-04 و شاهد AC آن‌ها اثر دارد.

## ۴. یافته‌های دیگر (فقط با منبع، بی اولویت)
| یافته | منبع | یادداشت |
|---|---|---|
| C8-1: ادعای closeout دستهٔ ۴ نیمه‌دقیق است | P8-02، F-1 | گزینهٔ کم‌خطر: اصلاح متن سند |
| C8-4: reconcile، ‏asset را در `processing` رها می‌کند (potential) | P8-02، F-4 | گزینه: آزمون int، همراه P9-02 |
| C8-6: دو worker پس از از دست رفتن lease (hypothesis) | P8-02، F-6 | نخست خواندن `keepRenewing` |
| C8-7: MP3 به‌صورت base64 در checkpoint ‏`proc.run_step` | P8-02، F-7 | تصمیم نگه‌داشت داده (شاید کلاس ۱) |
| C8-8: پرچم ambiguous | P8-03 | **بسته** با P8-05 (#146) |
| C8-10: «Try again» | P8-04 | **رد شد**؛ آزمون نگهبان (#145) |
| یافته‌های باز AUD-2 تا AUD-4 (۳۱ از ۳۶ پس از دستهٔ ۸) | phase8-plan §۴-۱ | AUD-3 ‏F-11 و AUD-4 ‏F-11 در دستهٔ ۸ بسته شدند |
| یافته‌های دستهٔ ۶ که Task نمی‌شوند | phase8-plan §۴ | `docs/architecture/**` (کلاس ۳)، CWE-359 (E145)، شمارش چندبعدی (سند پذیرش دستهٔ ۷) |
| یافته‌های هسته | phase8-plan §۵ | L-dev، پس از ADR 0021. نتیجهٔ سنجش install_assets در ledger هم افزوده می‌شود (ایست ۳۹۰) |
| هسته: الگوی «tunnel error: proxy authorization required» در `proxyAuthFailures` | `dev-to-L1-046.md`؛ `run.ts:863`؛ P9-01 attempt 1 (5793) | نامزد L-dev پس از ADR 0021 (E205‑R) |
| هسته: ثبت install بیش از ۶۰۰ ثانیه (سقف Bash) | `dev-to-L1-046.md`؛ P9-01 attempt 1 | نامزد L-dev پس از ADR 0021 (E205‑R) |
| هسته: ثبت نتیجهٔ سنجش نخست R80 (اندازه، بیت اجرایی) در JobBlocked، پیش از `rmSync` | `dev-to-L1-046.md` §۷؛ `run.ts:593`؛ P9-01 attempt 2 (5799) | نامزد L-dev پس از ADR 0021 (E205‑R) |
| هسته: **R80: نصب دوباره باید postinstall را دوباره اجرا کند** (حذف بستهٔ خراب پیش از نصب دوم، یا rebuild) | `dev-to-L1-046.md` §۷؛ P9-01 attempt 2 (install دوم 2.4 ثانیه، بی postinstall) | نامزد L-dev پس از ADR 0021 (E205‑R) |

## ۵. ترتیب و زمان (برآورد)
- مورد ترتیب پیشنهادی:
  1. P9-01 (ریشهٔ ffmpeg؛ پیش از بقیه، تا install_assets کمتر به نصب دوباره برسد)؛
  2. P9-02 (آزمون‌ها، پس از پاسخ پرسش §۳)؛
  3. P9-03؛
  4. P9-04.
  ترتیب نهایی با بازبین است.
- مورد آغاز: پس از پذیرش این برنامه و PR کارت‌ها (high، approve مالک) و قفل TestPlanها (R92). P8-01 جداست (بلوک D یا Q7).
- مورد بودجه: هفتهٔ تازه از 2026-11-09 آغاز می‌شود. هفتهٔ جاری 96.20 از ۱۰۰ است.

## ۶. پرسش‌ها برای بازبین
- مورد پرسش ۱: گزینهٔ آزمون int (§۳).
- مورد پرسش ۲: آیا P9-01 با lockfile ‏(high) در این دسته بیاید؟ یا یک PR جدای مالک، بیرون از Taskها؟
- مورد پرسش ۳: آیا P9-04 نخست investigate باشد؟ یافتهٔ F-3 «confirmed» است، ولی گزینهٔ کم‌خطر خود Job آزمونی است که رفتار کنونی را مستند کند.

## ۷. تصمیم‌های 0.2 (E198‑R)
- مورد پرسش ۱، آزمون int (**گزینهٔ ب**): verify همان `pnpm test:unit` می‌ماند. شاهد آزمون‌های int (P9-02، P9-03) CI سبز روی head است. job ‏verify ‏CI («Lint, types, boundaries, tests, build»، check لازم required-checks) هم `test:unit` (سطر ۷۰) و هم `test:int` (سطر ۸۰، با postgres) را اجرا می‌کند (Observed by reviewer، ci.yml روی `02aac69`). Implementer آزمون int را فقط اگر پایگاه محلی در sandbox بود اجرا می‌کند. گزینهٔ د (فرمان دوم verify) نامزد L-dev پس از ADR 0021 است (§۴، هسته).
- مورد پرسش ۲: P9-01 در همین دسته و **نخست**. PR آن high است (lockfile) ⇒ approve مالک هنگام ادغام.
- مورد پرسش ۳: P9-04 نخست **investigate** است (کارت دفتری، بی TestPlan). اصلاح فقط پس از تأیید، در 0.3.
- مورد ترتیب: P9-01 ⇒ P9-02 ⇒ P9-03 ⇒ P9-04. P9-02 و P9-03 هر دو `priv/media.int.test.ts` را دارند، پس پشت سر هم می‌آیند.
- مورد C8-7 (MP3 در checkpoint): کلاس ۱ (دادهٔ کاربر) ⇒ Task نمی‌شود؛ فقط ثبت. C8-1 (اصلاح متن سند): نامزد P9-05 اختیاری (docs، low)؛ در 0.2 کارت نشد.
- مورد قاعدهٔ E192‑R: P9-01 تا P9-03 ‏`install_assets` ‏ffmpeg را دارند. P9-04 (audit) install ندارد.
- مورد مسیر اجرا (**E199 = الف**، پاسخ مالک؛ OQ-13 بسته): Taskهای دستهٔ ۹ پیش از پذیرش بلوک D دستی اجرا می‌شوند، پس از بازنشانی هفتهٔ بودجه (2026-11-09 ‏00:00 UK)، به ترتیب P9-01 ⇒ P9-02 ⇒ P9-03 ⇒ P9-04 (investigate)، یک Task در هر بلوک.

## ۸. کارت‌ها (0.2؛ Observed by model)
| کارت | نوع / ریسک کارت / gate (برآورد) | owns_paths | قفل TestPlan (روی `02aac69`) | مسیر اجرا |
|---|---|---|---|---|
| ‏P9-01 | bugfix / medium / **high** | `patches/ffmpeg-static.patch`، `pnpm-workspace.yaml`، `pnpm-lock.yaml`؛ work_install ‏`pnpm install --offline --ignore-scripts` (R73، الگوی P1-00) | `audio-preparer.test.ts` ‏(`cd0171a0…`)، `package.json` ‏(`c1cd9cfb…`)، `apps/web/package.json` ‏(`27f5f6e1…`) | E199 |
| ‏P9-02 | test / low / medium | `packages/core/src/priv/media.int.test.ts` | `media/assets.ts` ‏(`bbf4a70f…`)، `proc/steps/runtime.ts` ‏(`b7fefc0b…`)، `quota/costs.ts` ‏(`4d6b4af7…`)، `proc/maintenance.ts` ‏(`b827d337…`)، **`proc/steps/runtime.test.ts`** ‏(`cdef7748…`؛ TP-1) | E199 |
| ‏P9-03 | bugfix / medium / medium | `packages/core/src/media/assets.ts`، `packages/core/src/priv/media.int.test.ts` | `plt/storage.ts` ‏(`3af38c88…`)، `proc/steps/runtime.ts` ‏(`b7fefc0b…`)، **`proc/steps/runtime.test.ts`** ‏(`cdef7748…`؛ TP-1) | E199؛ **فقط پس از ادغام P9-02** |
| ‏P9-04 | investigate (audit) / low / — | `docs/aeo/audit/**` (auditor.debt؛ بی write) | — (بی TestPlan؛ R92 ‏exempt) | E199؛ کارت دفتری |

- مورد اعتبار: هر هفت فایل در برابر schemaهای controller ‏VALID‌اند و با `fmt.mjs` قالب‌بندی شده‌اند.
- مورد preflight روی `02aac69`، بی رویداد: P9-01 تا P9-03 فقط R92 (work ۶۰، منبع card)؛ P9-04 ‏`run` (work ۸۰، منبع card؛ lock ‏`exempt`).
- مورد TP-1 (E200‑R، گزینهٔ الف؛ 0.3): فرمان TestPlan دقیقاً `pnpm test:unit` است، و هر `tests[].file` باید در `files[]` باشد (`prompts.ts` و `$comment` در test-plan.v1). پس TP-1 ‏P9-02 و P9-03 آزمون unit موجود `packages/core/src/proc/steps/runtime.test.ts` است و در `files[]` قفل است، مانند P9-01 با `audio-preparer.test.ts`. شاهد آزمون‌های int همچنان CI ‏(required-checks) در AC است. verify آزمایشی رد شد.
- مورد ترتیب P9-02 ⇒ P9-03 (E200‑R): هر دو `priv/media.int.test.ts` را دارند. هم‌پوشانی فقط پشت سر هم مجاز است. P9-03 پس از ادغام P9-02 و روی main تازه اجرا می‌شود. پیش از قفل TestPlan ‏P9-03، sha256 قفل‌هایش از main همان روز دوباره سنجیده می‌شود. اگر یکی عوض شده بود، TestPlan تازه ساخته می‌شود.

## ۹. incident ‏P9-01 و قاعدهٔ ادامه (E204‑R، E205‑R)
- مورد attempt 1 ‏(5793، `install_failed`): اعتبار proxy همان یک نشست از نخستین درخواست رد شد (407 روی registry ‏npm؛ اعتبار نشست، **نه دامنه**؛ ردِ دامنه 403 است). نشست بعدی سالم بود. علت Not Verified است و با مالک (proxy بالادست).
- مورد attempt 2 ‏(5799، `install_asset_invalid`): دانلودها سالم بودند، ولی ffmpeg نیمه‌کاره شد (C8-9؛ ۴ از ۴۳ نصب). R80 فایل را حذف کرد، و نصب دوم postinstall را اجرا نکرد.
- مورد قاعدهٔ E205‑R: پاک‌سازی worktree و شاخهٔ `aeo/P9-01` به‌دست مالک (E206؛ کلاس ۵)، سپس attempt 3 با worktree تازه، پس از بستن بلوک P9-04. اگر باز binary ۰ بایت شد (C8-9)، همین الگو تا دو بار دیگر، سپس بازبینی دوباره. اگر 407 تکرار شد ⇒ توقف و incident مالک.

## ۱۰. Taskهای 0.6 و 0.7 (E207‑R؛ پذیرفته در E211‑R)
- مورد وضع (Observed by model): P9-01 ⇒ #148 ⇒ `2cbf993`. P9-02 ⇒ #149 ⇒ `18b36ab`؛ آزمون‌های int در CI سبز (`priv/media.int.test.ts`، 13 tests). P9-03 در جریان است. P9-04 انجام شد (C9-1 تا C9-8).

| کارت | منبع | نوع / ریسک کارت / gate (برآورد) | ‏owns_paths (پیشنهاد) | قفل (پیشنهاد) | ترتیب |
|---|---|---|---|---|---|
| ‏P9-05 | C9-1 و C9-2 (P9-04، F-1 و F-2)؛ C8-3 | bugfix / medium / medium | `packages/core/src/proc/steps/runtime.ts`، `packages/core/src/quota/costs.ts`، `proc/steps/runtime.test.ts` (unit)، `priv/media.int.test.ts` (به‌روزرسانی عمدی آزمون C8-3) | **0.7:** `plt/storage.ts`، `plt/jobs.ts`، `proc/maintenance.test.ts` (TP-1) | فقط پس از ادغام P9-02 (انجام شد) و P9-03 (قفل مشترک `runtime.ts`) |
| ‏P9-06 (پیشنهاد L1) | C9-4 و C8-4 (P9-04، F-4؛ P8-02، F-4) | bugfix / medium / medium | `packages/core/src/proc/auxiliary.ts` (hook ‏RunClosedHook برای auxiliary)، `packages/core/src/media/assets.ts` یا ماژول media که hook را تزریق می‌کند، و `priv/media.int.test.ts` (به‌روزرسانی عمدی آزمون C8-4) | **0.7:** `plt/storage.ts`، `plt/jobs.ts`، `proc/maintenance.test.ts` (TP-1) | پس از P9-05 (owns مشترک `priv/media.int.test.ts`؛ پشت سر هم؛ سنجش دوبارهٔ قفل‌ها روی main همان روز) |

- مورد کار P9-05 (Documented، گزینه‌های P9-04): در providerStep، hold را هنگام خطای پیش از try (`assertAttemptAllowed`، `runtime.ts:275`) و هنگام نتیجهٔ uncertain (`runtime.ts:471`) ببندد، با هزینهٔ محافظه‌کارانه و بی retry خودکار. attempt ‏`failed` شود. همهٔ providerStepها را بپوشاند، نه فقط speech (C9-1). آزمون unit برای مسیر خطا، و به‌روزرسانی عمدی آزمون int ‏C8-3 به رفتار درست.
- مورد **پیشنهاد L1 دربارهٔ F-4 (C9-4): Task جدا (P9-06)، نه درون P9-05.** سه دلیل دارد. (۱) فایل‌ها جدا هستند: F-4 در مرز `proc/auxiliary.ts` و `media` است، و P9-05 در `runtime.ts` و `costs.ts`. (۲) گزینهٔ خود P9-04 برای F-4 یک hook ‏auxiliary است که ماژول media تزریق می‌کند، تا مرز proc به media شکسته نشود. پس باید جدا بازبینی شود. (۳) هر دو آزمون «documents current behaviour» ‏P9-02 را عمداً عوض می‌کنند؛ جدا بودن، هر تغییر را با دلیل خودش نگه می‌دارد.
- مورد فقط ثبت (E207‑R): پاک‌سازی holdهای باز موجود در پایگاه (فرمان اپراتور) و هر sweep خودکار زمانی کلاس ۱ هستند ⇒ تصمیم مالک (C9-2 و C9-3). F-5 ‏(`docs/architecture/**`) کلاس ۳ است. F-8 (صورت‌حساب provider، AQ-06) فقط ثبت می‌شود. migration ‏quota زیر `recalino-quota-cost` ‏(high) است.
- مورد install_assets: P9-05 و P9-06 آن را دارند (E192‑R). پس از P9-01، ریشهٔ C8-9 بسته است، ولی قاعده می‌ماند.
- مورد شاهد int: مانند P9-02، TP-1 یک آزمون unit موجود است، و شاهد int از CI است (E198‑R، E200‑R).

### ۱۰-۱. کارت‌ها (0.7؛ Observed by model)
- مورد owns ‏P9-06 (0.7): `proc/maintenance.ts`، `proc/auxiliary.ts`، `media/assets.ts` و `priv/media.int.test.ts`. اصلاح F-4 خود `maintenance.ts` را می‌خواهد (hook ‏afterClose فقط برای kind ‏class است؛ `maintenance.ts:208` در شاهد P9-04).
- مورد قفل‌ها: هر دو کارت `plt/storage.ts`، `plt/jobs.ts` و `proc/maintenance.test.ts` را روی `6eeabf8` قفل می‌کنند. هیچ کارتی فایلی را قفل نمی‌کند که کارت دیگر دارد. TP-1 هر دو آزمون unit موجود `proc/maintenance.test.ts` است (E200‑R، E211‑R).
- مورد هم‌پوشانی owns: فقط `priv/media.int.test.ts`، پس پشت سر هم.
- مورد اعتبار: هر چهار فایل VALID‌اند. preflight روی `6eeabf8` بی رویداد بود (فقط R92؛ work ‏۶۰، منبع card).
- مورد قید مشترک (AC-9): هیچ hold یا ردیف موجود پاک یا تسویه نمی‌شود (کلاس ۱، مالک).

## ۱۱. P9-05 v2 (0.8؛ E215‑R، E216)
- مورد attempt 1 (Observed by model): ‏`job-20261109-5e966630` ⇒ commit ‏`8693ccb` (۴ فایل owns، +307 −71)، ‏JobBlocked ‏5966 ‏`agent_blocked`. unit سبز بود (۳۲۲ فایل و ۵۰۳۵ آزمون). دو مانع: (۱) failed کردن attempt گاردهای retry ‏(`proc/runs.ts:414,764`، `recovery.ts:136`، `admin.ts:32`، `maintenance.ts:140`) را برمی‌داشت و خطر صورت‌حساب دوبار را باز می‌کرد. (۲) چهار آزمون int بیرون از owns رفتار قدیم را assert می‌کردند.
- مورد **E215‑R (گزینهٔ ب)**: attempt در وضعیت started یا uncertain می‌ماند (failed نمی‌شود). فقط hold با برآورد بیشینهٔ خودش بسته می‌شود (`hold_maximum`). گاردهای retry دست نمی‌خورند (AC-2).
- مورد **E216 = الف (مالک)**: اجرای دوبارهٔ هر attempt گیرکرده، حتی از پیش از deploy، hold باز همان attempt را یک بار و در همان مسیر می‌بندد. هیچ پاک‌سازی یا sweep دسته‌جمعی نیست (AC-9 بازنویسی شد).
- مورد owns v2: چهار فایل پیشین، و چهار آزمون int بیرونی (`proc/haiku55-worker.int.test.ts`، `proc/knowledge-study-repair.int.test.ts`، `proc/knowledge-repair.int.test.ts`، `eval/lesson-review-service.int.test.ts`) **فقط برای به‌روزرسانی عمدی assertionهای hold و provider_cost** (AC-3). owns ‏∩ قفل‌ها = ∅، owns ‏∩ گاردهای retry = ∅، owns ‏∩ owns ‏P9-06 = فقط `priv/media.int.test.ts`.
- مورد TestPlan: بی‌تغییر است، و قفل 5959 معتبر است (files[] عوض نشد؛ preflight ‏attempt 2: ‏`run`، worktree ‏`valid@8693ccb`، lock ‏pass).
- مورد اجرا: پس از ادغام PR کارت v2 (high، approve مالک): rework ‏implement ‏attempt 2 روی همان worktree (از `8693ccb`) با یافته‌های E215‑R و E216، سپس verify، بازبینی‌ها و PR. سپس P9-06.
- مورد پرسش باز (Not Verified): gate ‏`scope` ‏(R89، task-card-hash) Jobهای PR را با کارت روی base می‌سنجد. Job ‏attempt 1 با کارت v1 اجرا شد. اینکه gate آن را هم می‌شمارد یا فقط Jobهای head ‏attempt 2 را، دیده نشده است. اگر بشمارد، worktree تازه لازم است.
