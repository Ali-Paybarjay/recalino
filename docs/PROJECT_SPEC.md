# Spec پروژه‌سطحی — ریکالینو (Recalino)

> **وضعیت:** نسخه ۱٫۰ — تأییدشده توسط مالک محصول (2026-09-30)  
> **تاریخ:** 2026-09-30  
> **مبنا:** [ADR-0001 (Accepted)](adr/0001-stack-and-hosting.md) · [ADR-0002 (Accepted)](adr/0002-data-access-and-migrations.md) · [سند FR](MVP_FUNCTIONAL_REQUIREMENTS_FA.md) · [CLAUDE.md](../CLAUDE.md)

## ۱. هدف

این سند می‌گوید کد ریکالینو **چطور** ساخته، اجرا، آزموده و تحویل می‌شود، و عامل کدنویسی چه کاری را همیشه انجام می‌دهد، چه کاری را پیش از انجام می‌پرسد و چه کاری را هرگز نمی‌کند. **چه چیزی** ساخته می‌شود در PRD، دفتر تصمیم‌ها و FRهاست و اینجا تکرار نمی‌شود.

**موفقیت یعنی:** هر توسعه‌دهنده یا عامل کدنویسی با یک clone تازه و فقط با دستورهای همین سند، پروژه را اجرا و آزمون کند؛ و خروجی هر milestone همان باشد که CLAUDE.md می‌خواهد: کد، migration، آزمون، دستور اجرای قابل تکرار و گزارش محدودیت‌ها.

## ۲. تصمیم‌ها و فرض‌ها

| # | مورد | وضعیت |
|---|---|---|
| S1 | محیط توسعه محلی: Windows 11 با WSL2 و Docker Desktop؛ Supabase محلی با `supabase start` | ✅ تصمیم مالک محصول، 2026-09-30 |
| S2 | مخزن خصوصی GitHub (`Ali-Paybarjay/recalino`) و CI با GitHub Actions | ✅ تصمیم مالک محصول، 2026-09-30؛ مخزن ساخته شد |
| S3 | Node.js 24 LTS در محیط محلی، CI و Vercel | ✅ تصمیم مالک محصول، 2026-09-30 |
| S4 | لایه داده و migration طبق ADR-0002 | ✅ ADR-0002 پذیرفته شد، 2026-09-30 |
| S5 | یک محیط ابری: پروژه Supabase `recalino` و پروژه Vercel، که محیط پایلوت است. توسعه و آزمون فقط محلی و در CI | ✅ تأیید با spec، 2026-09-30 |
| S6 | هیچ فراخوانی واقعی AI در آزمون‌ها و CI؛ فقط mock قطعی | ✅ تأیید با spec، 2026-09-30 |
| S7 | CI کم‌مصرف در همهٔ مخزن‌های مالک محصول: اجرا فقط روی push به `main`، PR به `main` و اجرای دستی؛ e2e فقط روی `main` یا PR با برچسب `e2e`؛ بودجهٔ Actions در حساب GitHub تعریف شده است ([docs/ops/CI_LOW_COST_POLICY.md](ops/CI_LOW_COST_POLICY.md)) | ✅ تصمیم مالک محصول، 2026-10-13 |

## ۳. Tech Stack

نسخه‌ها در 2026-09-30 از npm بررسی شده‌اند. نسخه دقیق هر بسته هنگام راه‌اندازی در `package.json` و `pnpm-lock.yaml` قفل می‌شود.

| لایه | انتخاب |
|---|---|
| Runtime | Node.js 24 LTS (`.nvmrc` و `engines`) |
| مدیر بسته | pnpm 12، workspace؛ نسخه در فیلد `packageManager`. build script بسته‌ها فقط با فهرست `allowBuilds` در `pnpm-workspace.yaml` اجرا می‌شود |
| زبان | TypeScript با `strict`؛ نسخه 6.0.3. TypeScript 7.0 هنوز API جاوااسکریپتی لازم Next.js را ندارد (M0، 2026-09-30) |
| وب و API | Next.js 16.3 (App Router) و React 19.3 روی Vercel در `lhr1` |
| داده | Kysely 0.29 و `pg` 8؛ migration با Supabase CLI 2.x (ADR-0002) |
| احراز هویت | Supabase Auth با `@supabase/ssr`؛ فقط Google (Q-ACC-1) |
| اعتبارسنجی | zod 4.6 برای هر ورودی بیرونی: درخواست API، متغیر محیطی، خروجی LLM |
| زمان‌بندی مرور | `ts-fsrs` 5.4.2 با نسخه دقیق، در مرحله ۴ |
| صف | pg-boss 12 یا جدول Job با `SKIP LOCKED`؛ انتخاب در SPIKE-05 |
| آزمون | Vitest 5 (واحد و یکپارچه)، Playwright 1.63 (E2E) |
| Lint و قالب‌بندی | Biome 2.5 |
| مرز ماژول‌ها | dependency-cruiser 18 |

