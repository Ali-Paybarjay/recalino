# برنامه M0 — راه‌اندازی مخزن

> **وضعیت:** انجام‌شده (2026-09-30) روی شاخه `chore/m0-scaffold`؛ در انتظار تأیید ادغام در `main`  
> **تاریخ:** 2026-09-30  
> **مبنا:** [PROJECT_SPEC](../PROJECT_SPEC.md) (تأییدشده) · [ADR-0001](../adr/0001-stack-and-hosting.md) · [ADR-0002](../adr/0002-data-access-and-migrations.md)

## هدف

اسکلت کار‌کننده مخزن، طبق معیارهای موفقیت PROJECT_SPEC بخش ۱۰. **هیچ FR محصولی در M0 پیاده نمی‌شود:** نه صفحه ورود، نه جدول دامنه، نه ماژول. خروجی فقط زیرساختی است که ماژول PLT در milestone بعدی روی آن ساخته می‌شود.

## تصمیم‌های فنی داخل دامنه spec

| مورد | انتخاب | دلیل |
|---|---|---|
| TypeScript | **6.0.x** | TypeScript 7.0 (2026-09) دیگر API جاوااسکریپتی کلاسیک ندارد که Next.js برای بررسی نوع و ابزارهای دیگر لازم دارند. spec اجازه آخرین نسخه سازگار را داده است. با پشتیبانی Next.js دوباره بررسی می‌شود. |
| پایان خط فایل‌ها | `.gitattributes` با `eol=lf` | هشدارهای CRLF فعلی git حذف می‌شوند و CI و Windows یکسان می‌مانند. |
| Supabase CLI | بسته npm `supabase` به‌عنوان dev dependency | نسخه قفل‌شده برای همه و CI، بدون نصب سراسری. |
| `packages/ops-cli` | در M0 ساخته نمی‌شود | همراه FR-QUOTA-002 ساخته می‌شود (قاعده ۱ ساختار در spec). |
| `@supabase/ssr` | در M0 نصب نمی‌شود | همراه ورود با Google در ACC. zod از M0 نصب می‌شود، چون متغیرهای محیطی با آن اعتبارسنجی می‌شوند (spec بخش ۳). |

## کارها

هر کار در شاخه `chore/m0-scaffold` انجام می‌شود. پس از سبز شدن CI، pull request برای تأیید شما باز می‌شود. ادغام در `main` فقط با تأیید شما انجام می‌شود.

- [x] **T1 — ریشه workspace**
  - **پذیرش:** `pnpm install` روی clone تازه موفق است؛ `pnpm lint` اجرا می‌شود.
  - **بررسی:** `pnpm install && pnpm lint`
  - **فایل‌ها:** `package.json` (با `packageManager` و `engines` روی Node 24)، `pnpm-workspace.yaml`، `.nvmrc`، `tsconfig.base.json`، `biome.json`، `.gitattributes`، `.gitignore`

- [x] **T2 — بسته `packages/core` و لایه دیتابیس**
  - **پذیرش:** کلاینت Kysely روی `pg`، helper به نام `withTransaction`، نوع `Tx`. متغیرهای محیطی اتصال با zod اعتبارسنجی می‌شوند و نبودشان خطای روشن می‌دهد. Vitest با دو project به نام‌های `unit` و `integration`.
  - **بررسی:** `pnpm typecheck && pnpm test:unit`
  - **فایل‌ها:** `packages/core/package.json`، `tsconfig.json`، `src/db/index.ts`، `src/config/env.ts`، `vitest.config.ts`

- [x] **T3 — Supabase محلی و migration پایه**
  - **پذیرش:** `pnpm db:start` و `pnpm db:reset` روی Docker محلی بدون خطا اجرا می‌شوند. migration پایه:
    - نقش `recalino_app` بدون رمز در migration
    - برداشتن دسترسی پیش‌فرض روی schema `public`
    - تنظیمات پیش‌فرض برای schemaهای بعدی ماژول‌ها

    `supabase/config.toml` طبق Q-SPEC-2 تنظیم می‌شود: ورود ایمیلی فقط در محیط محلی و فقط برای آزمون، و Google به‌صورت غیرفعال تا ACC.
  - **بررسی:** `pnpm db:start && pnpm db:reset`
  - **فایل‌ها:** `supabase/config.toml`، `supabase/migrations/<timestamp>_baseline.sql`، `supabase/seed.sql`، اسکریپت‌های `package.json`

