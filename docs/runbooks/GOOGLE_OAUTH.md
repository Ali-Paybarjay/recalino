# راهنمای ساخت OAuth Client در Google Cloud

> **برای:** مالک محصول · **زمان تقریبی:** ۱۵ دقیقه · **هزینه:** ندارد  
> **مبنا:** [برنامه M3](../plans/M3_ACC.md) · [مستند Supabase: Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google)

این راهنما یک OAuth Client برای محیط **محلی** می‌سازد تا ورود با Google روی کامپیوتر خودتان آزموده شود. نشانی سرور ابری بعداً، هنگام استقرار، با پرسش جداگانه اضافه می‌شود.

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

   در حالت Testing فقط همین افراد می‌توانند وارد شوند (تا ۱۰۰ نفر). اگر تصمیم شما برای پایلوت «ورود آزاد برای همه» باشد، این گام بعداً عوض می‌شود.
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

## بعداً، هنگام استقرار

این کارها جزو استقرار است و پیش از انجام از شما پرسیده می‌شود:

- افزودن نشانی callback پروژه ابری به گام ۶: `https://twowhuzhvyuzjrpraikm.supabase.co/auth/v1/callback`
- فعال‌کردن Google در داشبورد Supabase
- بستن ورود با ایمیل در داشبورد Supabase

تا برند تأیید نشده، صفحه رضایت Google به‌جای نام Recalino دامنه Supabase را نشان می‌دهد. برای پایلوت مشکلی نیست.
