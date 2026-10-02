# راهنمای راه‌اندازی ابری برای M4

> **برای:** مالک محصول · **زمان تقریبی:** ۲۰ دقیقه · **هزینه:** ندارد (پلن فعلی Vercel و Supabase رایگان)  
> **مبنا:** [برنامه M4](../plans/M4_QUEUE_STORAGE.md) · [ADR-0001](../adr/0001-stack-and-hosting.md) · [ADR-0002](../adr/0002-data-access-and-migrations.md) · [SECRETS.md](SECRETS.md)

این راهنما محیط ابری را فقط برای اندازه‌گیری‌های SPIKE-05 و آزمون صف و ذخیره‌سازی آماده می‌کند. هیچ نشانی‌ای عمومی نمی‌شود و هیچ زبان‌آموزی وارد نمی‌شود.

**هیچ رمز یا کلیدی را در چت یا فایل‌های مخزن ننویسید.** فقط در داشبورد Supabase و Vercel وارد می‌شوند.

## بخش من — ✅ انجام شد (2026-10-02)

با Vercel CLI که روی همین کامپیوتر به حساب شما وصل است:

1. پروژه `recalino` را در تیم فعلی می‌سازم: پوشه اپ `apps/web` و Functions در `lhr1`. پروژه به GitHub وصل نمی‌شود.
2. محافظت **All Deployments** با Vercel Authentication را پیش از نخستین deploy فعال می‌کنم.
3. یک Blob store **خصوصی** به نام `recalino-files` در `lhr1` می‌سازم و به پروژه وصل می‌کنم. اتصال از طریق CLI یک توکن ماندگار `BLOB_READ_WRITE_TOKEN` هم در متغیرهای رمزشده پروژه ثبت کرد. در spike اتصال با OIDC آزموده می‌شود و اگر کار کرد، این توکن حذف می‌شود.
4. `RATE_LIMIT_IP_KEY` و `CRON_SECRET` را با مقدار تصادفی مستقیم در Vercel ثبت می‌کنم. مقدارها جایی نمایش داده یا ذخیره نمی‌شوند.
5. `SUPABASE_URL` را ثبت می‌کنم. این مقدار سری نیست، ولی سیاست تیم شما همه متغیرهای Production و Preview را Sensitive می‌خواهد.

وقتی پروژه آماده شد، خبرتان می‌کنم تا بخش خودتان را انجام دهید.

## بخش شما

### ۱. اعمال migrationها روی Supabase ابری

در ترمینال (PowerShell، یا ترمینال VS Code)، در پوشه `D:\Claude Projects\Recalino`، این دستورها را **یکی‌یکی** اجرا کنید:

```bash
pnpm exec supabase login
pnpm exec supabase link --project-ref twowhuzhvyuzjrpraikm
pnpm exec supabase db push --dry-run
pnpm exec supabase db push
```

- **`login`:**
  - مرورگر باز می‌شود. با **حساب Supabase ریکالینو** وارد شوید، نه حساب قدیمی.
  - اگر مرورگر یک کد تأیید نشان داد، آن را در ترمینال بنویسید و Enter بزنید.
- **`link`:**
  - رمز دیتابیس را می‌پرسد. هنگام تایپ چیزی نمایش داده نمی‌شود؛ عادی است.
  - رمز در داشبورد Supabase، در **Project Settings ← Database** است. اگر آن را ندارید، **Reset database password** را بزنید و رمز تازه را به کار ببرید. هنوز چیزی به این دیتابیس وصل نیست، پس reset کردن مشکلی ندارد.
  - اگر هشداری درباره تفاوت تنظیمات محلی و پروژه دیدید، نادیده بگیرید. دستور `config push` را **اجرا نکنید**.
- **`db push --dry-run`:** فقط فهرست را نشان می‌دهد و چیزی را تغییر نمی‌دهد. باید دقیقاً این پنج migration را ببینید:
  - `20260930175238_baseline.sql`
  - `20261001100505_plt_core.sql`
  - `20261001200000_acc_core.sql`
  - `20261002094004_plt_jobs.sql`
  - `20261002094723_plt_storage.sql`

  اگر فهرست چیز دیگری بود، ادامه ندهید و خبرم کنید.
- **`db push`:**
  - همان فهرست را نشان می‌دهد و می‌پرسد: `Do you want to push these migrations to the remote database? [Y/n]`
  - `Y` را بنویسید و Enter بزنید.
  - پایانش پیامی مثل `Finished supabase db push.` است.
- **`--include-seed` را به کار نبرید.** seed فقط برای محیط محلی است.

