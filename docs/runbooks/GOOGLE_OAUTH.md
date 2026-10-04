# راهنمای ساخت OAuth Client در Google Cloud

> **برای:** مالک محصول · **زمان تقریبی:** ۱۵ دقیقه · **هزینه:** ندارد  
> **مبنا:** [برنامه M3](../plans/M3_ACC.md) · [مستند Supabase: Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google)

این راهنما ساخت OAuth Client محلی و تنظیم همان Client برای Supabase ابری را پوشش می‌دهد. درخواست مالک محصول در 2026-10-04، اصلاح اتصال پروژهٔ موجود را مجاز کرده است؛ دسترسی Google Cloud و ساخت Client به حساب مالک نیاز دارد.

**Client secret را هرگز در چت یا فایل‌های مخزن ننویسید.** فقط در فایل `.env` گام ۷ قرار می‌گیرد و git آن را نادیده می‌گیرد.

## گام‌ها

1. **ورود و ساخت پروژه:**
   - به [console.cloud.google.com](https://console.cloud.google.com) بروید و با حساب Gmail پایلوت وارد شوید (همان نشانی `PILOT_OPERATOR_EMAIL`)، تا مالکیت به حساب پایلوت باشد نه حساب شخصی.
   - از منوی پروژه‌ها، **New project** را بزنید، نام `Recalino` را بنویسید و بسازید.
   - مطمئن شوید پروژه `Recalino` در نوار بالا انتخاب شده است.
2. **راه‌اندازی صفحه رضایت:**
   - به [Google Auth Platform](https://console.cloud.google.com/auth/overview) بروید و **Get started** را بزنید.
   - **App name:** `Recalino`
   - **User support email:** نشانی Gmail پایلوت
   - **Audience:** گزینه **External**
   - **Contact information:** همان نشانی
   - شرایط را بپذیرید و **Create** را بزنید.
3. **برند:** لوگو بارگذاری نکنید. بارگذاری لوگو بازبینی Google را لازم می‌کند که چند روز طول می‌کشد.
4. **مخاطبان (Audience):** وضعیت انتشار را روی **Testing** بگذارید. سپس در **Test users** با **Add users**:
   - اول نشانی Gmail خودتان را اضافه کنید، برای آزمون محلی.
   - بعداً نشانی Google هر زبان‌آموز پایلوت را اضافه کنید.

   برای scopeهای پایهٔ `openid/email/profile`، Google استثنا قائل است: کاربر بدون عضویت در Test users هم می‌تواند وارد شود. بنابراین این فهرست allowlist ورود ریکالینو نیست. شرکت‌کنندگان دارای سهمیه با `pilot.grant` اپراتور و سقف هشت نفر کنترل می‌شوند. [مستند Google](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)، [توضیح استثنا](https://support.google.com/cloud/answer/15549945?hl=en)
5. **دسترسی به داده (Data Access):** با **Add or remove scopes** فقط این سه را انتخاب کنید و ذخیره کنید:
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`

   چیز دیگری اضافه نکنید. همین سه برای ورود کافی‌اند و به بازبینی Google نیاز ندارند.
6. **ساخت Client:**
   - در [Clients](https://console.cloud.google.com/auth/clients)، **Create client** را بزنید.
   - **Application type:** گزینه **Web application**
   - **Name:** `Recalino local`
   - در **Authorized JavaScript origins** این را اضافه کنید: `http://localhost:3000`
   - در **Authorized redirect URIs** دقیقاً این را اضافه کنید: `http://127.0.0.1:54321/auth/v1/callback`
   - **Create** را بزنید. پنجره‌ای Client ID و Client secret را نشان می‌دهد.
7. **قرار دادن مقادیر روی کامپیوتر:**
   - در پوشه اصلی مخزن (`D:\Claude Projects\Recalino`) یک فایل به نام `.env` بسازید، نه `.env.txt`.
   - این دو خط را با مقادیر خودتان در آن بنویسید:

     ```text
     SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=<Client ID>
     SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET=<Client secret>
     ```

   - git این فایل را نادیده می‌گیرد، پس هرگز commit نمی‌شود.
8. **خبر دادن:** فقط بنویسید «OAuth آماده است». مقادیر را نفرستید. من Supabase محلی را با Google راه می‌اندازم و یک ورود کامل با حساب شما آزموده می‌شود (T9 برنامه M3).

## اتصال به Supabase ابری

بررسی واقعی در 2026-10-04 نشان داد `external.google` در `/auth/v1/settings` پروژهٔ `twowhuzhvyuzjrpraikm` مقدار `false` دارد و مسیر authorize با خطای `400 / validation_failed` و پیام `Unsupported provider: provider is not enabled` متوقف می‌شود. موفقیت build، صفحهٔ اول یا هدایت `303` به authorize، اثبات ورود موفق نیست؛ گزارش `artifacts/verification/cloud-google-readiness.json` این محدودیت را ثبت می‌کند.

1. در OAuth Client گوگل، **Authorized JavaScript origin** همین نسخه را اضافه کنید: `https://recalino-hme6gdlf3-ali-paybarjay-s-projects.vercel.app`. این **Authorized redirect URI** نیز به فهرست موجود اضافه شود: `https://twowhuzhvyuzjrpraikm.supabase.co/auth/v1/callback`. این callback با مسیر `/auth/callback` خود اپ تفاوت دارد؛ گوگل ابتدا به Supabase برمی‌گردد.
2. Client ID و Client secret همان Client را در فایل ignored `.env` ریشه، با نام‌های گام ۷ ثبت کنید و فقط خبر دهید آماده است. انتقال مقدارها از چت انجام نمی‌شود.
3. در پروژهٔ موجود Supabase، بخش **Authentication → Sign In / Providers → Google**، همان Client ID/secret ثبت و Google فعال شود. تا آماده‌بودن این دو مقدار، تغییر تنظیم provider انجام نمی‌شود.
4. در **Authentication → URL Configuration → Redirect URLs**، callback همین نسخهٔ اپ به فهرست موجود اضافه شود: `https://recalino-hme6gdlf3-ali-paybarjay-s-projects.vercel.app/auth/callback`. هر نسخه با میزبان تازه، به نشانی مجاز خودش نیاز دارد؛ wildcard عمومی استفاده نمی‌شود.
5. بررسی readiness باید `external.google: true` را نشان دهد و مرورگر به Google هدایت شود. سپس ورود واقعی با حساب مالک، بازگشت به `/auth/callback`، راه‌اندازی، Today، Classes، Review و Settings بررسی شود. تا اجرای این مرحله، ورود کامل ابری تأییدشده نیست.

فرمان بررسی خواندنی، با فایل محیط صریح و ignored شامل `SUPABASE_URL` و `SUPABASE_PUBLISHABLE_KEY` همان مقصد:

```powershell
node --env-file=.env.auth-check.local tools/auth/check-google.mjs
```

اگر محیط از قبل بارگذاری شده است، `pnpm auth:check` همان بررسی را اجرا می‌کند. فرمان، کلید، پاسخ خام یا متن خطای شبکه را چاپ نمی‌کند؛ فقط وضعیت HTTP، فعال‌بودن Google، میزبان پروژه و دستهٔ خطا را نشان می‌دهد. Google خاموش و پاسخ نامعتبر با exit 1 تمام می‌شوند. آزمون‌های آن مستقل از ابر هستند: `node --test tools/auth/check-google.test.mjs`.

scopeهای فعلی Supabase فقط اطلاعات پایهٔ هویت‌اند؛ محدودیت Test users در حالت Testing برای آن‌ها اعمال نمی‌شود. تصمیم قبلی نداشتن allowlist ورود اپ حفظ شده است. افزودن محدودیت ورود جداگانه، تصمیم تازه‌ای می‌خواهد؛ سقف هشت نفر ابزار اپراتور به حساب‌های دارای سهمیه مربوط است.

تا برند تأیید نشده، صفحه رضایت Google به‌جای نام Recalino دامنه Supabase را نشان می‌دهد. برای پایلوت مشکلی نیست.