## ۴. دستورها

همه از ریشه مخزن اجرا می‌شوند.

```bash
# یک بار
pnpm install

# دیتابیس محلی (Docker باید روشن باشد)
pnpm db:start              # supabase start: Postgres + Auth محلی
pnpm db:reset              # همه migrationها + seed مصنوعی روی دیتابیس محلی
pnpm db:new <name>         # supabase migration new <name>؛ در shell غیرتعاملی: pnpm db:new <name> < /dev/null
pnpm db:types              # تولید نوع‌های Kysely از دیتابیس محلی
pnpm db:env                # نوشتن اتصال و کلیدهای Supabase محلی در apps/web/.env.local
pnpm db:stop               # supabase stop

# رشته اتصال دیتابیس ابری: فقط مالک محصول، در ترمینال خودش (runbooks/SECRETS.md)
pnpm db:new-password       # رمز تازه recalino_app؛ رشته اتصال در ~/.recalino/database-url.txt، و فقط verifier برای SQL Editor
pnpm db:url-check          # همان فایل را با تنظیم اتصال و TLS اپ می‌سنجد؛ هیچ سری چاپ نمی‌شود

# migration ابری از سشن ابری Claude Code (D77؛ توکن Network secret همان environment است)
pnpm db:apply              # dry run؛ با --apply اجرا، با --approve-data-loss <version> فقط پس از اجازهٔ مالک محصول

# توسعه
pnpm dev                   # next dev روی http://localhost:3000
pnpm build                 # next build

# کیفیت
pnpm lint                  # biome check .
pnpm format                # biome check --write .
pnpm typecheck             # tsc --noEmit در همه بسته‌ها
pnpm check:boundaries      # dependency-cruiser: جهت وابستگی ماژول‌ها
pnpm check:client-bundle   # پس از build: نبود اسرار در خروجی قابل دریافت مرورگر (FR-PLT-009)
pnpm legal:build           # ساخت متن‌های حقوقی اپ از docs/legal؛ آزمونی ناهمخوانی را می‌گیرد

# آزمون
pnpm test:unit             # vitest run --project unit      (بدون دیتابیس)
pnpm test:int              # vitest run --project integration (نیازمند db:start)
pnpm test:e2e              # playwright test                  (نیازمند db:start)
pnpm test                  # unit + integration

# دروازه پیش از commit و در CI
pnpm verify                # lint + typecheck + boundaries + test

# اپراتور (FR-QUOTA-002) — همراه همان FR اضافه می‌شود، نه در M0
pnpm ops <command>         # ابزار خط فرمان اپراتور؛ فقط با اعتبار سمت سرور
```

دستورهایی که روی محیط ابری اثر دارند، مثل `supabase db push` یا `vercel deploy --prod`، در `package.json` نیستند تا تصادفی اجرا نشوند (بخش ۹).

## ۵. ساختار مخزن

```text
apps/web/                      Next.js: صفحه‌ها، Route Handlerها، Route اجرای Job و Cron
  src/app/                     مسیرهای UI و API
  src/ui/                      کامپوننت‌های مشترک رابط
  e2e/                         آزمون‌های Playwright
packages/core/                 منطق دامنه؛ بدون import از Next.js یا React
  src/db/                      کلاینت Kysely، withTransaction، نوع‌های تولیدشده، TLS اتصال و CA پروژه Supabase
  src/<module>/                یک پوشه برای هر شناسه نقشه قابلیت‌ها: plt، acc، quota، org، src، …
    index.ts                   API عمومی ماژول؛ تنها نقطه import برای ماژول‌های دیگر
    *.ts                       پیاده‌سازی داخلی
    *.test.ts                  آزمون واحد، کنار کد
    *.int.test.ts              آزمون یکپارچه با Postgres واقعی
packages/ops-cli/              ابزار خط فرمان اپراتور
supabase/
  config.toml                  پیکربندی Supabase محلی
  migrations/                  migrationهای SQL؛ تنها راه تغییر ساختار دیتابیس
  seed.sql                     داده مصنوعی
docs/                          PRD، FR، ADR، spikeها و همین سند
.github/workflows/ci.yml       CI
```

