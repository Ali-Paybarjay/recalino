# پیکربندی Auth ابری (Supabase `recalino`)

> **تاریخ ساخت:** 2026-10-18 (OPS-11) · **مالک:** مالک محصول · **وضعیت مقدارها:** در این نسخه مقدارهای فعلی داشبورد خوانده **نشده‌اند**. ستون «فعلی» خالی است و مالک محصول آن را از داشبورد پر می‌کند و تاریخ بررسی را می‌نویسد.

تنظیمات Auth پروژهٔ ابری (پروژه `twowhuzhvyuzjrpraikm`) فقط در داشبورد Supabase است. `supabase/config.toml` فقط Supabase محلی را می‌سازد و مقدارهای localhost دارد. این سند مقدارهای غیرمحرمانهٔ لازم برای ورود را ثبت می‌کند تا بازسازی پس از خرابی یا اشتباه به حافظهٔ اپراتور وابسته نباشد. هیچ secret، Client secret یا کلیدی در این سند نمی‌آید.

## هشدار: `supabase config push`

**`supabase config push` (و هر دستور CLI که `config.toml` را روی پروژهٔ ابری بنویسد) فقط با اجازهٔ صریح مالک محصول و برای همان بار اجرا می‌شود.** (قاعدهٔ Supabase CLI در [CLAUDE.md](../../CLAUDE.md).)

دلیل: فایل `supabase/config.toml` مقدارهای محلی دارد و push آن‌ها را روی ابر می‌نویسد:

| در `config.toml` | اثر push روی ابر |
|---|---|
| `site_url = "http://localhost:3000"` | Site URL ابری به localhost برمی‌گردد |
| `additional_redirect_urls` فقط دو callback محلی | callbackهای Vercel از فهرست ابری حذف می‌شوند و ورود با `redirect_uri` نامجاز شکست می‌خورد |
| `[auth.external.google]` با `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_*)` | اگر این متغیرها در شل push نباشند، مقدار ابری provider ممکن است با مقدار خالی جایگزین یا خاموش شود |
| `skip_nonce_check = true` | بررسی nonce ابری، که عمداً روشن است، خاموش می‌شود |
| `enable_signup`، `jwt_expiry`، rate limitها، سیاست رمز و … | هر تنظیم دیگر هم با مقدار محلی جایگزین می‌شود |

برای مشاهده فقط داشبورد و `pnpm auth:check` (فقط‌خواندنی) را به کار ببرید. تغییر Auth ابری را از داشبورد انجام دهید و همین سند را همان روز به‌روز کنید.

## مقدارهای غیرمحرمانه

ستون «آخرین ثبت مستند» از اسناد دیگر مخزن آمده و **بررسی‌شدهٔ امروز نیست**؛ مبنایش در ستون آخر است. ستون «فعلی» را مالک از داشبورد پر می‌کند (`‹ثبت نشده›` یعنی هنوز پر نشده).

**تاریخ بررسی داشبورد:** `‹ثبت نشده›`

| تنظیم | مسیر در داشبورد | محلی (`config.toml`) | آخرین ثبت مستند | فعلی (از داشبورد) |
|---|---|---|---|---|
| Site URL | Authentication ← URL Configuration | `http://localhost:3000` | `https://recalino-ali-paybarjay-s-projects.vercel.app` (2026-10-04)؛ پیشنهادشده: `https://recalino.vercel.app` | `‹ثبت نشده›` |
| Redirect URLs | Authentication ← URL Configuration | دو callback محلی | فهرست زیر | `‹ثبت نشده›` |
| Provider Google فعال | Authentication ← Sign In / Providers | روشن (فقط محلی) | **تعارض مستند:** [GOOGLE_CLOUD_ACTIVATION.md](GOOGLE_CLOUD_ACTIVATION.md) برای 2026-10-04 «فعال» می‌گوید، ولی بررسی تکمیلی همان تاریخ در [CLAUDE.md](../../CLAUDE.md) «غیرفعال» ثبت کرده | `‹ثبت نشده›` |
| Google Client ID (غیرمحرمانه) | همان صفحهٔ provider | از `.env` ریشه (محلی) | در اسناد ثبت نشده | `‹ثبت نشده›` |
| Callback گوگل به Supabase | Google Cloud ← OAuth Client ← Authorized redirect URIs | — | `https://twowhuzhvyuzjrpraikm.supabase.co/auth/v1/callback` | `‹ثبت نشده›` |
| ثبت‌نام کاربر تازه (`enable_signup`) | Authentication ← Sign In / Providers | `true` | در اسناد ثبت نشده | `‹ثبت نشده›` |
| تأیید ایمیل (`enable_confirmations`) | Authentication ← Sign In / Providers ← Email | `false` | در اسناد ثبت نشده | `‹ثبت نشده›` |
| ورود ناشناس | Authentication ← Sign In / Providers | `false` | در اسناد ثبت نشده | `‹ثبت نشده›` |
| `jwt_expiry` (ثانیه) | Project Settings ← JWT / API | `3600` | در اسناد ثبت نشده | `‹ثبت نشده›` |
| Refresh token rotation | Authentication ← Sessions | روشن | در اسناد ثبت نشده | `‹ثبت نشده›` |
| فاصلهٔ استفادهٔ دوبارهٔ refresh token (ثانیه) | Authentication ← Sessions | `10` | در اسناد ثبت نشده | `‹ثبت نشده›` |
| بررسی nonce (`skip_nonce_check`) | همان صفحهٔ provider Google | `true` (فقط محلی) | روشن‌بودن بررسی در ابر ([config.toml](../../supabase/config.toml)) | `‹ثبت نشده›` |

