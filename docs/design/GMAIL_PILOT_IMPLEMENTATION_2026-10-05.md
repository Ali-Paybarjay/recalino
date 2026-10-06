# اتصال موقت Gmail پایلوت — 2026-10-05

وضعیت: پیاده‌سازی، بررسی، انتشار و فعال‌سازی Gmail تکمیل شد. در 2026-10-06 به وقت Europe/London، پس از اعلام «done» مالک، وجود متغیر رمز Production بدون خواندن مقدار آن تأیید و همان نسخهٔ بررسی‌شده دوباره منتشر شد. تصمیم D42 و درخواست مستقیم مالک محصول مبنای اتصال حساب `recalino.pilot@gmail.com` هستند.

انتشار فعال‌شده: `dpl_BoZshrimLjQZ8DTgmAZe4tbCH6K3`، [نسخهٔ Gmail با credential ذخیره‌شده](https://recalino-7tj3m20oy-ali-paybarjay-s-projects.vercel.app)، روی [دامنهٔ اصلی](https://recalino.vercel.app/admin). [بررسی پنج مسیر HTTP](../../artifacts/verification/gmail-activation-production-2026-10-06.json) پیکربندی Gmail برابر `configured=true`، فرستنده و Reply-To صحیح و guard/cache پنل را تأیید کرد. نشست موقت بررسی پس از پایان لغو شد.

Cron خودکار موجود، نامهٔ قبلاً تأییدشده را با یک تلاش به SMTP Gmail تحویل داد؛ state برابر `sent`، provider reference موجود و last_error برابر null است. [شاهد metadata صف](../../artifacts/verification/gmail-outbox-activation-2026-10-06.json) این نتیجه را ثبت می‌کند. هیچ نامهٔ تازه، retry یا فراخوانی دستی runner انجام نشد. این شاهد پذیرش SMTP و صحت credential در ارسال واقعی را ثابت می‌کند؛ رسیدن به Inbox یا خواندن پیام توسط گیرنده هنوز تأیید نشده است.

انتشار اصلی: [Recalino Admin](https://recalino.vercel.app/admin)، شناسهٔ `dpl_45HXR1ngMauoCiUwiMRpH7Ffki8o`، نسخهٔ بررسی‌شدهٔ [Gmail pilot](https://recalino-gvgr1zb9w-ali-paybarjay-s-projects.vercel.app). build production در Linux به Ready رسید و سپس با موفقیت promote شد.

## تغییر

outbox تأییدشده اکنون از Gmail SMTP یا Resend استفاده می‌کند. مسیر Gmail به دامنهٔ تازه یا کلید Resend نیاز ندارد؛ فرستنده باید همان حساب Gmail احراز هویت‌شده باشد. میزبان ثابت `smtp.gmail.com`، TLS معتبر روی 465، deadline پانزده‌ثانیه‌ای، یک گیرنده در هر نامه و نبود logging حاوی پیام/رمز رعایت شده‌اند. کتابخانهٔ `nodemailer@10.0.15` با نسخهٔ دقیق و typings خود بسته استفاده شده است.

قالب‌ها، preview، تأیید revision، receipt، قفل outbox و بررسی گیرندهٔ زنده حفظ شده‌اند. پذیرش قطعی SMTP برابر `sent` است؛ نتیجهٔ مبهم `unknown` می‌ماند و retry خودکار ندارد. Message-ID پایدار فقط مرجع تطبیق است و تضمین deduplication Google نیست. رمز اصلی Gmail استفاده نمی‌شود و App Password به مرورگر یا DTOهای مدیریت برنمی‌گردد.

تنظیمات production شامل `RECALINO_EMAIL_PROVIDER=gmail`، حساب فرستنده، From و Reply-To روی `recalino.pilot@gmail.com` ثبت شدند؛ طبق سیاست تیم Vercel همه در حالت Sensitive هستند. لینک عمومی اپ حفظ شد. مالک `RECALINO_GMAIL_APP_PASSWORD` را مستقیم در Vercel ثبت کرد؛ عامل مقدارش را نخواند، نساخت، حدس نزد یا با placeholder پر نکرد. پنل اکنون پیکربندی آماده را نشان می‌دهد. در نبود یا بی‌اعتباری شکل credential، نامه‌های تأییدشده همچنان queued می‌مانند.

## بررسی

- ۴۹ آزمون متمرکز موفق: ۳۹ آزمون تازهٔ Gmail و ۱۰ آزمون موجود SUPPORT، شامل compiler واقعی MIME بدون شبکه، فارسی/انگلیسی، هدر/فرستنده، timeout و طبقه‌بندی نتیجه.
- ۲۴ آزمون integration در سه فایل SUPPORT outbox، aggregation مدیریت و guard دسترسی مدیر موفق شدند؛ metadata Gmail و نبود رمز خام یا رمز نرمال‌شده در پاسخ پنل نیز بررسی شدند.
- lint کل پروژه با ۶۶۵ فایل، TypeScript core/web/tools و مرزهای ۷۴۶ ماژول و ۲۹۲۸ وابستگی موفق بودند.
- ساخت نهایی Windows و build انتشار Linux موفق؛ ۵۶ صفحهٔ static و ۱۰ وابستگی native در ۱۰۴ manifest بررسی شدند. اسکن bundle با نام متغیرهای تازهٔ ایمیل نیز هیچ secret در خروجی مرورگر پیدا نکرد.
- [گزارش بررسی production](../../artifacts/verification/gmail-pilot-production.json): پنج بررسی HTTP موفق؛ API ناشناس 401 و settings/template برای مالک 200 با private/no-store، صفحهٔ مالک 200. provider برابر Gmail، From و Reply-To صحیح، و `configured=false` تا ورود رمز مشاهده شدند. نشست موقت بررسی پس از پایان لغو شد.
- آزمون‌های قبلی مرورگر پنل در گزارش اصلی ثبت‌اند؛ برای این تغییر آزمون تازهٔ مرورگر ادعا نمی‌شود. ارسال واقعی نامهٔ قبلاً تأییدشده، پذیرش SMTP را اثبات کرد؛ تأیید Inbox همچنان شاهد مستقل گیرنده است.
- هیچ رمز واقعی یا پیام واقعی در آزمون‌ها مصرف نشده است؛ migration تازه لازم نیست.

## مرحلهٔ مالک حساب

مالک انجام مراحل حساب و ثبت رمز را با «done» اعلام کرد و وجود متغیر Production و ارسال موفق آن را تأیید کردند. کانکتور Gmail موجود متعلق به حساب دیگری است و برای ارسال Recalino استفاده نشد. ورود و تأیید امنیتی، ساخت App Password و ثبت مستقیم آن در Vercel در کنترل مالک باقی‌اند. رمز در گفتگو یا Git قرار نمی‌گیرد.

[راهنمای مرحله‌به‌مرحله](../runbooks/GMAIL_PILOT_SETUP.md) شرایط حساب و روش ثبت امن رمز را توضیح می‌دهد. پس از اعلام مالک، deployment تازه و تأیید ارسال واقعی نامهٔ موجود انجام شد. نامهٔ آزمایشی تازه‌ای ساخته نشد؛ هر ارسال تازه همچنان نیازمند preview و تأیید مدیر است.

بررسی metadata پیش از فعال‌سازی یک نامهٔ `queued`، صفر `sending` و صفر `sent` نشان داد؛ این نامه در این تغییر ساخته نشده بود. پس از تکمیل credential و deployment تازه، همان نامه با یک تلاش به `sent` رسید. migration یا تغییر دستی دادهٔ کاربر انجام نشد.
