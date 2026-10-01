# قرارداد API — ریکالینو (Recalino)

> **وضعیت:** نسخه ۰٫۱ — همراه M1 (2026-10-01)  
> **مبنا:** [FR ماژول PLT](fr/PLT.md) · پیاده‌سازی: `packages/core/src/plt/errors.ts` و `apps/web/src/server/api.ts`

همه مسیرهای API از wrapper مشترک `defineRoute` عبور می‌کنند و در `apps/web/src/server/routes.ts` ثبت می‌شوند. مسیر ثبت‌نشده یا مسیر کاربری بدون آزمون بین‌حسابی، آزمون پوشش را می‌شکند (FR-PLT-002، NFR-01).

## پاکت خطا (FR-PLT-003)

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Some information is missing or not valid.",
    "details": { "fields": { "title": ["too_big"] } },
    "request_id": "6f1c2a0e-3b9d-4c55-9a51-2b0e7d8f4c11"
  }
}
```

- `code` پایدار و ماشینی است. `message` جمله‌ای ساده و انگلیسی برای نمایش است. صفحه‌ها می‌توانند متن خودشان را برای هر کد نشان دهند.
- `details` اختیاری است. برای `validation_failed` شامل کد مشکل هر فیلد است، هرگز مقدار ورودی.
- خطای پیش‌بینی‌نشده فقط `internal` و `request_id` برمی‌گرداند. stack، SQL، مسیر داخلی، URL امضاشده و محتوای کلاس هرگز در پاسخ نمی‌آیند.

| `code` | HTTP | کاربرد |
|---|---|---|
| `unauthenticated` | 401 | نشست معتبر نیست |
| `not_found` | 404 | منبع وجود ندارد **یا** متعلق به کاربر دیگری است؛ دو حالت یکسان پاسخ می‌گیرند |
| `validation_failed` | 400 | ورودی نامعتبر، JSON خراب یا کلید idempotency جاافتاده |
| `conflict` | 409 | وضعیت ناسازگار، مثلاً درخواست هم‌زمانی که هنوز تمام نشده |
| `idempotency_mismatch` | 422 | همان کلید idempotency با بدنه یا مسیر دیگر |
| `rate_limited` | 429 | عبور از کنترل نرخ؛ همراه `Retry-After` |
| `quota_insufficient` | 403 | سهمیه کافی نیست (QUOTA) |
| `payload_too_large` | 413 | فایل یا بدنه بزرگ‌تر از سقف |
| `unsupported_media` | 415 | نوع فایل پشتیبانی نمی‌شود |
| `internal` | 500 | خطای پیش‌بینی‌نشده |

## سرآیندها

| سرآیند | جهت | معنی |
|---|---|---|
| `x-request-id` | پاسخ | شناسه یکتای هر درخواست؛ همان `request_id` پاکت خطا و لاگ |
| `Idempotency-Key` | درخواست | الزامی برای ساخت منبع، مصرف سهمیه و آغاز کار AI؛ ۸ تا ۲۰۰ نویسه از `A-Z a-z 0-9 _ . : -`. در محدوده همان کاربر معتبر است و ۲۴ ساعت نگه داشته می‌شود (قابل پیکربندی) |
| `idempotent-replayed` | پاسخ | `true` وقتی پاسخ، تکرار پاسخ نخست همان کلید است |
| `Retry-After` | پاسخ | ثانیه‌های لازم پیش از تلاش دوباره، همراه `rate_limited` |

## مسیرها

| شناسه | مسیر | دسترسی | idempotency | کنترل نرخ |
|---|---|---|---|---|
| `health` | `GET /api/health` | عمومی | — | — |