نام منوهای داشبورد ممکن است عوض شده باشد؛ نام تنظیم همان است که در جدول آمده.

### Redirect URLs

هر نشانی باید **دقیقاً** و جدا در فهرست باشد (`https`، بدون `/` پایانی اضافه). فهرست ثبت‌شده در اسناد:

| نشانی | مبنا |
|---|---|
| `https://recalino.vercel.app/auth/callback` | نشانی ثابت پیشنهادی ([GOOGLE_OAUTH_SETUP_FA.md](../ops/GOOGLE_OAUTH_SETUP_FA.md)) |
| `https://recalino-ali-paybarjay-s-projects.vercel.app/auth/callback` | نشانی ثابت Auth در 2026-10-04 |
| `https://recalino-bzf44bkg0-ali-paybarjay-s-projects.vercel.app/auth/callback` | نسخهٔ آزموده‌شده در 2026-10-04 |
| `http://localhost:3000/auth/callback` | توسعهٔ محلی |

فهرست واقعی ابر را در ستون «فعلی» بالا بنویسید. هر deployment با میزبان تازه که با Google آزموده می‌شود، callback خودش را جدا لازم دارد؛ موارد قبلی را پاک نکنید.

## بازسازی پس از خرابی یا اشتباه

مالک محصول انجام می‌دهد، چون به داشبورد و Google Cloud دسترسی دارد. هیچ گامی از سشن ابری Claude Code انجام نمی‌شود.

1. **Site URL و Redirect URLs:** در داشبورد Authentication ← URL Configuration، Site URL را به نشانی ثابت اپ بگذارید و همهٔ نشانی‌های بخش بالا را یکی‌یکی اضافه کنید. Save.
2. **Provider Google:** Authentication ← Sign In / Providers ← Google را روشن کنید. Client ID و Client secret از OAuth Client مالک در Google Cloud می‌آیند و فقط در همین صفحهٔ داشبورد وارد می‌شوند ([GOOGLE_OAUTH.md](GOOGLE_OAUTH.md)). بررسی nonce را روشن نگه دارید. Callback Supabase در Google باید `https://twowhuzhvyuzjrpraikm.supabase.co/auth/v1/callback` باشد.
3. **نشست و ثبت‌نام:** مقدارهای ستون «فعلی» (یا، اگر سند ناقص است، مقدار پیش‌فرض Supabase به‌علاوهٔ تصمیم مالک) را برای `jwt_expiry`، Refresh token rotation، فاصلهٔ استفادهٔ دوباره و ثبت‌نام بگذارید.
4. **بررسی فقط‌خواندنی:** `node --env-file=<فایل env صریح> tools/auth/check-google.mjs`. باید `external.google: true` را نشان دهد؛ این بررسی ورود را شروع نمی‌کند.
5. **ورود واقعی:** با حساب مالک از نشانی ثابت اپ وارد شوید، به `/auth/callback` برگردید و خروج و ورود دوباره را بیازمایید ([GOOGLE_CLOUD_ACTIVATION.md](GOOGLE_CLOUD_ACTIVATION.md) نمونهٔ بررسی را دارد).
6. این سند را با مقدارهای تازه و تاریخ بررسی به‌روز کنید.

## نگه‌داری

- هر تغییر در Site URL، Redirect URLs، provider یا تنظیم نشست، در همان روز اینجا ثبت می‌شود.
- اگر `supabase/config.toml` عوض شد، فقط Supabase محلی را می‌سازد. اثرش بر ابر صفر است مگر مالک محصول push را صریح اجازه دهد.
- ستون «فعلی» بدون تاریخ بررسی معتبر نیست.

## ارجاع‌ها

[GOOGLE_OAUTH.md](GOOGLE_OAUTH.md) · [GOOGLE_CLOUD_ACTIVATION.md](GOOGLE_CLOUD_ACTIVATION.md) · [CLOUD_SETUP.md](CLOUD_SETUP.md) · [GOOGLE_OAUTH_SETUP_FA.md](../ops/GOOGLE_OAUTH_SETUP_FA.md) · [SECRETS.md](SECRETS.md)