- [x] **T4 — تولید نوع و آزمون یکپارچه نمونه**
  - **پذیرش:**
    - `pnpm db:types` نوع‌ها را در `packages/core/src/db/types.ts` می‌سازد.
    - یک آزمون یکپارچه ثابت می‌کند `withTransaction` در خطا rollback می‌کند و اتصال با نقش `recalino_app` برقرار است.
  - **بررسی:** `pnpm db:types && pnpm test:int`
  - **فایل‌ها:** `packages/core/src/db/types.ts`، `packages/core/src/db/transaction.int.test.ts`، اسکریپت `db:types`

- [x] **T5 — اپ وب و آزمون E2E دود**
  - **پذیرش:**
    - `apps/web` با Next.js 16 (App Router) و یک صفحه ساده «Recalino» روی `localhost:3000`، با `lang="en"` و آماده برای `dir="auto"` در محتوا.
    - بدون صفحه برای امکانات آینده.
    - Playwright با یک آزمون دود که صفحه را باز می‌کند.
  - **بررسی:** `pnpm build && pnpm test:e2e`
  - **فایل‌ها:** `apps/web/package.json`، `next.config.ts`، `src/app/layout.tsx`، `src/app/page.tsx`، `playwright.config.ts`، `e2e/smoke.spec.ts`

- [x] **T6 — مرز ماژول‌ها**
  - **پذیرش:**
    - dependency-cruiser قواعد جهت وابستگی نقشه قابلیت‌ها را از یک جدول واحد می‌خواند.
    - `packages/core` هیچ import از Next.js یا React ندارد.
    - یک fixture آزمونی با import خلاف جهت باعث شکست بررسی می‌شود (spec بخش ۱۰، بند ۴).
  - **بررسی:** `pnpm check:boundaries` روی کد سالم موفق و روی fixture ناموفق است.
  - **فایل‌ها:** `.dependency-cruiser.cjs`، `tools/capability-map.json` یا معادل آن، fixture آزمون

- [x] **T7 — دروازه `verify` و CI**
  - **پذیرش:**
    - `pnpm verify` این‌ها را پشت سر هم اجرا می‌کند: lint، typecheck، boundaries و test.
    - `.github/workflows/ci.yml` روی هر push و pull request این مراحل را اجرا می‌کند: نصب با Node 24 و pnpm، lint، typecheck، boundaries، بررسی هم‌خوانی `db:types` با migrationها، `supabase start`، آزمون‌ها و build.
    - E2E فقط روی `main` اجرا می‌شود.
  - **بررسی:** push شاخه و سبز شدن CI در GitHub Actions
  - **فایل‌ها:** `.github/workflows/ci.yml`، اسکریپت‌های `package.json`

- [x] **T8 — مستندات و گزارش milestone**
  - **پذیرش:**
    - بخش دستورهای CLAUDE.md و PROJECT_SPEC با واقعیت اجراشده یکی است.
    - `.env.example` فقط نام متغیرها را دارد.
    - گزارش کوتاه M0 شامل دستورهای اجرا، نتیجه آزمون‌ها و محدودیت‌های باقی‌مانده است.
  - **بررسی:** clone تازه در پوشه موقت؛ `pnpm install && pnpm db:start && pnpm db:reset && pnpm verify`
  - **فایل‌ها:** `CLAUDE.md`، `docs/PROJECT_SPEC.md`، `.env.example`، `docs/plans/M0_REPO_SCAFFOLD.md`

## نقاط بررسی

- **پس از T4:** دیتابیس محلی، migration و آزمون یکپارچه کار می‌کنند. ریسک اصلی M0 همین است.
- **پس از T7:** همان مراحل در CI سبز است.
- **پس از T8:** معیارهای بخش ۱۰ spec روی clone تازه برقرارند و pull request برای تأیید شما آماده است.

## ریسک‌ها

| ریسک | کاهش |
|---|---|
| فاصله در مسیر پروژه (`Claude Projects`) برای بعضی ابزارها روی Windows | در T1 و T3 آزموده می‌شود؛ در صورت مشکل، اسکریپت‌ها مسیر را نقل‌قول‌دار می‌دهند یا راه جایگزین گزارش می‌شود. |
| زمان `supabase start` در CI و سقف دقیقه‌های رایگان GitHub Actions | فقط سرویس‌های لازم (Postgres و Auth) در CI بالا می‌آیند؛ E2E فقط روی `main`. |
| سازگاری pnpm 12 با Next.js 16 | در T1 و T5 بررسی می‌شود. در صورت مشکل، pnpm 10 با تأیید شما جایگزین می‌شود. |

