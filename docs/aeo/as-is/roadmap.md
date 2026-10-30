# Recalino — Remediation Roadmap (As-Is)

- Task Card: `REC-1` · پایه: `a1d559b` · تاریخ: 2026-10-30
- مرجع شناسه‌ها: [risk-register.md](risk-register.md) (`RR-xx`). منبع اولیهٔ هر ردیف (`DEBT-F-n`، `SEC-F-n` یا `ARCH-F-n`) در همان سند آمده است.
- بخش دوم: گام‌های R-20 تا R-31 از یافته‌های معماری (RR-21 تا RR-32) آمده‌اند. آن‌ها در موج هم‌ریسک جا گرفته‌اند. گام‌های پیشین حذف یا بازنویسی نشده‌اند. فقط به R-09 یک بند افزوده شده است.
- هر گامی که «ADR» یا «تصمیم Architect» دارد، اول به نقش Architect ارجاع می‌شود. قاعدهٔ ماشینی پس از پذیرش ADR اضافه می‌شود.
- ترتیب: اول ریسک (شدت × اطمینان)، بعد هزینه (S < M < L). کار کم‌هزینه با ریسک برابر زودتر می‌آید.
- Hypothesisها (H-01 تا H-05) عمداً در این Roadmap نیستند (AC-3). پیش از هر اقدام، اول باید با پرسش‌های بخش ۳ آن سند تأیید یا رد شوند.
- هر گام یک Task Card جدا و تأیید مالک می‌خواهد. این سند پیشنهاد است و هیچ تغییری را اجرا نمی‌کند.
- برچسب «کار مالک» یعنی گام در داشبورد Vercel، Supabase یا GitHub انجام می‌شود و از مخزن قابل اجرا یا تأیید نیست: [NV].

## موج ۰ — فوری: مرز اعتماد عامل و production

| گام | کار | شناسه‌ها | هزینه | مالک اجرا | معیار پایان |
|---|---|---|---|---|---|
| R-01 | تصمیم تازهٔ مالک دربارهٔ دسترسی عامل به دادهٔ production. پیشنهاد: `execute_sql` از allow هر دو کانکتور برداشته شود تا پرسش پیش‌فرض باشد. کانکتور production به نقش فقط‌خواندنی وصل شود. نوشتن داده فقط با migration یا ابزار ops انجام شود. `mcp__github__issue_write` و `add_issue_comment` هم پرسشی شوند. سپس `CLAUDE.md` خط ۸۵ هم‌خوان شود. | RR-01 (blocking)، RR-04 | M | مالک (تصمیم)؛ عامل (ویرایش `.claude/settings.json` و `CLAUDE.md`) | `update` یا `insert` روی `plt.admin_owner` بدون پرسش اجرا نشود (آزمون واحد hook یا پیکربندی). تصمیم با شناسهٔ `D..` ثبت شده باشد. |
| R-02 | اجرای ruleset مصوب D83 روی `main`: PR اجباری، check الزامی، منع force push و منع حذف شاخه. سپس `Bash(git push:*)` به الگوهای مشخص محدود شود. hook برای push با `+`، `:`، `--delete`، `--mirror` یا URL پرسش کند. | RR-02 | S | مالک (GitHub)؛ عامل (settings و hook) | ruleset فعال باشد (ثبت با تاریخ در `docs/ops/BRANCH_PROTECTION_FA.md`) و آزمون hook برای الگوهای تازه سبز باشد. |
| R-03 | پاک‌سازی بقایای SPIKE-05 در Vercel: حذف استقرارهای production پیش از `f24ad27`، باطل کردن bypass ساخته‌شده برای SPIKE-05، حذف `RECALINO_SPIKE` و `SPIKE_TOKEN`، و چرخش `CRON_SECRET`، توکن Blob (D82) و رمز `recalino_app`. حذف `.recalino-spike` روی میزبان. | RR-03 | S | مالک | وضعیت با تاریخ در `docs/plans/M4_QUEUE_STORAGE.md` بخش «هنوز باز» ثبت شده باشد. |

## موج ۱ — ریسک متوسط با هزینهٔ کم یا متوسط

