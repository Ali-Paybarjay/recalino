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

1. در ترمینال یک رمز تصادفی بسازید:

   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```

2. در داشبورد Supabase، **SQL Editor** را باز کنید و این را اجرا کنید، با رمز گام قبل به‌جای `<رمز>`:

   ```sql
   alter role recalino_app with password '<رمز>';
   ```

### ۳. رشته اتصال

1. در داشبورد Supabase، دکمه **Connect** را بزنید و بخش **Transaction pooler** را باز کنید. نشانی با پورت `6543` را کپی کنید.
2. در آن نشانی دو چیز را عوض کنید:
   - نام کاربر `postgres.twowhuzhvyuzjrpraikm` ← `recalino_app.twowhuzhvyuzjrpraikm`
   - `[YOUR-PASSWORD]` ← رمز گام ۲

### ۴. ثبت در Vercel

در Vercel، پروژه `recalino` را باز کنید و به **Settings ← Environment Variables** بروید. این سه را برای **Production** و **Preview** اضافه کنید و گزینه **Sensitive** را روشن کنید:

| نام | مقدار |
|---|---|
| `DATABASE_URL` | رشته اتصال گام ۳ |
| `SUPABASE_PUBLISHABLE_KEY` | در Supabase: **Project Settings ← API Keys**، کلید publishable |
| `SUPABASE_SECRET_KEY` | در همان صفحه، یک کلید secret تازه با نام `vercel` بسازید |

### ۵. خبر دادن

در چت فقط بنویسید «انجام شد». مقدارها را ننویسید.

## اگر جایی گیر کردید

- **`db push` خطای اتصال داد:** رمز دیتابیس در `link` درست نبوده است. `link` را دوباره اجرا کنید.
- **نمی‌دانید کدام حساب Supabase باز است:** در داشبورد، پروژه باید `recalino` با ref بالا باشد. پروژه‌های Arkan، Altura و financial-assistant مال حساب دیگرند.
- **پاک کردن همه چیز:** پروژه Vercel و Blob store با یک دستور حذف می‌شوند. دیتابیس ابری فقط ساختار جدول‌ها و داده مصنوعی spike را دارد.