### ۲. رمز نقش اپ

رمز هرگز در SQL Editor، چت یا فایل‌های مخزن نوشته نمی‌شود. فقط verifier آن به Supabase می‌رسد. گام‌های ۲ تا ۴ برای راه‌اندازی نخستین است. برای عوض کردن رمز روی پروژه‌ای که کار می‌کند، بخش «چرخش رمز دیتابیس» در [SECRETS.md](SECRETS.md) را دنبال کنید. آن بخش استقرار تازه را هم دارد.

1. در ترمینال، در پوشه `D:\Claude Projects\Recalino`، اجرا کنید:

   ```bash
   pnpm db:new-password
   ```

   - رمز تصادفی می‌سازد و رشته اتصال کامل را در `%USERPROFILE%\.recalino\database-url.txt` می‌نویسد. رمز و رشته را نشان نمی‌دهد.
   - فقط یک خط SQL چاپ می‌کند: `alter role recalino_app with password 'SCRAM-SHA-256$4096:…';`. این verifier رمز است، نه خود رمز.
   - اگر آن فایل از قبل باشد، ابزار متوقف می‌شود. فایل قبلی را حذف کنید و دوباره اجرا کنید.
2. در داشبورد Supabase، **SQL Editor** را باز کنید. همان یک خط را paste و اجرا کنید.
   - Postgres verifier را همان‌طور نگه می‌دارد. پس در لاگ دیتابیس فقط verifier ثبت می‌شود، نه رمز.

### ۳. رشته اتصال

رشته اتصال را ابزار گام ۲ ساخته است: نقش `recalino_app.twowhuzhvyuzjrpraikm` روی `aws-0-eu-west-2.pooler.supabase.com:6543`، یعنی Transaction pooler. **بدون فاصله یا خط تازه؛ پیش از ثبت در Vercel با این ابزار بیازمایید:**

```bash
pnpm db:url-check
```

- **نتیجه درست:**
  - خط آخر `RESULT: OK` است.
  - `TLS version` برابر `TLSv1.3` است.
  - جلوی `certificate verified` نوشته شده `yes`.
  - `current_user` برابر `"recalino_app"` است.
- **خطای `28P01` درست پس از گام ۲:** pooler رمز قبلی را برای مدت کوتاهی نگه می‌دارد. یک دقیقه صبر کنید و فقط یک بار دیگر اجرا کنید. پشت سر هم تکرار نکنید، چون چند شکست پیاپی IP شما را تا ۲ دقیقه مسدود می‌کند.
- **چه چیزی رد می‌شود:** هر فاصله، خط تازه یا نویسه کنترلی، در هر جای مقدار. پارامتر query هم رد می‌شود، مثل `?sslmode=...`. اپ هم همین‌ها را با خطای روشن رد می‌کند، چون TLS و سنجش گواهی را خودش تنظیم می‌کند.

### ۴. ثبت در Vercel

در Vercel، پروژه `recalino` را باز کنید و به **Settings ← Environment Variables** بروید. این سه را برای **Production** و **Preview** اضافه کنید و گزینه **Sensitive** را روشن کنید:

| نام | مقدار |
|---|---|
| `DATABASE_URL` | محتوای فایل `%USERPROFILE%\.recalino\database-url.txt`. آن را در Notepad باز کنید، با Ctrl+A و Ctrl+C کپی کنید و بلافاصله تب را با Ctrl+W ببندید. |
| `SUPABASE_PUBLISHABLE_KEY` | در Supabase: **Project Settings ← API Keys**، کلید publishable |
| `SUPABASE_SECRET_KEY` | در همان صفحه، یک کلید secret تازه با نام `vercel` بسازید |

پس از ثبت و استقرار تازه، فایل `database-url.txt` را حذف کنید. clipboard و تاریخچه آن (Win+V) را هم خالی کنید.

### ۵. خبر دادن

در چت فقط بنویسید «انجام شد». مقدارها را ننویسید.

## اگر جایی گیر کردید

- **`db push` خطای اتصال داد:** رمز دیتابیس در `link` درست نبوده است. `link` را دوباره اجرا کنید.
- **نمی‌دانید کدام حساب Supabase باز است:** در داشبورد، پروژه باید `recalino` با ref بالا باشد. پروژه‌های Arkan، Altura و financial-assistant مال حساب دیگرند.
- **پاک کردن همه چیز:** پروژه Vercel و Blob store با یک دستور حذف می‌شوند. دیتابیس ابری فقط ساختار جدول‌ها و داده مصنوعی spike را دارد.