## تصمیمی که پیش از اولین صفحه واقعی لازم است (نه برای M0)

**روش styling رابط.** spec آن را تعیین نکرده است. گزینه رایج Tailwind CSS به همراه کامپوننت‌های shadcn/ui است. این یک وابستگی تازه است و پیش از اولین FR دارای رابط (ACC) پیشنهاد و تأییدش از شما گرفته می‌شود. M0 فقط CSS ساده دارد.

## گزارش M0 (2026-09-30)

### معیارهای موفقیت (PROJECT_SPEC بخش ۱۰)

| # | معیار | نتیجه |
|---|---|---|
| 1 | clone تازه روی Windows: `pnpm install`، `pnpm db:start`، `pnpm db:reset`، `pnpm verify` | ✅ نصب در ۳۲ ثانیه؛ migration و seed اعمال شد؛ ۹ آزمون قبول (۵ واحد، ۴ یکپارچه)؛ build موفق |
| 2 | CI سبز | ✅ روی شاخه، در ۱ دقیقه و ۴۰ ثانیه ([اجرا](https://github.com/Ali-Paybarjay/recalino/actions/runs/36755374865)). روی `main` پس از ادغام اجرا می‌شود و E2E هم آنجا فعال است |
| 3 | `pnpm dev` پوسته اپ را نشان می‌دهد | ✅ آزمون دود Playwright روی `next dev` قبول شد |
| 4 | import خلاف نقشه قابلیت‌ها `check:boundaries` را می‌شکند | ✅ آزمون fixture در `tools/boundaries/` |
| 5 | migration بدون `db:types` CI را می‌شکند | ✅ با یک migration آزمایشی ثابت شد: کد خروج ۱؛ پس از برگرداندن، ۰ |

### دستورها

`pnpm install` · `pnpm db:start` · `pnpm db:reset` · `pnpm db:types` · `pnpm verify` · `pnpm dev` · `pnpm test:e2e` · `pnpm db:stop`

### تفاوت با برنامه و spec (همه در اسناد ثبت شده‌اند)

- **TypeScript 6.0.3.** نسخه 7.0 هنوز API جاوااسکریپتی لازم Next.js را ندارد.
- **CI فقط روی push اجرا می‌شود.** pull request وضعیت همان commit را نشان می‌دهد؛ این کار از اجرای دوباره و مصرف دقیقه‌های رایگان جلوگیری می‌کند.
- **Supabase محلی فقط چهار سرویس دارد:** Postgres 17.6، Auth، Kong و REST. Storage، Realtime، Studio و بقیه خاموش‌اند.
- **نقش `recalino_app` ویژگی BYPASSRLS دارد.** توضیحش در ADR-0002 قاعده ۶ آمده است.
- **تنظیمات Auth محلی در M0 پیش‌فرض ماند.** ورود Google و ورود آزمونی E2E (Q-SPEC-2) همراه ماژول ACC تنظیم می‌شوند.
- **`supabase migration new` در shell غیرتعاملی منتظر ورودی می‌ماند.** در spec راه‌حلش آمده است.

### محدودیت‌ها و کارهای باقی‌مانده

- **پروژه ابری Supabase:** migration پایه اعمال نشده و رمز نقش `recalino_app` تنظیم نشده است. هر دو به تأیید صریح مالک محصول نیاز دارند و همراه اولین استقرار انجام می‌شوند.
- **نسخه Postgres ابری:** باید با نسخه محلی (17.6) مقایسه شود.
- **E2E:** فقط Chromium دسکتاپ. ماتریس مرورگر (FR-PLT-010) پس از SPIKE-01 اضافه می‌شود.
- **ظاهر رابط:** منتظر تحویل طرح از Claude Design است.
- **`pnpm ops`:** همراه FR-QUOTA-002 اضافه می‌شود.
- **telemetry در Next.js:** فقط در CI خاموش است. در محیط محلی با `pnpm --filter @recalino/web exec next telemetry disable` خاموش می‌شود.
