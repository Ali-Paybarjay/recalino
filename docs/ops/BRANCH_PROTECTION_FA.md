# دروازهٔ CI پیش از production و Dependabot — چک‌لیست مالک محصول

> **تصمیم:** [D83 و D84](../PRODUCT_DECISIONS_LOG.md) (مالک محصول، 2026-10-19؛ یافته‌های OPS-04 و OPS-10 [ممیزی 2026-10-18](../audit/2026-10-18-project-audit.md)).
> **وضعیت:** آماده برای اجرا توسط مالک محصول. Claude تنظیمات GitHub و Vercel را تغییر نمی‌دهد؛ این سند فقط گام‌هاست.
> **هزینه:** ندارد. ruleset، Deployment Checks و Dependabot روی پلن فعلی GitHub و Vercel‌اند و CI همان الگوی [کم‌مصرف](CI_LOW_COST_POLICY.md) را دارد.

## چرا

تا امروز Vercel هر push به `main` را، بی‌توجه به نتیجهٔ CI، مستقیم در production مستقر می‌کند ([RELEASE_RUNBOOK](../plans/RELEASE_RUNBOOK_2026-10-12.md) بخش ۱۰، بند ۵). یک ادغام با آزمون قرمز ولی build سبز فوراً برای همه زنده می‌شود. پس از این چک‌لیست:

- به `main` فقط با PR می‌شود چیزی افزود، و PR فقط با check سبز «Lint, types, boundaries, tests, build» ادغام می‌شود؛
- Vercel استقرار production را می‌سازد، ولی دامنهٔ `recalino.vercel.app` را فقط پس از سبز شدن همان check روی همان commit به آن می‌دهد.

نام دقیق check همان `name` job `verify` در [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) است: **`Lint, types, boundaries, tests, build`**. نام workflow: `CI`. job `End-to-end (main, manual runs, PRs labeled e2e)` الزامی **نمی‌شود**، چون روی PR بی‌برچسب `e2e` اجرا نمی‌شود و PR را برای همیشه منتظر نگه می‌داشت.

## ۱. ruleset برای `main` در GitHub

- [ ] مخزن را در GitHub باز کنید: **Settings ← Rules ← Rulesets ← New ruleset ← New branch ruleset**.
- [ ] **Ruleset name:** `main` · **Enforcement status:** `Active`.
- [ ] **Bypass list ← Add bypass ← Repository admin**، با حالت **For pull requests only**. این فقط برای حالت اضطرار است (بخش «حالت‌های خاص» پایین)؛ push مستقیم حتی برای مدیر هم رد می‌شود.
- [ ] **Target branches ← Add target ← Include default branch**.
- [ ] در **Branch rules** این‌ها را روشن کنید:
  - [ ] **Restrict deletions**
  - [ ] **Block force pushes**
  - [ ] **Require a pull request before merging** با **Required approvals: 0** (مخزن یک عضو دارد و نویسندهٔ PR نمی‌تواند PR خودش را تأیید کند).
  - [ ] **Require status checks to pass ← Add checks**: `Lint, types, boundaries, tests, build`، منبع GitHub Actions. اگر در فهرست نیست، check باید در ۷ روز گذشته دست‌کم یک بار اجرا شده باشد؛ یک بار CI را دستی اجرا کنید (Actions ← CI ← Run workflow ← `main`).
  - **Require branches to be up to date before merging** را **روشن نکنید**: هر ادغام دیگر را مجبور به اجرای دوبارهٔ CI می‌کند و با سیاست کم‌مصرف نمی‌خواند.
- [ ] **Create** را بزنید.

## ۲. Vercel Deployment Checks

- [ ] Vercel ← پروژهٔ `recalino` ← **Settings ← Deployment Checks** (در داشبورد فعلی ممکن است زیر **Build and Deployment** باشد).
- [ ] **Add Checks ← GitHub** و check `Lint, types, boundaries, tests, build` را انتخاب کنید. ذخیره کنید.
- [ ] نتیجه: استقرار production از `main` ساخته می‌شود و در حالت انتظار check می‌ماند. فقط وقتی check همان commit سبز شد، دامنهٔ production به آن داده می‌شود. اگر check قرمز شد، production روی استقرار قبلی می‌ماند.
- [ ] بررسی خواندنی در ترمینال: `vercel project checks --blocks deployment-alias` باید همین check را نشان دهد.