| گام | کار | شناسه‌ها | هزینه | مالک اجرا | معیار پایان |
|---|---|---|---|---|---|
| R-04 | بازگرداندن پشتیبان روزانه و کاهش وابستگی به میزبان. (۱) علت شکست‌های 10-14 و 10-16 تا 10-18 روی میزبان پیدا و رفع شود و یک تمرین restore انجام شود. (۲) هشدار `ops.backup_stale` به کانال بیرونی (ایمیل یا Push مالک) هم برود. (۳) ADR کوتاه برای میزبان پشتیبان نوشته شود، با RPO ‏۲۴ ساعته و محرک انتقال (Actions زمان‌بندی‌شده یا Supabase Pro). (۴) پشتیبان‌ها به store یا حساب جدا منتقل شوند و کلید journal از کلید پشتیبان جدا شود. نسخهٔ آفلاین کلید ساخته شود. | RR-05، RR-14 | M | مالک (میزبان، تصمیم RPO)؛ عامل (هشدار، ADR) | سه نسخهٔ `ready` پیاپی، تاریخ drill در runbook، و ADR با وضعیت Accepted. |
| R-05 | مقید کردن flag گارد حقوقی: انقضا (`..._UNTIL=YYYY-MM-DD`) یا فهرست مشکل‌های پذیرفته‌شده، تا مشکل تازه build را متوقف کند. | RR-11 | S | عامل؛ مالک (مقدار env) | آزمون واحد `tools/legal/guard.ts` برای flag منقضی و مشکل تازه سبز باشد. |
| R-06 | افزودن `node --test apps/web/tools/*.test.mjs` به job ‏`verify` در CI. برای `tools/backup/daily-task.test.mjs` اول بررسی شود که روی Linux اجراشدنی است یا فقط روی Windows؛ اگر فقط Windows است، صریحاً در runbook ثبت شود. | RR-07 | S | عامل | گام تازه در `.github/workflows/ci.yml` روی یک PR سبز اجرا شده باشد. |
| R-07 | به‌روزرسانی اسناد راهنمای عامل: بخش «وضعیت» `CLAUDE.md` (Google، نسخهٔ متن حقوقی ۰٫۳) و جدول Stack و دستورهای `docs/PROJECT_SPEC.md` (صف، build هشت‌گامی). | RR-09، RR-19 | S | عامل؛ مالک (تأیید وضعیت Google) | تعارض ثبت‌شده در `CLOUD_AUTH_CONFIG.md` خط ۳۳ بسته شده باشد. |
| R-08 | اصلاحیهٔ نسخه‌دار ADR-0001 (صف ← ADR-0003؛ ffmpeg فعال؛ Anki با `fflate`؛ SMTP ‏Gmail). نوشتن ADR-0004 (روش ادغام قطعه) یا حذف ارجاع آن از `storage-vercel-blob.ts` خط ۱۸۵. سپس ADRهای کوتاه برای IMP-01 تا IMP-08 در `history.md` بخش ۵. | RR-08 | M | عامل؛ مالک (پذیرش ADR) | `git grep ADR-0004` فقط به فایل موجود اشاره کند و ADR-0001 بخش اصلاحیهٔ تازه داشته باشد. |
| R-09 | حذف `pg-boss` از `package.json` و lockfile، و اصلاح بخش منابع ADR-0003 به commit `f24ad27` به‌جای مسیر حذف‌شده. (افزودهٔ بخش دوم:) آزمون `forbidden-dependencies` که بسته‌های ردشده در ADRها را در همهٔ `package.json`های workspace بگیرد. | RR-17 (و ARCH-F-7) | S | عامل؛ مالک (تصمیم باز طبق `M4_QUEUE_STORAGE.md` خط ۲۷۱) | `git grep pg-boss -- package.json pnpm-lock.yaml` خالی باشد و `pnpm verify` سبز باشد. |
| R-20 | ثبت و اجرای مرز REC در `apps/web`. (۱) تصمیم Architect: جای REC (لایهٔ UI در web یا ماژول core) و پذیرش یا رد وابستگی `rec → proc` که از D105 و D107 آمده است. اگر پذیرفته شود، ردیف REC در سند FR و `tools/capability-map.json` با هم اصلاح شوند. (۲) قاعدهٔ depcruise ‏`web-rec-capability` با from برابر `apps/web/src/ui/recording/`، روشن ماندن `tsPreCompilationDeps` و severity برابر error. (۳) قاعدهٔ `web-rec-no-workspace` اول با warn، و انتقال قطعه‌های مشترک (`primitives`، `api`، upload) به یک پوشهٔ مشترک. این گام R-12 را برای `ui/recording` دربر می‌گیرد. | RR-21، RR-06 | M | Architect (ADR)؛ عامل (قاعده) | ADR با وضعیت Accepted، و `pnpm check:boundaries` با قاعدهٔ تازه سبز باشد. یک fixture تخلف عمدی آن را بگیرد. قاعدهٔ مردهٔ `capability-map-rec` حذف یا هدف‌گذاری دوباره شده باشد. |
| R-21 | جدا کردن `tools/` از درون core. (۱) `zod` در devDependencies ریشه (یا یک `package.json` برای `tools`) اعلام شود و ۱۱ import مسیر `packages/core/node_modules/` اصلاح شوند. (۲) قاعدهٔ `no-cross-package-node-modules`. (۳) قاعدهٔ `public-api-outside-core` برای `tools/`، `apps/` و `packages/ops-cli/` با فهرست سفید صریح برای ابزار ارزیابی. (۴) تصمیم مالک دربارهٔ `tools/eval/haiku55-*` (INV-35): بایگانی، یا جدا کردن از include پروژهٔ unit و `tsc -p tools`. | RR-24 | M | عامل؛ مالک (بند ۴) | `git grep "packages/core/node_modules/" -- tools` خالی باشد، `pnpm verify` سبز باشد و تصمیم INV-35 ثبت شده باشد. |
| R-22 | ADR تازه با عنوان «پردازش بایت داخل Vercel Functions». این ADR ردیف‌های ۵۴ و ۵۷ ADR-0001 را supersede کند و دامنهٔ قاعدهٔ ۲ (خط ۶۵) را به بدنهٔ درخواست HTTP محدود کند. سقف حافظه و حجم، و محرک بازگشت به URL مستقیم را هم ثبت کند. سپس آزمون `byte-readers-allowlist` برای `readOwnedObject` و `compose` اضافه شود. آزمون `native-runtime-boundary.test.ts` هم به قاعدهٔ رسمی تبدیل شود. می‌تواند با R-08 در یک PR اسنادی بیاید. | RR-27 (و بند ffmpeg در RR-08) | M | Architect (ADR)؛ عامل (آزمون)؛ مالک (پذیرش) | ADR با وضعیت Accepted، و ADR-0001 در خط ۵۴، ۵۷ و ۶۵ به آن ارجاع بدهد. آزمون فهرست سفید سبز باشد. |

