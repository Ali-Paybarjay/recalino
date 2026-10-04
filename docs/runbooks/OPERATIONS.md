# ابزار عملیات

`pnpm ops --help` ابزار داخلی است و هیچ مسیر وب برای تغییر سهمیه یا پیکربندی اپراتور ایجاد نمی‌کند. هویت اپراتور نیاز به پروفایل یادگیری ندارد؛ دسترسی دیتابیس باید از محیط معتبر اپراتور تأمین شود. `DATABASE_URL` الزامی است و مقصد دیگری حدس زده نمی‌شود.

```powershell
pnpm ops --input D:\config\request.json --env D:\config\operator.env
```

فایل JSON دارای `version: "1"`، `command`، `actorId`، `reason`، `operationKey` و `input` است. فرمان‌های موجود: `quota.grant`، `quota.adjust`، `quota.close`، `cost.configure`، `source.configure` و `stats`. تغییر مالی با کلید تکراری دوباره اعمال نمی‌شود. ظرفیت و قیمت نمونه زیر صرفاً آزمون مصنوعی‌اند؛ تنظیم تجاری باید صریحاً تصویب شود.

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