## ۳. Dependabot فقط امنیتی (D84)

فایل [`.github/dependabot.yml`](../../.github/dependabot.yml) به‌روزرسانی نسخه‌ای را خاموش نگه می‌دارد (`open-pull-requests-limit: 0`). به‌روزرسانی امنیتی باید در تنظیمات روشن شود:

- [ ] **Settings ← Advanced Security** (یا **Code security**): **Dependency graph**، **Dependabot alerts** و **Dependabot security updates** را روشن کنید. **Dependabot version updates** لازم نیست.
- [ ] نتیجه: برای advisory امنیتی یک وابستگی npm، Dependabot یک PR به `main` باز می‌کند و CI روی آن اجرا می‌شود. ادغام همچنان با شماست، مثل هر PR دیگر. دقیقهٔ Actions فقط برای CI همان PR مصرف می‌شود.
- Dependabot هنوز ممکن است lockfile نسخهٔ pnpm 12 را نشناسد؛ اگر PR امنیتی با خطای lockfile ساخته نشد، `pnpm audit` دستی و ارتقای دستی جایگزین است.

## ۴. بررسی پس از تنظیم

- [ ] `git push origin HEAD:main` از یک شاخهٔ آزمایشی رد شود (پیام rule violation).
- [ ] در یک PR آزمایشی، دکمهٔ Merge تا سبز شدن «Lint, types, boundaries, tests, build» غیرفعال باشد.
- [ ] پس از نخستین ادغام، در Vercel ← Deployments، استقرار production ابتدا منتظر check و سپس promote شود.
- [ ] در چت فقط بنویسید «دروازهٔ CI فعال شد».

## حالت‌های خاص

- **PR فقط‌مستندات:** CI با `paths-ignore` اجرا نمی‌شود (سیاست کم‌مصرف، قاعدهٔ ۴)، پس check الزامی هرگز گزارش نمی‌شود و PR منتظر می‌ماند. دو راه: (الف) Actions ← CI ← **Run workflow** روی شاخهٔ همان PR؛ check روی همان commit ثبت می‌شود (حدود ۱۰ تا ۲۵ دقیقه). (ب) چون فقط مستندات است، ادغام با bypass مدیر («Merge without waiting for requirements»).
- **ادغام فقط‌مستندات در `main`:** CI اجرا نمی‌شود و استقرار production آن commit منتظر check می‌ماند و promote نمی‌شود. production روی استقرار قبلی با همان کد اپ می‌ماند؛ این انتظار درست است. اگر promote لازم شد، CI را دستی روی `main` اجرا کنید.
- **Actions از کار افتاده (D67):** PR با check الزامی ادغام نمی‌شود. فقط پس از اجرای کامل محلی طبق D67 (`pnpm verify`، `pnpm build`، `pnpm check:client-bundle`، `pnpm test:e2e`) و ثبت خلاصه در PR، مالک با bypass ادغام می‌کند. Vercel Deployment Checks در این حالت promote نمی‌کند؛ promote دستی (`vercel promote <deployment>`) تصمیم صریح مالک است.
- **Rollback:** Instant Rollback در Vercel به ruleset و check وابسته نیست و مثل قبل کار می‌کند.
- **سشن‌های Claude:** هرگز مستقیم به `main` push نمی‌کنند؛ با ruleset این قاعده در GitHub هم اعمال می‌شود.

## بازگشت

ruleset را در GitHub روی **Disabled** بگذارید و check را از Vercel Deployment Checks بردارید. هر دو بدون اثر بر کد یا داده‌اند. بازگشت تصمیم مالک محصول است و در دفتر تصمیم‌ها ثبت می‌شود.