## موج ۲ — ریسک متوسط با هزینهٔ بیشتر

| گام | کار | شناسه‌ها | هزینه | مالک اجرا | معیار پایان |
|---|---|---|---|---|---|
| R-10 | ثبت نتیجهٔ نهایی Run روی Job (مثلاً `outcome`) یا سیگنال سلامت مبتنی بر وضعیت Run (P-04 در `docs/architecture/04-risk-register.md`)، و ثبت جدایی Job و Run به‌عنوان قرارداد. | RR-10 | M | عامل | `/api/health?deep=1` یا کارت System health، Run شکست‌خورده را بشمارد. |
| R-11 | ساده‌سازی گارد SQL پس از R-01: اگر پرسش پیش‌فرض برقرار شد، guard لایهٔ کمکی می‌شود و نگهداری‌اش سبک‌تر می‌شود. جایگزینی با parser رسمی فقط با تأیید مالک (وابستگی تازه). | RR-04 | M | عامل؛ مالک | تصمیم «نگه داشتن، ساده کردن یا جایگزینی» ثبت شده باشد. |
| R-12 | گسترش نگهبان مرز به `apps/web`: قاعدهٔ depcruise برای `apps/web/src/ui/recording` (فقط `@recalino/core/src`)، و نگاشت مجاز برای `apps/web/src/server` یا ثبت صریح این‌که لایهٔ سرور، لایهٔ ترکیب است و مرز ندارد. | RR-06 | M | عامل | `pnpm check:boundaries` با قاعدهٔ تازه سبز باشد و یک fixture تخلف آن را بگیرد. |
| R-13 | CSP کامل با `script-src 'self' 'nonce-…'` و `strict-dynamic`. اول در حالت Report-Only امتحان شود. nonce یا hash برای اسکریپت تم در `layout.tsx` گذاشته شود. | RR-13 | M | عامل | e2e روی Preview بدون گزارش نقض CSP. |
| R-14 | نوشتن FR فشرده برای PROC و LKM (اولویت: idempotency و انتشار)، سپس CARD، SRS، NOTE و REC. یا ثبت صریح مرجع جایگزین در `docs/MVP_FUNCTIONAL_REQUIREMENTS_FA.md` و اصلاح قاعدهٔ `CLAUDE.md` خط ۵۵. | RR-12 | L | عامل؛ مالک (تأیید FR) | `docs/fr/PROC.md` و `docs/fr/LKM.md` تأییدشده باشند. |
| R-23 | ADR تازه برای لایهٔ ترکیب (composition) در `apps/web/src/server`: یا این لایه رسمی شود، یا جریان یادگیری خودکار به ماژول تازهٔ core (مثلاً `learn`) با ردیف صریح در capability map برود. ADR مرز تزریق `pers → proc` را هم ثبت کند. سپس آزمون `web-server-orchestration-allowlist` (تعریف `JobDefinition` یا `PeriodicJob` فقط در فایل‌های فهرست سفید) و قاعدهٔ `web-server-module-fanout` با warn اضافه شوند. `apps/web/AGENTS.md` خط ۱۶ و `docs/architecture/02-as-is-architecture.md` خط ۱۳۳ هم‌خوان شوند. | RR-22 | L | Architect (ADR)؛ عامل؛ مالک (پذیرش) | ADR با وضعیت Accepted، و آزمون فهرست سفید با ۱۰ فایل فعلی سبز باشد. |

