# راهنمای راه‌اندازی ورود با Google برای مالک محصول

تاریخ: 2026-10-12 — مخاطب: مالک محصول (بدون نیاز به دانش برنامه‌نویسی). راهنمای فنی قدیمی‌تر: [GOOGLE_OAUTH.md](../runbooks/GOOGLE_OAUTH.md) و [GOOGLE_CLOUD_ACTIVATION.md](../runbooks/GOOGLE_CLOUD_ACTIVATION.md).

## ۰. اول وضعیت فعلی را ببینید

بررسی فقط‌خواندنی در 2026-10-12 (بدون تغییر هیچ تنظیمی) نشان داد:

- در Supabase پروژهٔ `recalino` (ref `twowhuzhvyuzjrpraikm`)، provider گوگل **روشن** است (`/auth/v1/settings` → `google: true`).
- شروع ورود از Supabase با HTTP 302 به `accounts.google.com` می‌رود، Client ID دارد و `redirect_uri` آن دقیقاً `https://twowhuzhvyuzjrpraikm.supabase.co/auth/v1/callback` است.
- تنها دامنهٔ production پروژهٔ Vercel: `https://recalino.vercel.app`.

پس احتمالاً Client قبلی (ساخته‌شده در 2026-10-04) هنوز کار می‌کند. **پیش از ساختن Client تازه، گام ۸ (آزمون) را انجام دهید.** اگر ورود کار کرد، فقط گام ۷ (بازبینی URLها) را چک کنید. اگر کار نکرد، یا Client قبلی پاک شده یا Secret آن را ندارید، از گام ۱ همه را انجام دهید.

## مقدارهایی که باید دقیقاً کپی شوند

| کجا | مقدار |
|---|---|
| Authorized JavaScript origins (Google) | `https://recalino.vercel.app` |
| Authorized redirect URIs (Google) | `https://twowhuzhvyuzjrpraikm.supabase.co/auth/v1/callback` |
| Redirect URLs (Supabase) | `https://recalino.vercel.app/auth/callback` |
| Site URL (Supabase) | `https://recalino.vercel.app` (پیشنهاد؛ گام ۷ را ببینید) |
| Scopes (Google) | `openid`، `.../auth/userinfo.email`، `.../auth/userinfo.profile` |

نکته: در Google، redirect URI نشانی **Supabase** است، نه نشانی اپ. نشانی اپ (`/auth/callback`) فقط در Supabase ثبت می‌شود. اپ خودش این نشانی را از دامنه‌ای که در مرورگر باز است می‌سازد (`apps/web/src/server/auth/flow.ts`)، پس روی `recalino.vercel.app` همیشه `https://recalino.vercel.app/auth/callback` فرستاده می‌شود.

## ⚠️ قاعدهٔ امنیتی

**Client Secret را فقط در داشبورد Supabase وارد کنید.** آن را در چت، ایمیل، Issue، فایل مخزن یا اسکرین‌شات نگذارید. Client ID محرمانه نیست، ولی لازم هم نیست جایی جز Supabase وارد شود.

## گام‌ها

### ۱. پروژهٔ Google Cloud

1. به <https://console.cloud.google.com> بروید و با حساب Google خودتان وارد شوید.
2. از انتخابگر پروژه در بالای صفحه، اگر پروژهٔ Recalino از قبل هست همان را انتخاب کنید؛ وگرنه **New Project** → نام `Recalino` → **Create**.
3. مطمئن شوید نام پروژهٔ انتخاب‌شده در بالای صفحه `Recalino` است.

### ۲. صفحهٔ رضایت (Google Auth Platform → Branding)

1. منو ☰ → **APIs & Services** → **OAuth consent screen** (در نسخهٔ جدید: **Google Auth Platform**). اگر دکمهٔ **Get started** دیدید، آن را بزنید.
2. **App name:** `Recalino` — **User support email:** ایمیل خودتان.
3. **Audience / User type:** **External**.
4. **Contact information:** ایمیل خودتان → قوانین Google را بپذیرید → **Create**.
5. لوگو، Privacy policy و Terms را **خالی بگذارید** (دلیل در گام ۳).

### ۳. حالت Testing و کاربران آزمون (Audience)

1. در بخش **Audience**، وضعیت انتشار (Publishing status) باید **Testing** بماند. **دکمهٔ Publish app را نزنید.**
2. در **Test users** → **Add users** → ایمیل Google خودتان را وارد کنید → **Save**.

چرا Testing: انتشار برای همه (In production) به نشانی عمومی Privacy policy نیاز دارد. متن‌های `docs/legal` پیش‌نویس‌اند (Terms ۰٫۱، Privacy ۰٫۲)، بازبینی حقوقی نشده‌اند و دروازهٔ G11 هنوز باز است. پس تا تصمیم شما و بسته‌شدن G11 در Testing بمانید.

یادآوری: برای scopeهای پایه (`openid`، email، profile) Google در حالت Testing هم ورود افراد خارج از فهرست را مسدود نمی‌کند؛ این فهرست کنترل ورود ریکالینو نیست. سهمیهٔ پایلوت را ابزار اپراتور (`pilot.grant`) کنترل می‌کند.

### ۴. Scopeها (Data Access)

1. **Data Access** → **Add or remove scopes**.
2. فقط این سه را تیک بزنید: `openid`، `.../auth/userinfo.email`، `.../auth/userinfo.profile` → **Update** → **Save**.
3. scope دیگری (Gmail، Drive و…) اضافه نکنید.

