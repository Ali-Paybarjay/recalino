# تغییرهای آمادهٔ متن‌های حقوقی

نسخهٔ بررسی 2026-10-05. این متن‌ها پیشنهاد قابل بررسی برای انتشار پس از تکمیل G11 هستند؛ هنوز جایگزین نسخهٔ پذیرش در اپ نشده‌اند. محل تغییر در هر مورد ذکر شده است. تصویب گذشتهٔ پیش‌نویس‌ها حفظ می‌شود؛ واقعیت‌های تازه و سیاست‌های تازه با تایید متن قدیمی پر نمی‌شوند.

## صفحهٔ ورود

جایگزین `I accept the Terms and Privacy Notice`:

> I accept the Terms and acknowledge the Privacy Notice.

این عبارت پذیرش قرارداد و دریافت اطلاعیه را از رضایت به کاربرد اختیاری داده جدا می‌کند.

## اعلان ضبط و منابع

نکتهٔ Ask first:

> Before recording, explain that selected audio will be sent to Recalino and its AI services to make your private transcript, notes and cards. Show the Privacy Notice to your teacher and everyone who may be recorded. Follow your college's rules. If anyone objects, leave out their voice and personal information or stop recording.

اعلان منابع:

> Only add material you own, have permission to use in Recalino and its AI services, or can lawfully use under a copyright exception. Private study does not give unlimited permission to copy, translate or share a work. Use only the amount needed for your study. Do not upload whole books or bypass copy protection.

گزینهٔ کوتاه پیشنهادی منابع:

> I have the right to use these materials in Recalino for my private study.

شناسهٔ داخلی `recording-consent` حفظ می‌شود، ولی پذیرش آن فقط ثبت درک وظیفهٔ زبان‌آموز است و مدرک رضایت همهٔ اشخاص کلاس محسوب نمی‌شود.

## مرز دادهٔ حساس

برای Terms، Privacy و اعلان منابع:

> Do not send private information about a real person's health, religion, political views, sex life or criminal allegations. Do not record personal disclosures. Stop recording and remove these parts before sending class material. If this information is sent by mistake, contact us so we can remove it.

موضوع عمومی یا مثال تخیلی با اطلاعات خصوصی فرد قابل‌شناسایی تفاوت دارد. این جمله فیلتر خودکار یا مبنای Article 9 ایجاد نمی‌کند. اگر کلاس به پردازش چنین افشاهایی نیاز داشته باشد، دامنهٔ پایلوت و قراردادها جدا بررسی می‌شوند.

## حقوق اشخاص و پاسخ به درخواست

برای بخش حقوق Privacy:

> You can object to uses based on legitimate interests. Teachers and classmates can contact us without a Recalino account. We may need proportionate information to find your data and check your request. We respond without undue delay, normally within one month. If the law allows more time or a pause for clarification, we will explain why.

> You can complain to the Information Commissioner's Office (ICO). You do not have to contact us first.

export جزوه/کارت به‌عنوان پاسخ کامل حقوق دسترسی یا انتقال‌پذیری معرفی نمی‌شود. اپراتور باید بتواند دادهٔ شخص را در دامنهٔ قانونی مناسب پیدا و ارائه کند و حقوق افراد دیگر را حفظ کند.

## مسئولیت در Terms

جایگزین سلب مسئولیت کلی در بخش ۱۴:

> We use reasonable care and skill to run Recalino. AI material can be wrong, so check it before using it. We are responsible for foreseeable loss caused by our failure to use reasonable care and skill, where the law makes us responsible. We do not exclude liability for death or personal injury caused by our negligence, fraud, or anything else the law does not allow us to exclude. Your legal rights are not affected.

ریسک دستگاه در بخش نگهداری صوت توضیح داده می‌شود:

> Recordings are stored in this browser on this device. Clearing browser data, a device failure or limited storage can remove them. Keep a separate copy if you need the recording. The app's database backup does not back up recordings on your device.

## تغییر خدمت و پایان پایلوت

پیشنهاد پس از انتخاب مهلت ۳۰روزه:

> We may change the service for product, security or legal reasons. We will explain important changes in advance where practical. For a planned end of the pilot, we will give at least 30 days' notice so you can download or delete your data. An urgent safety or legal issue may require a shorter notice or temporary suspension. We will explain what has happened where the law allows us to do so.

## ثبت کنترل‌های AI

با حفظ محدودیت‌ها و استثناهای موجود:

> The operator has turned off OpenRouter's private input/output logging and its optional use of inputs and outputs. Recalino also requests zero data retention, denies data collection by routed AI providers, and disables OpenRouter response caching. These settings do not remove necessary request processing, account metadata, security or legal exceptions.

عبارت‌های کشور/قرارداد/retention فقط پس از تکمیل [دفتر پردازشگران](PROCESSOR_REGISTER.md) و مطابق رفتار واقعی اعمال می‌شوند. نام `Ali Paybarjay` در تنظیم سرور برای deployment بعدی ثبت شده؛ متن‌های نهایی همان `legalValues` موجود را استفاده می‌کنند.

## اعمال پس از تکمیل

1. انتقال تغییرهای مصوب به `terms-of-use.md`، `privacy-notice.md`، `consents.md` و copy واقعی UI با همان طراحی جاری.
2. افزایش هماهنگ نسخه‌های Terms/Privacy/recording/sources به نسخهٔ نهایی پایلوت؛ تغییر معنایی بدون reacceptance منتشر نمی‌شود.
3. اجرای `legal:build`، آزمون sync نسخه‌ها، آزمون احراز هویت/پذیرش و render متن در موبایل/دسکتاپ.
4. انتشار از commit بازبینی‌شده و بازخوانی نام/ایمیل، متن نهایی و access/caching در production.