## موج ۳ — ریسک کم

| گام | کار | شناسه‌ها | هزینه | مالک اجرا | معیار پایان |
|---|---|---|---|---|---|
| R-15 | تصمیم مالک دربارهٔ شناسه‌های زیرساخت در اسناد و artifactها. در اسناد تازه از placeholder استفاده شود. نشانی صندوق پایلوت از env خوانده شود. اسناد تاریخی دست‌نخورده بمانند، مگر مخزن عمومی شود. | RR-16 | S | مالک (تصمیم)؛ عامل | تصمیم با شناسهٔ `D..` ثبت شده باشد. |
| R-16 | هم‌خوان کردن `config/openrouter-defaults.json` با D57 پس از اعمال در production، و نمایش `version` پیکربندی فعال در `/api/health?deep=1`. | RR-18 | S | عامل؛ مالک (تأیید env) | `version` مخزن و production یکی باشد. |
| R-17 | شکستن اسکریپت `build` به گام‌های نام‌دار، با یک خط توضیح برای هر گام. | RR-19 | S | عامل | `pnpm build` همان خروجی را بدهد و هر گام نام جدا داشته باشد. |
| R-18 | ابزار یا آزمون سبک که استثناهای `minimumReleaseAgeExclude` قدیمی‌تر از ۷ روز و override‌های منقضی را گزارش کند. | RR-20 | S | عامل | آزمون تازه در `tools/` سبز باشد و فهرست فعلی پاک شده باشد. |
| R-19 | لایهٔ دوم authorization: policy ‏RLS بر پایهٔ `current_setting('app.user_id')` برای جدول‌های پرخطر (`src.*`، `note.*`، `media.asset`، `plt.storage_object`) و برداشتن `bypassrls` از نقش درخواست‌ها. تا آن زمان، آزمون cross-account برای توابع core هم اجباری شود. | RR-15 | L | عامل؛ مالک (migration) | migration تازه و آزمون integration دسترسی متقابل سبز باشد. |
| R-24 | آزمون `fk-follows-capability-map`: migrationها parse شوند و schema مقصد هر FK باید در `allowedModules(schema مبدأ)` باشد یا همان schema باشد. `auth.users` استثنای صریح است. نسخهٔ دقیق‌تر: آزمون integration روی `pg_constraint`. مالکیت `learning_item` میان LKM و CARD هم در سند FR یا یک ADR کوتاه ثبت شود. | RR-32 | M | عامل؛ Architect (مالکیت) | آزمون سبز باشد و یک FK عمداً خلاف جهت در fixture را بگیرد. |
| R-25 | ADR کوتاه دربارهٔ سیاست گذرا: رسمی شود و قاعدهٔ ۱ بخش ۳.۱ سند FR (خط ۷۹) اصلاح شود، یا سخت‌گیری انتخاب شود. آزمون `capability-map-doc-sync` جدول بخش ۳ سند FR را با `tools/capability-map.json` مقایسه کند. قاعدهٔ `capability-map-direct-<module>` با warn هم اضافه شود. | RR-23 | S | Architect؛ عامل | ADR پذیرفته شده باشد و آزمون هم‌خوانی سبز باشد. |
| R-26 | قاعدهٔ `no-test-fixtures-in-production` با فهرست سفید صریح برای `app/dev`، e2e و فایل‌های پشتیبان آزمون. `packages/ops-cli/src/evaluate.ts` به‌جای helper آزمون از API رسمی acc یا adapter محلی استفاده کند. در صورت نیاز، subpath ‏`@recalino/core/testing` با ADR کوتاه بیاید. | RR-25 | S | عامل؛ Architect (subpath) | depcruise با قاعدهٔ تازه سبز باشد و `evaluate.ts` دیگر `core/test/` را import نکند. |
| R-27 | ADR «نقطه‌های ورود browser-safe»: فهرست subpathهای مجاز، دلیل هر کدام و قاعدهٔ نام‌گذاری. نام `./card-html` با محل فایل در lkm هم‌خوان شود. آزمون `exports-allowlist` و قاعدهٔ `client-safe-no-server-deps` (نرسیدن به `pg`، `kysely`، `node:` و `@vercel/blob`) اضافه شوند. | RR-26 | S | Architect (ADR)؛ عامل | ADR پذیرفته شده باشد و هر کلید `exports` در فهرست policy باشد. |
| R-28 | تکمیل بند ADR-0004 در R-08: پس از تصمیم روش compose، شاخهٔ `multipart` از `ObjectStore.compose` بازنشسته شود. `module` پارامتر ورودی `composeOwnedObjects` شود تا plt نام `src` را نداند. آزمون `adr-reference-exists` هم اضافه شود. | RR-28 (و بند ADR-0004 در RR-08) | S | عامل؛ Architect | `git grep -n "\"multipart\"" -- packages/core/src/plt` خالی باشد و آزمون ارجاع ADR سبز باشد. |
| R-29 | قواعد لایه‌ای web: `web-ui-not-to-server` و `web-api-routes-thin` (error)، `web-ui-core-type-only` (error، با فهرست client-safe از R-27)، و `web-server-not-to-ui` با warn. قراردادهای مشترک (`captureDiagnosticsSchema` و DTOهای admin) به پوشهٔ خنثی `apps/web/src/shared/` بروند. | RR-30 | S | عامل | depcruise با قواعد تازه سبز باشد و `server` دیگر از `ui` مقدار import نکند. |
| R-30 | پس از R-14 (FR-PROC): ADR برای زیرماژول‌های proc با مرز index داخلی. قاعدهٔ `proc-internal-layers`، و قاعدهٔ `source-file-size` با warn و فهرست استثنای فعلی. | RR-29 | L | Architect (ADR)؛ عامل | ADR پذیرفته شده باشد و قاعده‌ها سبز باشند. فایل تازه از سقف رد نشود. |
| R-31 | ساخت `policy/architecture-rules.yaml` در Task Card جدا، با تأیید Architect. قواعد موجود depcruise با همان شناسه‌ها مبنا باشند. قواعد پیشنهادی R-20 تا R-30 به آن افزوده شوند. هر قاعده به فرمان اجرایی (depcruise یا آزمون vitest) و به ADR منبعش ارجاع بدهد. | RR-31 | S | Architect؛ عامل | فایل در `main` باشد و هر شناسهٔ آن به فرمان و ADR برسد. |