**قواعد ساختار:**

1. پوشه هر ماژول فقط وقتی ساخته می‌شود که ماژول وارد کار شود؛ پوشه یا صفحه خالی برای آینده ساخته نمی‌شود (PRD-CORE-06).
2. ماژول‌ها فقط از `index.ts` یکدیگر و فقط در جهت ستون «وابسته به» نقشه قابلیت‌ها import می‌کنند. dependency-cruiser این را در `pnpm verify` بررسی می‌کند.
3. هر ماژول schema خودش را در Postgres دارد و جدول ماژول دیگر را مستقیم نمی‌خواند (ADR-0002).
4. کد UI در `apps/web` است. رفتار هر صفحه در FR ماژول مالکش تعریف شده است (قاعده ۵ بخش ۳.۱ سند FR).

## ۶. سبک کد

- **نام‌گذاری:** فایل‌ها kebab-case؛ نوع‌ها PascalCase؛ تابع و متغیر camelCase؛ جدول و ستون snake_case؛ شناسه ماژول با حروف کوچک.
- **بدون `any`؛** ورودی بیرونی همیشه با zod اعتبارسنجی می‌شود.
- **هر تابع تغییردهنده** کاربر جاری را از `ctx` می‌گیرد و مالکیت را سمت سرور بررسی می‌کند (FR-PLT-002).
- **خطاها** کلاس‌های خطای دامنه‌اند و در لبه API به کدهای FR-PLT-003 نگاشت می‌شوند.
- **کامنت** فقط برای «چرا»، با ارجاع به شناسه FR یا AC.
- **متن رابط** انگلیسی است (PRD-ONB-01). محتوا با `lang` و `dir="auto"` نمایش داده می‌شود (FR-PLT-011).

نمونه، برای شکل و نه کد نهایی:

```ts
// packages/core/src/quota/reserve.ts
import type { Tx } from "../db";
import { QuotaInsufficientError } from "./errors";
import type { QuotaAmounts } from "./types";

/** FR-QUOTA-005 — must run in the same transaction that creates the Run and its Job. */
export async function reserveForRun(
  tx: Tx,
  input: { userId: string; runId: string; amounts: QuotaAmounts },
): Promise<void> {
  // Serialize reservations per user so the balance can never go negative.
  const entitlement = await tx
    .selectFrom("quota.entitlement")
    .select(["id"])
    .where("user_id", "=", input.userId)
    .where("valid_from", "<=", new Date())
    .where("valid_to", ">", new Date())
    .forUpdate()
    .executeTakeFirst();
  if (!entitlement) throw new QuotaInsufficientError(input.amounts);

  const balance = await getBalance(tx, entitlement.id);
  if (!covers(balance, input.amounts)) throw new QuotaInsufficientError(input.amounts);

  await tx
    .insertInto("quota.ledger_entry")
    .values({ entitlement_id: entitlement.id, kind: "reserve", source_key: `run:${input.runId}`, ...toColumns(input.amounts) })
    .onConflict((oc) => oc.column("source_key").doNothing()) // idempotent per Run
    .execute();
}
```

```ts
// packages/core/src/quota/reserve.int.test.ts
describe("FR-QUOTA-005 reserve", () => {
  it("AC-13: resubmitting with the same key yields one Run and one reservation", async () => {
    /* … */
  });
});
```

## ۷. راهبرد آزمون

| سطح | ابزار | چه چیزی | محل |
|---|---|---|---|
| واحد | Vitest، بدون دیتابیس | منطق خالص: برآورد و گرد کردن، اعتبارسنجی، نگاشت وضعیت | `*.test.ts` کنار کد |
| یکپارچه | Vitest با Supabase محلی | تراکنش، idempotency، قفل و هم‌زمانی، دسترسی بین دو حساب (NFR-01)، رقابت tombstone با Worker (AC-17)، صف | `*.int.test.ts` |
| E2E | Playwright | جریان‌های اصلی هر مرحله، در مرورگرهای ماتریس FR-PLT-010 | `apps/web/e2e/` |
| دستی و ثبت‌شده | ACCEPTANCE_TEST_PLAN | ضبط روی دستگاه واقعی (SPIKE-01)، وارد کردن APKG در Anki، آزمون تصویری خط‌ها | `docs/` |