### ۵. ساخت OAuth Client (Clients)

1. **Clients** (یا APIs & Services → **Credentials**) → **Create client** / **Create credentials → OAuth client ID**.
2. **Application type:** **Web application** — **Name:** `Recalino Supabase`.
3. **Authorized JavaScript origins** → **Add URI** → `https://recalino.vercel.app`
4. **Authorized redirect URIs** → **Add URI** → `https://twowhuzhvyuzjrpraikm.supabase.co/auth/v1/callback`
   (بدون فاصله، بدون `/` اضافه در آخر، با `https`.)
5. **Create**. پنجره‌ای **Client ID** و **Client secret** را نشان می‌دهد. پنجره را باز نگه دارید و مستقیم به گام ۶ بروید. (Secret بعداً هم از همین صفحه قابل دیدن یا ساختن دوباره است؛ در جای دیگری ذخیره‌اش نکنید.)

### ۶. وارد کردن در Supabase (Providers)

1. <https://supabase.com/dashboard> → پروژهٔ **recalino** (ref `twowhuzhvyuzjrpraikm`). اگر پروژهٔ دیگری دیدید، متوقف شوید.
2. **Authentication** → **Sign In / Providers** (در بعضی نسخه‌ها **Providers**) → **Google**.
3. **Enable Sign in with Google** را روشن کنید.
4. **Client IDs:** Client ID گام ۵ را بچسبانید.
5. **Client Secret (for OAuth):** Client secret گام ۵ را بچسبانید.
6. گزینه‌های دیگر (مثل Skip nonce checks یا Allow users without an email) را **دست نزنید**.
7. نشانی **Callback URL** نمایش‌داده‌شده در همین صفحه را با جدول بالا مقایسه کنید؛ باید `https://twowhuzhvyuzjrpraikm.supabase.co/auth/v1/callback` باشد.
8. **Save**.

### ۷. URLها در Supabase (URL Configuration)

1. **Authentication** → **URL Configuration**.
2. **Site URL:** اکنون طبق سند 2026-10-04 احتمالاً `https://recalino-ali-paybarjay-s-projects.vercel.app` است. پیشنهاد: `https://recalino.vercel.app`. اپ همیشه نشانی بازگشت را صریح می‌فرستد، پس Site URL فقط پشتیبان است؛ اگر نمی‌خواهید تغییرش دهید، همان را نگه دارید.
3. **Redirect URLs:** مطمئن شوید این مورد **دقیقاً** در فهرست هست؛ اگر نیست → **Add URL**:
   `https://recalino.vercel.app/auth/callback`
4. موارد قبلی فهرست را **پاک نکنید** (مثل callbackهای نسخه‌های preview یا `http://localhost:3000/auth/callback`).
5. **Save**.

نکته: اگر روی نشانی یک نسخهٔ preview (مثل `https://recalino-xxxx-ali-paybarjay-s-projects.vercel.app`) آزمون می‌کنید، `/auth/callback` همان نشانی هم باید جداگانه و دقیقاً در Redirect URLs باشد.

### ۸. آزمون ورود

1. یک پنجرهٔ Incognito باز کنید و به <https://recalino.vercel.app> بروید.
2. دو اعلام صفحهٔ ورود (۱۸+ و پذیرش شرایط) را تیک بزنید → **Continue with Google**.
3. حساب Google خودتان را انتخاب کنید و اجازه دهید.
4. نتیجهٔ درست: حساب تازه → `/setup`؛ حساب موجود → صفحهٔ قبلی، معمولاً `/today`.

### ۹. اگر ورود کار نکرد

| نشانه | علت محتمل | راه‌حل |
|---|---|---|
| صفحهٔ Google: `Error 400: redirect_uri_mismatch` | redirect URI در Google با نشانی Supabase یکی نیست | گام ۵.۴ را دقیقاً با جدول بالا مقایسه کنید (`https`، بدون `/` آخر). تغییر Google تا چند دقیقه طول می‌کشد. |
| `Error 401: invalid_client` یا `deleted_client` | Client ID اشتباه یا Client پاک شده | Client ID را از Google دوباره کپی و در گام ۶ ذخیره کنید. |
| `Access blocked` / `access_denied` / «این اپ تأیید نشده» | حالت Testing و نبودن حساب در Test users، یا scope اضافه | گام ۳ و ۴. در هشدار «Google hasn't verified this app» برای حساب خودتان **Continue** امن است. |
| JSON با `Unsupported provider` یا `validation_failed` | Google در Supabase خاموش است | گام ۶.۳ و Save. |
| بعد از Google به صفحهٔ اول با `?error=signin` برمی‌گردید | Secret اشتباه، کد منقضی، یا اعلام‌های صفحهٔ ورود ثبت نشده‌اند | Secret را در گام ۶.۵ دوباره بچسبانید؛ از Incognito و از اول (گام ۸) شروع کنید. |
| به صفحهٔ اول یا دامنهٔ دیگری با `?code=...` در نشانی برمی‌گردید و وارد نشده‌اید | `https://recalino.vercel.app/auth/callback` در Redirect URLs نیست؛ Supabase به Site URL برگشته است | گام ۷.۳. |
| صفحهٔ ورود Vercel می‌آید | نشانی preview محافظت‌شده است | از `https://recalino.vercel.app` استفاده کنید یا اول وارد Vercel شوید. |

اگر هیچ‌کدام نبود: زمان (UTC) و متن دقیق خطا را بدون Secret برای تیم بفرستید.
