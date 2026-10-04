# ابزار عملیات

`pnpm ops -- --help` ابزار داخلی است و هیچ مسیر وب برای تغییر سهمیه یا پیکربندی اپراتور ایجاد نمی‌کند. هویت اپراتور نیاز به پروفایل یادگیری ندارد؛ دسترسی دیتابیس باید از محیط معتبر اپراتور تأمین شود. `DATABASE_URL` الزامی است و مقصد دیگری حدس زده نمی‌شود. جداکنندهٔ `--` در pnpm 12 آرگومان‌ها را به خود ابزار می‌رساند.

```powershell
pnpm ops -- --input D:\config\request.json --env D:\config\operator.env
```

فایل JSON دارای `version: "1"`، `command`، `actorId`، `reason`، `operationKey` و `input` است. فرمان‌های موجود: `pilot.grant`، `quota.grant`، `quota.adjust`، `quota.close`، `cost.configure`، `source.configure` و `stats`. تغییر مالی با کلید تکراری دوباره اعمال نمی‌شود. ظرفیت و قیمت نمونه زیر صرفاً آزمون مصنوعی‌اند؛ تنظیم تجاری باید صریحاً تصویب شود.

## اعطای سهمیهٔ پایلوت هشت‌نفره

سیاست مصوب در `config/pilot-defaults.json` و درخواست تنظیم سقف هزینه در `config/pilot-cost-policy.json` هستند. سقف هزینه در 2026-10-04 روی پروژهٔ Supabase اعمال شد؛ این کار سوابق هزینه یا رزروها را پاک نمی‌کند.

برای هر حساب واقعیِ پذیرفته‌شده از `pilot.grant` استفاده کنید. فایل درخواست خصوصی باید این شکل را داشته باشد؛ جای‌نگهدارها پیش از اجرا با مقادیر واقعی پر شوند و فایل خارج از Git نگهداری شود:

```json
{
  "version": "1",
  "command": "pilot.grant",
  "actorId": "product-owner",
  "reason": "Owner-approved initial pilot participant",
  "operationKey": "pilot:recalino-2026-10-04:<lowercase-user-uuid>:initial",
  "input": {
    "userId": "<real-account-uuid>",
    "policy": {
      "version": "pilot-2026-10-04-approved",
      "pilotId": "recalino-2026-10-04",
      "maximumParticipants": 8,
      "periodDays": 30,
      "amounts": {
        "audio": 36000,
        "document": 100,
        "regeneration": 20,
        "tts": 20000,
        "storage": 524288000
      }
    },
    "startsAt": "<persisted-UTC-start>"
  }
}
```

زمان پایان دقیقاً ۳۰ روز پس از شروع محاسبه می‌شود. **برای تکرار، همان فایل و زمان شروع را نگه دارید**؛ زمان تازه یا policy متفاوت پذیرفته نمی‌شود و مصرف قبلی به موجودی اضافه نمی‌شود. پذیرش نفر هشتم و رد نفر نهم زیر قفل مشترک و در همان تراکنش اعطای سهمیه انجام می‌شوند. شرکت‌کنندهٔ منقضی یا بسته‌شده همچنان در تعداد پذیرش‌های این پایلوت حساب می‌شود؛ تمدید سهمیهٔ اولیه با کلید تازه ممکن نیست. اولین پذیرش، fingerprint سیاست را ثابت می‌کند.

ورود Google خودکار سهمیه نمی‌دهد. این محدودیت، شرکت‌کنندگان **دارای سهمیه** را کنترل می‌کند و allowlist ورود نیست. فضای نام `pilot:` برای فرمان محدودشده رزرو است و با `quota.grant` معمولی قابل استفاده نیست. هیچ شناسهٔ حساب مصنوعی برای پرکردن هشت جایگاه ساخته نمی‌شود.

## اعطای عمومی سهمیه و سایر فرمان‌ها

```json
{
  "version": "1",
  "command": "quota.grant",
  "actorId": "operator-name",
  "reason": "Explicitly approved synthetic test period",
  "operationKey": "replace-with-unique-request-key",
  "input": {
    "userId": "replace-with-owned-account-uuid",
    "startsAt": "2026-10-04T00:00:00Z",
    "endsAt": "2026-10-05T00:00:00Z",
    "amounts": { "audio": 0, "document": 1, "regeneration": 0, "tts": 0, "storage": 0 }
  }
}
```

واحدها: `audio` ثانیه، `document` صفحه یا صفحه معادل متن طبق قرارداد، `regeneration` نوبت، `tts` کاراکتر و `storage` بایت. `quota.adjust` ورودی `userId`, `entitlementId`, `dimension`, `delta` دارد و موجودی منفی را رد می‌کند. `quota.close` ورودی شناسه حساب و entitlement دارد.

`cost.configure` ورودی نسخه، `currency`, `killSwitch` و سقف‌های `session`, `userMonth`, `systemDay`, `systemMonth` برحسب micros دارد. نبود تنظیم یا فعال بودن kill-switch تماس AI را قبل از dispatch متوقف می‌کند. `source.configure` کل قرارداد نسخه‌دار SRC را می‌گیرد؛ محتوای نسخه موجود تغییرپذیر نیست. تنظیم ظرفیت فایل/صفحه/مدت تجاری از پیش‌فرض فنی renderer و TTS جداست.

`stats` ورودی `since` به‌صورت زمان ISO UTC می‌گیرد. خروجی فقط شمارش حالت‌های Job/Run، خطاهای امنیتی، حجم فایل و هزینه تجمیع‌شده است؛ payload، prompt، متن کلاس، کلید خصوصی فایل و اتصال دیتابیس چاپ نمی‌شوند. هزینه واقعی، برآورد و hold حل‌نشده جدا گزارش می‌شوند. خواندن گزارش نیز در audit ثبت می‌شود.

Restore باید در محیط ایزوله آزمایش شود و نشان‌های حذف `acc.deleted_at`، `org.deleted_at`، SRC و رسیدهای PRIV قبل از بازکردن سرویس دوباره اعمال شوند. در پلن Free سوپابیس، قابلیت و چرخه Backup از قرارداد میزبان بررسی می‌شود؛ عدد RPO/RTO یا SLA منتشرشده بدون آزمون عملی ادعا نمی‌شود.

تست‌های مرورگر محلی فقط با Auth روی `localhost` یا `127.0.0.1`، فعال‌بودن صفحات آزمایشی و `RECALINO_TEST_JOURNAL=1` از رسید حذف رمزگذاری‌شده در `MemoryObjectStore` استفاده می‌کنند. Playwright این پرچم را فقط به سرور آزمون محلی می‌دهد. وجود هر مقدار `VERCEL_ENV` یا اتصال به Auth ابری، این مسیر را غیرفعال می‌کند؛ در اجرای عادی نبود کلید و storage واقعی همچنان خطاست. کلید ۳۲بایتی و فایل‌های این fixture فقط تا پایان فرایند زنده‌اند و دوام پس از restart یا restore را ثابت نمی‌کنند. آزمون‌های OPS و restore ایزوله، مسیر واقعی دوام بکاپ و journal را بررسی می‌کنند.