**قواعد:**

1. **هر معیار پذیرش** FR حداقل یک آزمون دارد و نام آزمون شناسه FR یا AC را دارد. ستون تست ماتریس ردیابی همراه آزمون به‌روز می‌شود.
2. **سهمیه، مرور و idempotency** فقط با آزمون قطعی سنجیده می‌شوند، نه با ارزیابی AI (PRD-SRS-07).
3. **تأمین‌کننده AI همیشه mock است:** پاسخ‌های ثابت از fixture، و هیچ کلید API در CI.
4. **هر آزمون یکپارچه** روی داده خودش کار می‌کند و به ترتیب اجرا وابسته نیست. schemaها پیش از اجرای مجموعه آزمون پاک می‌شوند.
5. **ورود در آزمون E2E:** در Supabase محلی کاربر آزمونی مستقیم با Admin API ساخته و وارد می‌شود. این مسیر فقط در پیکربندی محلی و CI فعال است و در پروژه ابری وجود ندارد (Q-SPEC-2).
6. **پوشش خط‌ها** گزارش می‌شود ولی دروازه نیست. دروازه، پوشش معیارهای پذیرش است.

**CI** (GitHub Actions؛ سیاست کم‌مصرف، تصمیم مالک محصول 2026-10-13، [docs/ops/CI_LOW_COST_POLICY.md](ops/CI_LOW_COST_POLICY.md): فقط روی push به `main`، pull request به `main` و اجرای دستی `workflow_dispatch`؛ push ساده به شاخه‌های کاری اجرایی ندارد و پیش از PR، `pnpm verify` محلی اجرا می‌شود؛ تغییرات فقط‌مستندات CI ندارند):

1. نصب با Node 24 و pnpm
2. `pnpm lint`، `pnpm typecheck`، `pnpm check:boundaries`
3. بررسی اینکه `db:types` با migrationها هم‌خوان است
4. `supabase start` در runner، سپس `pnpm test`
5. `pnpm build`
6. E2E روی شاخه `main`، اجرای دستی، و PR با برچسب `e2e`

## ۸. محیط‌ها و پیکربندی

| محیط | دیتابیس و فایل | AI | اسرار |
|---|---|---|---|
| محلی | Supabase در Docker، فقط Postgres 17، Auth، Kong و REST؛ لایه ذخیره‌سازی در حافظه یا دیسک محلی (ADR-0001 قاعده ۹) | mock | `.env.local`، که در git نیست |
| CI | Supabase موقت در runner | mock | GitHub Secrets، فقط در صورت نیاز |
| پایلوت | پروژه Supabase `recalino`؛ Vercel Blob خصوصی در `lhr1` | تأمین‌کننده واقعی، پس از G03 و تأیید هزینه | متغیرهای محیطی Vercel |

- `.env.example` فقط نام متغیرها را دارد و commit می‌شود.
- مقدارهای وابسته به دروازه‌ها، مثل سهمیه، سقف هزینه، سطح کیفیت زبان‌ها و سقف فایل، در کد نیستند؛ در جدول پیکربندی یا متغیر محیطی‌اند.
- Deployment پیش‌نمایش Vercel به دیتابیس پایلوت وصل نمی‌شود (Q-SPEC-1).

## ۹. مرزها

### همیشه

- پیش از هر کار، FR و ADR مربوط و وضعیت واقعی مخزن را بخوان.
- پیش از commit، `pnpm verify` را اجرا کن.
- هر شاخه یک کار: `feat/<module>-<topic>`، `fix/…` یا `docs/…`. پیام commit انگلیسی و به سبک `feat:`، `fix:`، `docs:`، `test:`، `chore:`.
- تغییر ساختار دیتابیس فقط با migration تازه؛ پس از آن `pnpm db:types`.
- مالکیت در هر خواندن و نوشتن سمت سرور؛ کلید idempotency در هر درخواست تغییردهنده.
- خروجی LLM فقط پس از اعتبارسنجی Schema.
- فقط داده مصنوعی یا دارای مجوز (فرض A5).
- پس از هر milestone: گزارش آزمون‌ها، دستور اجرا و محدودیت‌های باقی‌مانده.

### اول بپرس

