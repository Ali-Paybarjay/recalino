# اتصال Gmail پایلوت به ارسال ایمیل پنل

> تصمیم [D42، 2026-10-05](../PRODUCT_DECISIONS_LOG.md) · حساب هدف: `recalino.pilot@gmail.com` · پنل: [Recalino Admin](https://recalino.vercel.app/admin)

برای ارسال موقت دعوت، خوشامدگویی و پاسخ به بازخورد از حساب Gmail فعلی، خرید دامنه یا صندوق ایمیل تازه لازم نیست. پنل همان preview، تأیید دستی مالک و outbox را نگه می‌دارد. در 2026-10-06 به وقت Europe/London، پس از ثبت امن رمز توسط مالک، اتصال فعال و پذیرش SMTP نامهٔ قبلاً تأییدشده مشاهده شد. [گزارش بررسی و انتشار](../design/GMAIL_PILOT_IMPLEMENTATION_2026-10-05.md) شواهد همان عملیات را ثبت می‌کند. مراحل زیر برای راه‌اندازی یا تعویض رمز حفظ شده‌اند.

## کارهایی که خود مالک حساب انجام می‌دهد

1. [حساب Google](https://myaccount.google.com/) را باز کنید. از تصویر حساب در بالای صفحه مطمئن شوید حساب فعال دقیقاً `recalino.pilot@gmail.com` است. اگر حساب دیگری باز است، حساب هدف را انتخاب کنید. ورود مجدد، رمز اصلی، passkey و کدهای تأیید را فقط خودتان در صفحهٔ Google وارد کنید.
2. [تأیید دومرحله‌ای](https://myaccount.google.com/signinoptions/two-step-verification) را باز کنید. اگر فعال است، به مرحلهٔ بعد بروید؛ اگر خاموش است، **Turn on 2-Step Verification** را بزنید و مراحل Google را با روش دلخواه خود کامل کنید. ایجاد App Password به فعال‌بودن این قابلیت نیاز دارد. [راهنمای رسمی Google](https://support.google.com/accounts/answer/185839?hl=en)
3. [App Passwords](https://myaccount.google.com/apppasswords) را باز کنید. در صورت درخواست Google، خودتان دوباره احراز هویت کنید. برای نام برنامه، `Recalino pilot email` را بنویسید و **Create** را بزنید. رمز نمایش‌داده‌شدهٔ ۱۶ نویسه‌ای مخصوص همین اتصال است؛ رمز اصلی Gmail را استفاده نکنید. رمز را در چت، تصویر، Git یا فایل پروژه قرار ندهید. [راهنمای رسمی App Password](https://support.google.com/accounts/answer/185833?hl=en)
4. [تنظیمات متغیرهای پروژهٔ Recalino در Vercel](https://vercel.com/ali-paybarjay-s-projects/recalino/settings/environment-variables) را باز کنید. تیم **ali-paybarjay-s-projects** و پروژهٔ **recalino** را بررسی کنید. **Add Environment Variable** را انتخاب کنید. نام متغیر `RECALINO_GMAIL_APP_PASSWORD`، محیط **Production** و گزینهٔ **Sensitive** را انتخاب کنید؛ رمز را مستقیم در فیلد Value وارد و Save کنید. فاصله‌های نمایشی رمز حذف می‌شوند. مقدار ذخیره‌شده نباید در خروجی ابزار یا گفتگو خوانده شود. [راهنمای متغیرهای حساس Vercel](https://vercel.com/docs/environment-variables/sensitive-environment-variables)
5. فقط اعلام کنید «رمز در Vercel ذخیره شد». خود رمز یا کدهای Google را نفرستید. عامل پروژه deployment تازه و بررسی بدون ارسال پیام را انجام می‌دهد؛ تغییر متغیر روی deployment قبلی اعمال نمی‌شود. [راهنمای اعمال متغیر Vercel](https://vercel.com/docs/environment-variables/managing-environment-variables)

فعال‌سازی دومرحله‌ای و ساخت credential در Google نیازمند کنترل خود مالک حساب است؛ عامل نباید وجود دسترسی به این حساب یا انجام این مراحل را بدون مشاهدهٔ واقعی ادعا کند. کانکتور Gmailِ متعلق به حساب دیگر برای این اتصال استفاده نمی‌شود.

اگر صفحهٔ App Password قابل استفاده نیست، ممکن است حساب از Advanced Protection، تنظیم دومرحله‌ای فقط با security key یا محدودیت سازمانی استفاده کند. حفاظت حساب را برای بازکردن این گزینه خاموش نکنید. اتصال Gmail با OAuth مسیر جداگانهٔ مناسب است و هنوز از ورود عادی Google به Recalino به‌دست نمی‌آید. Google در صورت امکان OAuth/Sign in with Google را به App Password ترجیح می‌دهد؛ مسیر حاضر راه‌اندازی موقت پایلوت است. [شرایط رسمی دسترسی](https://support.google.com/accounts/answer/185833?hl=en)

## کارهایی که عامل پروژه انجام می‌دهد

- پیاده‌سازی adapter سمت سرور برای SMTP Gmail و حفظ adapter Resend، قالب‌ها، preview و تأیید مالک.
- تنظیم متغیرهای غیرمحرمانهٔ پروژهٔ موجود Vercel طبق جدول زیر؛ هیچ credential تازه‌ای در کد ساخته یا حدس زده نمی‌شود.
- بررسی build، typecheck، مرز credential سمت سرور، آزمون‌های خطا و outbox بدون ارسال ایمیل به فرد واقعی.
- پس از ذخیرهٔ امن رمز توسط مالک، deployment تازه و بررسی پیکربندی. وضعیت «configured» جای آزمون احراز هویت و دریافت واقعی را نمی‌گیرد.

| متغیر | مقدار پایلوت |
|---|---|
| `RECALINO_EMAIL_PROVIDER` | `gmail` |
| `RECALINO_GMAIL_USER` | `recalino.pilot@gmail.com` |
| `RECALINO_EMAIL_FROM` | `Recalino <recalino.pilot@gmail.com>` |
| `RECALINO_EMAIL_REPLY_TO` | `recalino.pilot@gmail.com` |
| `RECALINO_PUBLIC_APP_URL` | `https://recalino.vercel.app` |
| `RECALINO_GMAIL_APP_PASSWORD` | فقط مقدار واقعی واردشده توسط مالک در Vercel؛ Sensitive، Production |

فرستنده باید همان آدرس Gmail احراز هویت‌شده باشد؛ نام نمایشی `Recalino` مجاز است. رمز فقط در محیط سرور مصرف می‌شود و متغیر `NEXT_PUBLIC_` نیست. مسیر Gmail به کلید Resend نیاز ندارد. میزبان SMTP ثابت `smtp.gmail.com` و اتصال با TLS است؛ تنظیم host دلخواه از فرم کاربر وجود ندارد. [مرجع رسمی SMTP Gmail](https://developers.google.com/workspace/gmail/imap/imap-smtp)

## آزمون واقعی پس از آماده‌شدن

قبل از نخستین ارسال، گیرنده، موضوع و متن دقیق آزمون باید توسط مالک تأیید شوند؛ اجازهٔ اتصال و استقرار به‌تنهایی مجوز ارسال پیام تازه به اشخاص نیست. مالک می‌تواند از پنل یک گیرنده را انتخاب و preview را تأیید کند. صرف ذخیرهٔ رمز، قالب یا سهمیه ایمیل جدیدی نمی‌سازد؛ پیام‌های قبلاً تأییدشده پس از آماده‌شدن فرستنده ممکن است از صف ارسال شوند.

برای مثال قابل بازبینی، موضوع «آزمون اتصال ایمیل Recalino» و متن «این یک ایمیل آزمایشی برای بررسی اتصال پنل Recalino است. اقدامی لازم نیست.» پیشنهاد می‌شود؛ این پیشنهاد هنوز مجوز ارسال نیست. گیرنده را مالک تعیین می‌کند.

پس از ارسال مجاز، receipt outbox و مشاهدهٔ واقعی Inbox/Spam توسط گیرنده را جدا ثبت کنید. `sent` فقط پذیرش SMTP است و تحویل Inbox یا خواندن را ثابت نمی‌کند. این نسخه پیام دریافتی در Gmail را خودکار وارد بخش feedback نمی‌کند؛ پیام‌های `/help` درون اپ جدا هستند و پاسخ مستقیم به ایمیل به همین صندوق Gmail می‌رسد.

## خطا، محدودیت و تعویض رمز

- Google محدودیت ارسال و کنترل سوءاستفاده دارد؛ ظرفیت ثابت ۵۰۰ ایمیل SMTP در روز تضمین نمی‌شود. برای تعداد کم پایلوت، ارسال انتخاب‌شده و نظارت بر خطا مناسب است. [محدودیت‌های رسمی Gmail](https://support.google.com/mail/answer/22839?hl=en)
- پذیرش SMTP تضمین idempotency نزد Google ندارد. receipt و قفل outbox داخلی حفظ می‌شوند؛ اگر outcome `unknown` شد، ارسال مجدد خودکار انجام نشود. طبق [راهنمای پنل](ADMIN_PANEL.md) شواهد پیام را بررسی و فقط با نتیجهٔ قطعی reconcile کنید.
- تغییر رمز اصلی Google، App Passwordها را لغو می‌کند. در این حالت رمز اختصاصی تازه بسازید، مقدار Sensitive را مستقیم در Vercel به‌روزرسانی و deployment تازه ایجاد کنید. [راهنمای لغو و ساخت دوباره](https://support.google.com/accounts/answer/185833?hl=en)
- برای قطع این اتصال، App Password با نام `Recalino pilot email` را در Google حذف کنید. Google پیش از لغو یا تعویض ممکن است احراز هویت مجدد بخواهد؛ این مرحله را مالک انجام می‌دهد.