## وابستگی گام‌ها

- R-11 پس از R-01 می‌آید.
- R-07 و R-08 می‌توانند در یک PR اسنادی بیایند.
- R-09 به تصمیم بازی وابسته است که در `M4_QUEUE_STORAGE.md` خط ۲۷۱ ثبت شده است.
- R-03 اگر انجام شود، H-02 را هم روشن می‌کند. H-02 خودش گام Roadmap نیست.
- بخش دوم:
  - R-20 گام R-12 را برای `ui/recording` دربر می‌گیرد. R-12 برای `apps/web/src/server` باقی می‌ماند و بهتر است پس از ADR گام R-23 بیاید.
  - R-22 و R-28 بند ADR-0001 و ADR-0004 گام R-08 را تکمیل می‌کنند و می‌توانند در همان PR اسنادی بیایند.
  - R-29 به فهرست client-safe گام R-27 وابسته است.
  - R-30 پس از R-14 می‌آید.
  - R-31 رتبهٔ ریسک پایینی دارد (info)، ولی ظرف همهٔ قواعد پیشنهادی است. اگر Architect بخواهد قواعد از اول در policy ثبت شوند، می‌توان آن را پیش از R-20 انجام داد.
  - H-04 و H-05 گام Roadmap نیستند (AC-3). پاسخ H-05 فوریت R-22 را تعیین می‌کند.