- افزودن هر بسته npm یا سرویس خارجی تازه (D28).
- اعمال migration روی پروژه ابری (`supabase db push`) پیش از ادغام آن در `main`. **استثنا (تصمیم مالک محصول، 2026-10-10):** `db push` برای migrationهای ادغام‌شده در `main`، و نوشتن داده با کانکتور Supabase یا `supabase-dev` در حالت نوشتنی، بدون پرسیدن انجام می‌شود (CLAUDE.md، بخش Supabase MCP).
- ادغام PR کد در `main`، هر استقرار روی Vercel، و تغییر تنظیمات Vercel یا Supabase ابری. **استثنا (اجازه دائمی مالک محصول، 2026-10-01):** PR فقط‌مستندات که فقط تصمیم‌های ثبت‌شده مالک محصول را ثبت می‌کند، پس از سبز شدن CI بدون پرسیدن ادغام می‌شود.
- تغییر CI.
- هر تغییر در ADR پذیرفته‌شده، نقشه قابلیت‌ها، تصمیم D یا FR تأییدشده.
- حذف یا تغییر غیرقابل‌برگشت داده در محیط ابری: `drop`، `truncate`، `delete` یا `update` بدون شرطی که ردیف‌های مشخصی را محدود کند، حذف حساب کاربر، و `supabase db reset`. حذف و تغییر محدود داده بدون پرسیدن انجام می‌شود (تصمیم مالک محصول، 2026-10-10).

### هرگز

- commit کردن اسرار، کلید API یا فایل `.env*` (به‌جز `.env.example`)، یا درخواست کلید در چت.
- نوشتن مقدار پلن، قیمت، سهمیه یا سقف هزینه در کد (G08، NFR-12).
- اجرا یا رندر مستقیم HTML، SQL یا کد تولیدشده توسط مدل؛ یا دسترسی شبکه از HTML ورودی.
- ثبت متن کلاس، transcript، صوت، رمز یا کلید در لاگ (PRD-PRIV-06).
- نگهداری صوت کلاس روی سرور بیرون از قاعده D29، یا ساختن بریده صوت کلاس روی سرور.
- ساختن امکانات خارج از MVP، یا صفحه و زیرساخت فرضی برای آن‌ها (PRD-CORE-06).
- سپردن `due_at`، سهمیه یا دسترسی به LLM.
- به کار بردن کانکتور Supabase در claude.ai روی پروژه‌ای جز `twowhuzhvyuzjrpraikm`، یا تغییر ساختار دیتابیس ابری با `apply_migration` یا `execute_sql` به‌جای migration (CLAUDE.md، بخش Supabase MCP؛ تصمیم‌های مالک محصول 2026-10-02 و 2026-10-10).
- حذف یا skip کردن آزمون شکست‌خورده بدون تأیید.

## ۱۰. معیار موفقیت این سند (milestone راه‌اندازی)

1. روی Windows با WSL2 و Docker، این دستورها روی یک clone تازه بدون خطا اجرا می‌شوند: `pnpm install`، `pnpm db:start`، `pnpm db:reset` و `pnpm verify`.
2. CI همین مراحل را روی GitHub Actions اجرا می‌کند و روی `main` سبز است.
3. `pnpm dev` پوسته اپ را روی `localhost:3000` نشان می‌دهد.
4. یک import خلاف جهت نقشه قابلیت‌ها باعث شکست `pnpm check:boundaries` می‌شود (با یک fixture آزموده می‌شود).
5. تغییر migration بدون اجرای `pnpm db:types` باعث شکست CI می‌شود.

## ۱۱. پرسش‌های پاسخ‌داده‌شده

پیشنهادهای زیر همراه spec در 2026-09-30 تأیید شدند.

| # | پرسش | پاسخ |
|---|---|---|
| Q-SPEC-1 | محیط staging ابری جدا از پایلوت؟ | **تا آماده‌سازی پایلوت نه.** توسعه و آزمون محلی و در CI است؛ Deployment پیش‌نمایش به دیتابیس پایلوت وصل نمی‌شود. پروژه دوم رایگان Supabase در صورت نیاز بعداً staging می‌شود. |
| Q-SPEC-2 | ورود کاربر آزمونی در E2E | **فقط در Supabase محلی و CI** با Admin API؛ در پروژه ابری هیچ روش ورودی جز Google فعال نیست. |
| Q-SPEC-3 | زمان ساخت پروژه Vercel و اتصال به GitHub | پایان مرحله ۱، وقتی اولین نسخه قابل استقرار آماده است. تا آن زمان هیچ استقراری انجام نمی‌شود. |
