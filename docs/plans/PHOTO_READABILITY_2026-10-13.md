# خوانایی عکس تخته روی دستگاه — D72 لایه‌های ۱ و ۲ (2026-10-13)

> **شاخه:** `feat/photo-readability` · **مبنا:** `main` @ `ea95dbc`.
> **تصمیم:** D72 (تصمیم مالک محصول 2026-10-13؛ فقط لایه‌های ۱ و ۲). لایهٔ ۳، یعنی خواندن زودهنگام عکس با vision در پس‌زمینه، **ساخته نشده است**.
> **قید:** این بخش هیچ درخواست شبکه یا فراخوانی AI ندارد. داده‌ها مصنوعی‌اند (G11). بستهٔ npm تازه‌ای اضافه نشده است (D28).

## ۱. خلاصه

- زبان‌آموز چند ثانیه پس از گرفتن عکس، زیر تصویر کوچک همان عکس یک خط آرام می‌بیند: «Looks sharp»، یا دلیل مشکل همراه دکمهٔ Retake. پس هنوز تخته جلوی اوست و می‌تواند دوباره عکس بگیرد.
- تشخیص روی خود دستگاه و در یک Web Worker انجام می‌شود. ورودی نسخهٔ کوچک‌شدهٔ عکس است (لبهٔ بلند حداکثر ۶۴۰ px). تشخیص پنج حالت دارد: تاری، تاریکی، شستگی، بازتاب نور و تخته‌ای که نوشته‌ای در آن دیده نمی‌شود.
- عکس همیشه ذخیره می‌ماند (PRD-REC-07). Retake عکس تازه‌ای **اضافه** می‌کند و عکس قبلی را پاک نمی‌کند (PRD-CORE-05).
- عکسی که فقط روی دستگاه است (هنوز آپلود نشده و در گروه آپلود هم نیست) را خود زبان‌آموز می‌تواند پس از یک پیام تأیید حذف کند. این کنترل را مالک محصول در 2026-10-13 تأیید کرد (بخش ۲.۱).
- با زدن روی تصویر کوچک، عکس در اندازهٔ کامل در همان Sheet موجود باز می‌شود. Sheet قابل اسکرول است و pinch-zoom بومی مرورگر دارد. یک جمله هم می‌پرسد آیا ریزترین نوشته خواناست (لایهٔ ۲).
- برای هر عکس تازه، رخداد `photo_quality` به diagnostics ضبط می‌رود: شناسهٔ محلی عکس، چهار امتیاز صحیح ۰ تا ۱۰۰۰ و حکم. هیچ پیکسل یا متنی فرستاده نمی‌شود (PRD-PRIV-06). با این داده‌ها مدیر می‌تواند پس از انتشار، حکم دستگاه را با نتیجهٔ `unreadable_image` سرور مقایسه کند.

## ۲. چه ساخته شد

| فایل | نقش |
|---|---|
| [`photo-quality.ts`](../../apps/web/src/ui/recording/photo-quality.ts) | تابع خالص `assessPhotoQuality({width, height, data})`. خروجی: `sharpness`، `exposure` (`dark`، `bright`، `contrast`، `median`)، `glare`، `edgeDensity`، `verdict` و `scores` (چهار عدد صحیح ۰ تا ۱۰۰۰). آستانه‌ها ثابت‌های نام‌دارند و مقدار سنجیده‌شده کنار هرکدام نوشته شده است |
| [`photo-quality-image.ts`](../../apps/web/src/ui/recording/photo-quality-image.ts) | `createImageBitmap` فایل را decode می‌کند و نسخهٔ ≤ ۶۴۰ px می‌سازد (همان روش `upload-file.ts`). سپس پیکسل‌ها از canvas خوانده و ارزیابی می‌شوند |
| [`photo-quality-worker.ts`](../../apps/web/src/ui/recording/photo-quality-worker.ts) | Web Worker با `OffscreenCanvas`. نه شبکه دارد و نه ذخیره؛ فقط عدد برمی‌گرداند (الگوی `file-hash-worker.ts`) |
| [`photo-quality-client.ts`](../../apps/web/src/ui/recording/photo-quality-client.ts) | `assessPhotoFile` هرگز throw نمی‌کند و در هر خطا `undefined` می‌دهد، که یعنی چیزی نمایش داده نمی‌شود. اگر Worker یا OffscreenCanvas نباشد یا Worker راه نیفتد، ارزیابی در زمان بیکاری (`requestIdleCallback`) روی main thread انجام می‌شود. اگر مرورگر گزینهٔ resize در `createImageBitmap` را نادیده بگیرد، رسم با اندازهٔ صریح باز هم کل عکس را کوچک می‌کند، نه فقط گوشه‌ای از آن را. سقف انتظار Worker ۱۵ ثانیه است. هر عکس در هر بار باز شدن صفحه فقط یک بار ارزیابی می‌شود |
| [`RecordingView.tsx`](../../apps/web/src/ui/recording/RecordingView.tsx) | ردیف عکس‌ها **حین ضبط** (فقط عکس‌های قطعهٔ جاری، بدون دکمه‌های آپلود) و پس از Stop. خط وضعیت زیر تصویر کوچک، Retake، Sheet بزرگ‌نمایی، مرتب‌سازی عکس‌ها به ترتیب گرفتن، و ارسال diagnostics. صفحه حین ضبط پس از ذخیرهٔ هر chunk صوت (هر ۲ ثانیه) عکس‌ها را دوباره می‌خواند. blob URLها فقط با تغییر مجموعهٔ عکس‌ها عوض می‌شوند، پس تصویر کوچک و عکسِ در حال بزرگ‌نمایی هر ۲ ثانیه دوباره بارگذاری نمی‌شوند |
| [`Recording.module.css`](../../apps/web/src/ui/recording/Recording.module.css) | دو کلاس: `.thumb` (بازنشانی دکمه دور تصویر کوچک) و `.zoom` (`overflow: auto`، `touch-action: pinch-zoom pan-x pan-y`). رنگ، اندازه، فاصله یا token تازه‌ای ندارد |
| [`capture-diagnostics.ts`](../../apps/web/src/ui/recording/capture-diagnostics.ts)، [`controller.ts`](../../apps/web/src/ui/recording/controller.ts) | رخداد `photo_quality` در schema سخت (`strictObject`، `uuid`، enum حکم، عدد صحیح ۰ تا ۱۰۰۰) و `controller.reportPhotoQuality` |
| [`recording-copy.ts`](../../apps/web/src/ui/recording/recording-copy.ts) | هشت متن `recordingCopy.photoQuality.*`. مالک محصول آن‌ها را در 2026-10-13 عیناً تأیید کرد و از `pending-copy.ts` به اینجا منتقل شدند |
| [`photo-removal.ts`](../../apps/web/src/ui/recording/photo-removal.ts)، [`pending-copy.ts`](../../apps/web/src/ui/pending-copy.ts)، [`UI_COPY_PENDING.md`](../design/UI_COPY_PENDING.md) | حذف عکسی که فقط روی دستگاه است (بخش ۲.۱). چهار متن تازهٔ `photoRemove.*` در انتظار تأیید‌اند |

جای عناصر در ردیف هر عکس: تصویر کوچک (دکمهٔ بزرگ‌نمایی)، خط وضعیت (`Status` موجود: `success` برای ok و `neutral` برای هشدار؛ هیچ‌کدام `alert` نیست)، دکمهٔ Retake (`Button` موجود)، زمان تقریبی، و پس از Stop دکمه‌های آپلودِ موجود.

**Retake:**
- حین ضبط، Retake همان «Add board photo» است و لنگرش لحظهٔ حال در قطعهٔ جاری است. فقط در حالت recording یا paused فعال است.
- برای عکسِ قطعهٔ تمام‌شده (پس از Stop، یا قطعهٔ قبلی حین ضبط)، عکس تازه به همان قطعه و همان لنگر زمانی عکس اول بسته می‌شود. سپس `notifyAutomaticLearning` صدا زده می‌شود تا عکس مثل هر عکس ذخیره‌شدهٔ دیگری به منابع جلسه برود.
- Retake مثل «Add board photo» به پذیرش material notice نیاز دارد.

### ۲.۱ حذف عکسی که فقط روی دستگاه است (تصمیم مالک محصول 2026-10-13، پاسخ پرسش ۱)

- **کجا:** دکمهٔ «Remove this photo» در ردیف عکس (حین ضبط و پس از Stop) و در footer Sheet بزرگ‌نمایی. پیش از حذف، `ConfirmDialog` موجود باز می‌شود: عنوان «Remove this photo from this device?»، پیامد «It has not been uploaded.»، گزینهٔ امن «Keep» با فوکوس اول، و دکمهٔ `danger` «Remove this photo». پیام فقط پس از لمس خود زبان‌آموز باز می‌شود.
- **چه عکسی:** فقط عکسی که `sourceAssetId` ندارد و در گروه آپلودِ در جریانِ جلسه‌اش (journal `recalino:learning-batch:*`) نامی از آن نیست، چون منبعش ممکن است روی سرور ساخته شده باشد. عکس آپلودشده یا در جریان آپلود این دکمه را ندارد و همان حذف صفحهٔ منابع برایش می‌ماند. شرط در لحظهٔ تأیید دوباره بررسی می‌شود. اگر آپلود در این فاصله شروع شده باشد، چیزی حذف نمی‌شود.
- **چه چیزی حذف می‌شود:** فقط همان عکس در IndexedDB (`store.removePhoto`)، حکمِ cache‌شدهٔ آن، و رخداد `photo_quality` آن اگر هنوز در صف دستهٔ diagnostics مانده باشد (رخداد کنترلی `photo_removed` که خودش هرگز فرستاده نمی‌شود). خطی که پیش‌تر به لاگ رفته باشد پاک‌شدنی نیست. آن خط فقط عدد و شناسهٔ تصادفی دارد.

## ۳. الگوریتم و آستانه‌ها

ابتدا luminance هر پیکسل حساب می‌شود (`(77R+150G+29B)/256`) و histogram آن ساخته می‌شود. سپس:

1. **نوردهی:** `median`، `contrast = (p99 − p1)/255`، `dark` (سهم پیکسل‌های زیر ۴۰) و `bright` (سهم پیکسل‌های بریده‌شده، ≥ ۲۵۰). «تاریک» و «شسته» هر دو کنتراست کم را هم شرط دارند. تختهٔ سیاه ذاتاً تیره است، ولی گچ کنتراستش را نگه می‌دارد. پیش از این شرط، تختهٔ سیاه خوانا هشدار نادرست `too_dark` می‌گرفت که در آزمون پیدا و رفع شد.
2. **لبه‌ها:** پیکسلی لبه است که Sobel آن (`|gx|+|gy|`) از `max(40, 0.15 × 4 × contrast)` بیشتر باشد. آستانه نسبت به کنتراست خود عکس است، پس جوهر کم‌رنگ یا اتاق کم‌نور لبه را از دست نمی‌دهد. کف ۴۰ هم نویز حسگر روی تختهٔ خالی را لبه حساب نمی‌کند. `edgeDensity` سهم پیکسل‌های لبه است.
3. **وضوح:** واریانس Laplacian (چهارهمسایه) فقط روی پیکسل‌های لبه، تقسیم بر `contrast²`. با این تقسیم، معیار به روشنایی و کنتراست بستگی ندارد و به تعداد خط‌های نوشته هم بستگی ندارد، چون فقط لبه‌ها شمرده می‌شوند.
4. **بازتاب:** تصویر به خانه‌های ۸×۸ تقسیم می‌شود. خانه‌ای که ≥ ۹۰٪ آن بریده باشد، خانهٔ بازتاب است. `glare` سهم بزرگ‌ترین گروه ۴-همسایهٔ این خانه‌ها از کل تصویر است.

**ترتیب حکم:** `too_dark` ← `too_bright` ← `glare` ← `low_detail` ← `blurry` ← `ok`. اولین شرطی که برقرار باشد حکم را تعیین می‌کند.

| ثابت | مقدار | حالت خوانا (سنجیده) | حالت ناخوانا (سنجیده) |
|---|---|---|---|
| `MIN_SHARPNESS` | 0.04 | 0.55 تا 0.95؛ تاری شعاع ۱: 0.074 (خوانا) | تاری شعاع ۲: 0.020؛ شعاع ۳: 0.009 |
| `MIN_MEDIAN` و `MIN_CONTRAST_WHEN_DARK` | 0.24 و 0.35 | اتاق کم‌نور: میانه 0.47. تختهٔ سیاه با گچ: میانه 0.22 و کنتراست 0.71؛ همان در نور کم: 0.12 و 0.39 | کم‌نوردهی: میانه 0.17 و کنتراست 0.13 |
| `MAX_CLIPPED` و `MIN_CONTRAST_WHEN_CLIPPED` | 0.5 و 0.35 | تختهٔ خوانا: بریدگی 0 | شسته: بریدگی 0.96 و کنتراست 0.23 |
| `MAX_GLARE` (با `median < 0.94`) | 0.025 | 0 | لکهٔ نور: 0.074 |
| `MIN_EDGE_DENSITY` | 0.008 | دو خط نوشته: 0.023 | تختهٔ خالی: 0.004 |

## ۴. کالیبره‌کردن

- **مرحلهٔ ۱ (Node):** [`test-fixtures/synthetic-board.ts`](../../apps/web/src/ui/recording/test-fixtures/synthetic-board.ts) تختهٔ مصنوعی ۶۴۰×۴۸۰ می‌سازد: نور ناهمگون، نویز ±۴، و «دست‌خط» ماژیک با x-height ۱۱ px (خط ۲ px) و ۲۶ px. همین تخته با تاری جعبه‌ای شعاع ۱ تا ۳، تاریک، شسته، با لکهٔ نور و کم‌نور هم ساخته شد. نمونه‌های دیگر: تخته با جوهر کم‌رنگ، فقط دو خط نوشته، نسخهٔ ۳۲۰ px، بذر دیگر، تختهٔ خالی، و تختهٔ سیاه با گچ (عادی، کم‌نور، تار، کم‌نوردهی و با لکهٔ نور). اعداد جدول بالا از همین مرحله‌اند. هر آستانه، در مقیاس لگاریتمی، تقریباً وسط حالت خوانا و ناخوانای خودش گذاشته شد.
- **مرحلهٔ ۲ (Chromium):** در e2e، تختهٔ ۸۰۰×۶۰۰ با `fillText` روی canvas کشیده شد (متن ۱۶ px و تیتر ۴۰ px). سپس با `filter: blur(4px)`، پوشش سیاه ۸۲٪، `lighter` با ۱۶۰، گرادیان شعاعی سفید، و بدون نوشته تغییر داده شد. هر شش حالت حکم درست گرفتند. امتیازهای diagnostics آن‌ها در بخش ۵ آمده است.
- **محدودیت:** هیچ عکس واقعی کلاس استفاده نشد (G11). قاعدهٔ ۳ D72 کالیبره‌کردن با عکس‌های خود مالک محصول را هم می‌خواهد. این مرحله هنوز مانده و بدون آن عکس‌ها انجام‌شدنی نیست. آستانه‌ها نقطهٔ شروع‌اند و باید پس از انتشار با `photo_quality` و `unreadable_image` بازبینی شوند.

## ۵. اندازه‌گیری‌ها

| اندازه‌گیری | نتیجه |
|---|---|
| `assessPhotoQuality` روی ۶۴۰×۴۸۰ در Node 24.21 | ۵٫۳ تا ۵٫۹ ms (میانگین ۲۰ اجرا، سه بار). آزمون، سقف ۶۰ ms را بررسی می‌کند |
| main thread در Chromium با کندسازی ۴× CPU (پیش‌تنظیم «mid-tier mobile»)، نسخهٔ اول بدون Worker، dev server | 59 تا 256 ms برای شش عکس؛ میانه حدود ۱۰۰ ms. کوچک‌کردن عکس با `createImageBitmap(resize…)` بیرون از main thread آن را پایین نیاورد (77 تا 256 ms) |
| تصمیم | چون اندازه از ۱۰۰ ms گذشت، ارزیابی به Web Worker منتقل شد. main thread فقط Blob را می‌فرستد و عدد را می‌گیرد |
| زمان تا رسیدن حکم با Worker، کندسازی ۴×، build production (`CI=1`) | 98 تا 169 ms، و پس از merge با main 84 تا 130 ms، هر بار برای شش عکس (`performance.measure` با نام `recalino:photo-quality:worker`، از ارسال Blob تا رسیدن پاسخ؛ این زمان کار main thread نیست). در dev server همین عدد 164 تا 1192 ms بود، چون هر Worker تازه module را بارگذاری و JIT را از نو گرم می‌کند |

**هشدار:** این اندازه‌ها روی گوشی واقعی متوسط گرفته نشده‌اند. کندسازی ۴× CPU در Chromium روی سرور جایگزین گوشی شده است. اندازه‌گیری روی گوشی واقعی هنوز باز است (پرسش ۵).

امتیازهای diagnostics عکس‌های Chromium (مرحلهٔ ۲ کالیبره‌کردن):

| عکس (canvas، ۸۰۰×۶۰۰) | حکم | sharpness | exposure (میانه) | glare | edgeDensity |
|---|---|---|---|---|---|
| تخته با نوشته | `ok` | 797 | 863 | 0 | 123 |
| همان با `blur(4px)` | `blurry` | 1 | 863 | 0 | 129 |
| پوشش سیاه ۸۲٪ | `too_dark` | 750 | 157 | 0 | 99 |
| `lighter` با ۱۶۰ | `too_bright` | 1000 | 1000 | 847 | 88 |
| گرادیان سفید ۹۰ تا ۱۳۰ px | `glare` | 511 | 863 | 55 | 110 |
| بدون نوشته | `low_detail` | 0 | 863 | 0 | 0 |

(امتیازها عدد صحیح ۰ تا ۱۰۰۰اند، یعنی مقدار × ۱۰۰۰ با سقف ۱۰۰۰.)

## ۶. قواعد رعایت‌شده

- **PRD-REC-02:** پنجره، صدا، toast یا banner وجود ندارد. حکم فقط در ردیف همان عکس می‌آید و `Status` آن نقش `status` دارد، نه `alert`. Sheet فقط وقتی باز می‌شود که زبان‌آموز خودش روی عکس بزند. e2e بررسی می‌کند که حین ضبط هیچ `dialog[open]` و هیچ `alert` دارای متنی نیست.
- **PRD-REC-07 و PRD-CORE-05:** عکس همیشه پیش از ارزیابی ذخیره می‌شود و ارزیابی هیچ اثری روی ذخیره ندارد. Retake عکس قبلی را پاک نمی‌کند. e2e بررسی می‌کند که پس از Retake سه عکس می‌ماند.
- **PRD-PRIV-06:** diagnostics فقط عدد صحیح، enum و شناسهٔ تصادفی محلی عکس را می‌فرستد. route هر فیلد دیگری را رد می‌کند (آزمون: `pixels`، نام فایل به‌جای uuid، عدد کسری و عدد بیش از ۱۰۰۰).
- **رابط:** فقط `Sheet`، `Status`، `Button` و `Actions` موجود استفاده شده‌اند. آیکون، رنگ، فونت یا token تازه‌ای اضافه نشده است. عنوان Sheet همان متن alt موجود است: «Board captured around {time}».

## ۷. Diagnostics

نمونهٔ خط لاگ Vercel:

```json
{"event":"capture_health","capture_event":"photo_quality","platform":"android","browser":"chrome","photo_id":"…uuid…","verdict":"blurry","sharpness":20,"exposure":863,"glare":0,"edge_density":121}
```

- `photo_id` همان شناسهٔ محلی عکس است و کلید عملیات آپلود آن هم هست (`recorded-photo:<id>`). پس می‌شود آن را با نتیجهٔ سرور تطبیق داد.
- شش فیلد تازه به allow-list لاگ ([`log.ts`](../../packages/core/src/plt/log.ts)) اضافه شدند: `photo_id`، `verdict`، `sharpness`، `exposure`، `glare` و `edge_density`.
- رخداد فقط برای عکسی فرستاده می‌شود که در همین صفحه گرفته شده است. باز کردن دوبارهٔ صفحه حکم را دوباره حساب می‌کند، ولی رخداد تکراری نمی‌فرستد.
- رخداد مثل رخدادهای عادی منتظر دستهٔ ۶۰ ثانیه‌ای می‌ماند. پنجاه رخداد در یک دسته، با بیشترین مقدارها، ۹٫۳ KiB می‌شود که زیر سقف ۱۶ KiB است (آزمون route).
- idempotency همان قاعدهٔ قبلی است: یک کلید برای هر دسته.

## ۸. آزمون‌ها و شواهد

- **unit:** [`photo-quality.test.ts`](../../apps/web/src/ui/recording/photo-quality.test.ts) شامل هر شش حکم روی تصویرهای ساخته‌شده در آزمون (و سه حالت تختهٔ سیاه)، هفت بررسی هشدار نادرست (از جمله تختهٔ سیاه)، ترتیب تاری، کران امتیازها و سقف ۶۰ ms است. [`photo-quality-client.test.ts`](../../apps/web/src/ui/recording/photo-quality-client.test.ts) بررسی می‌کند که تابع throw نمی‌کند و هر عکس یک بار ارزیابی می‌شود. `capture-diagnostics.test.ts` ارسال `photo_quality` و پس‌گرفتن رخدادِ فرستاده‌نشدهٔ عکسِ حذف‌شده را می‌آزماید، و `recording-routes.test.ts` لاگ، سقف ۱۶ KiB و ردِ payloadهای نامجاز را. [`photo-removal.test.ts`](../../apps/web/src/ui/recording/photo-removal.test.ts) هم شرط حذف (آپلودشده، در گروه آپلود، فقط محلی) و حذف فقط همان عکس، حکم و رخدادش را می‌آزماید.
- **e2e:** [`photo-readability.spec.ts`](../../apps/web/e2e/photo-readability.spec.ts) دو PNG (تیز و تار) را با canvas صفحه می‌سازد و هر دو خط حکم را بررسی می‌کند. همچنین Sheet بزرگ‌نمایی با `naturalWidth` برابر ۸۰۰، ثابت ماندن `src` تصویر کوچک در ۵ ثانیه ضبط، نبودِ dialog یا alert حین ضبط، Retake و نگه‌داشتن هر سه عکس، حذف عکس تار حین ضبط (اول Keep و ماندن عکس، بعد حذف و رسیدن به دو عکس، بدون قطع ضبط)، دکمهٔ حذف در Sheet، حکم‌ها پس از Stop، و رسیدن رخدادهای `photo_quality` عکس‌های باقی‌مانده بدون `data:image` را می‌آزماید. [`photo-readability-screens.spec.ts`](../../apps/web/e2e/photo-readability-screens.spec.ts) فقط با `RECALINO_SCREENSHOTS=1` اجرا می‌شود و تصویرها و اندازه‌ها را می‌سازد.
- **تصویرها:** [`artifacts/verification/feat-photo-readability/`](../../artifacts/verification/feat-photo-readability/) شامل `photo-row-<verdict>-{390,1440}.png` برای هر شش حکم، `capture-{390,1440}.png`، `zoom-sheet-{390,1440}.png` و `photo-remove-confirm-{390,1440}.png` (پیام تأیید حذف) است. ردیف‌های عکس دکمهٔ «Remove this photo» را هم نشان می‌دهند.

### ۸.۱ اجرای محلی (2026-10-13)

روی Node 24.21.0 (نصب با nvm در container؛ پیش‌فرض container، Node 22 بود) و pnpm 12.4.2، با Supabase محلی در Docker. متغیرهای ابری `SUPABASE`، `NEXT_PUBLIC_SUPABASE` و `OPENROUTER` با `unset` حذف شدند. Playwright 1.63 مرورگر 1243 می‌خواهد، ولی در container مرورگر 1194 نصب است. symlink در scratchpad این را حل کرد؛ چیزی نصب نشد.

| دستور | خط خلاصه |
|---|---|
| `pnpm verify` | `Checked 1210 files in 1809ms. No fixes applied.` (سه هشدار قدیمی در فایل‌های `*.int.test.ts` که به این کار ربطی ندارند) · typecheck هر سه بسته `Done` · `✔ no dependency violations found (1289 modules, 5995 dependencies cruised)` · `Test Files 360 passed \| 1 skipped (361)` · `Tests 4182 passed \| 1 skipped (4183)` · `Duration 348.16s` |
| `pnpm build` | `✓ Compiled successfully in 34.2s`. Worker در chunk جدای `9546` است و فقط کد ارزیابی را دارد |
| `pnpm check:client-bundle` | `No secrets in the client-visible build output.` |
| `CI=1 RECALINO_DEV_UI=1 RECALINO_SCREENSHOTS=1 pnpm test:e2e` با `photo-readability.spec.ts`، `photo-readability-screens.spec.ts`، `recording.spec.ts`، `recording-capture.spec.ts` و `recording-decode.spec.ts` | `5 passed (32.2s)`، بدون شکست و بدون flaky. خروجی decode: `{"declaredMs":18120,"decodedMs":18120}` |

**پس از merge با `main` @ `395c834` (PR #50 و #51؛ commit merge `19cee1f`):** `pending-copy.ts` فقط `photoQuality.*` و `fillCopy` را دارد. `UI_COPY_PENDING.md` یادداشت تأیید main را نگه داشته و فقط هشت کلید D72 را فهرست می‌کند. `RecordingView` هم `recordingCopy.introduction` را نگه داشته است.

| دستور | خط خلاصه |
|---|---|
| `pnpm lint` | `Checked 1213 files in 1725ms. No fixes applied.` |
| `pnpm typecheck` | `packages/core typecheck: Done` · `packages/ops-cli typecheck: Done` · `apps/web typecheck: Done` |
| `pnpm check:boundaries` | `✔ no dependency violations found (1292 modules, 5994 dependencies cruised)` |
| `pnpm test:unit` | `Test Files 208 passed (208)` · `Tests 3473 passed (3473)` |
| `pnpm build` / `check:client-bundle` | `✓ Compiled successfully in 20.0s` · `No secrets in the client-visible build output.` |
| `CI=1 RECALINO_DEV_UI=1 pnpm test:e2e` با `photo-readability.spec.ts`، `recording.spec.ts`، `recording-capture.spec.ts` و `recording-decode.spec.ts` | `4 passed (30.8s)`، بدون flaky. decode: `{"declaredMs":18180,"decodedMs":18180}` |
| `photo-readability-screens.spec.ts` (`RECALINO_SCREENSHOTS=1`) | `1 passed (9.1s)`. تصویرها روی همین وضعیت دوباره ساخته شدند |

**پس از تأیید متن‌ها و کنترل حذف (همان روز):**

| دستور | خط خلاصه |
|---|---|
| `pnpm lint` | `Checked 1215 files in 1820ms. No fixes applied.` |
| `pnpm typecheck` | `packages/core typecheck: Done` · `apps/web typecheck: Done` · `packages/ops-cli typecheck: Done` |
| `pnpm check:boundaries` | `✔ no dependency violations found (1294 modules, 6001 dependencies cruised)` |
| `pnpm test:unit` | `Test Files 209 passed (209)` · `Tests 3473 passed (3473)`. چهار آزمون تازه اضافه شد و چهار آزمونِ ثبت متن کم شد، چون متن‌های در انتظار از هشت به چهار رسیدند |
| `pnpm build` / `check:client-bundle` | `✓ Compiled successfully in 18.2s` · `No secrets in the client-visible build output.` |
| `CI=1 RECALINO_DEV_UI=1 RECALINO_SCREENSHOTS=1 pnpm test:e2e` با `photo-readability`، `photo-readability-screens`، `recording`، `recording-capture` و `recording-decode` | `5 passed (31.9s)`، بدون flaky. decode: `{"declaredMs":18240,"decodedMs":18240}`. Worker با کندسازی ۴×: 97 تا 194 ms |

## ۹. محدودیت‌ها

- آستانه‌ها فقط با تصویر مصنوعی کالیبره شده‌اند (بخش ۴). عکس واقعی ممکن است مشکلی داشته باشد که در این تصویرها نبود: نور خورشید، کاغذ به‌جای تخته، یا عکس کج. تختهٔ سیاه با گچ فقط به‌صورت مصنوعی آزموده شده است.
  - تختهٔ سیاهِ **خالی** `too_dark` می‌گیرد، نه `low_detail`. چنین عکسی در هر حال به کار نمی‌آید.
- `glare` فقط ناحیهٔ بزرگ، بریده و بی‌جزئیات را می‌بیند. بازتاب نیمه‌شفافی که نوشته را کم‌رنگ می‌کند ولی نمی‌بُرد، ممکن است دیده نشود.
- حکم در IndexedDB ذخیره نمی‌شود و با هر باز کردن صفحه دوباره حساب می‌شود (در Worker، و برای هر عکس یک بار).
- تخته‌ای که تمام زمینه‌اش بریده ولی نوشته‌اش پررنگ است، `ok` می‌گیرد. این عمدی است، چون چنین عکسی خواناست.
- اندازه‌گیری روی گوشی واقعی انجام نشده است (بخش ۵).
- حذف عکس: آپلود دستیِ تک‌عکس (دکمهٔ «Retry photo upload» یا «Add photo to session») journal ندارد. اگر چنین آپلودی پس از ساخت منبع روی سرور و پیش از ثبت `sourceAssetId` شکست بخورد، عکس محلی هنوز قابل حذف است و منبع بی‌صاحب روی سرور می‌ماند. آن منبع از صفحهٔ منابع حذف‌شدنی است. حین خود آپلود، همهٔ دکمه‌ها غیرفعال‌اند.

## ۱۰. فایل‌های بیرون از `recording/**`

- `packages/core/src/plt/log.ts`: شش فیلد allow-list. بدون آن‌ها لاگ `photo_quality` خالی می‌ماند (`dropped_fields`).
- `apps/web/src/ui/pending-copy.ts` و `docs/design/UI_COPY_PENDING.md`: متن‌ها (D65).
- `apps/web/src/server/recording-routes.test.ts`: آزمون route.
- `apps/web/e2e/photo-readability*.spec.ts` و `artifacts/verification/feat-photo-readability/`.

## ۱۱. پرسش‌ها و پاسخ‌ها

1. **حذف یک عکس محلی:** پاسخ مالک محصول 2026-10-13: ساخته شود (بخش ۲.۱). چهار متن `photoRemove.*` در انتظار تأیید‌اند.
2. **لنگر Retake پس از Stop:** پاسخ مدیر: همین رفتار بماند (قطعه و `offsetMs` عکس اول؛ حین ضبط، لحظهٔ حال).
3. **`photo_id` در لاگ:** پاسخ مدیر: پذیرفتنی است. یک uuid تصادفی محلی همراه چند عدد، شناسه است نه محتوا (ثبت ذیل قاعدهٔ ۳ D72).
4. **عنوان Sheet:** پاسخ مدیر: متن alt موجود و از پیش تأییدشده می‌ماند. استفادهٔ دیدنی آن برای بازبینی بعدی متن‌ها یادداشت شد.
5. **اندازه‌گیری روی گوشی واقعی متوسط:** هنوز باز است و به مالک محصول رفته است.
6. **متن‌ها:** هشت متن `photoQuality.*` در 2026-10-13 عیناً تأیید و به `recording-copy.ts` منتقل شدند.
7. **کالیبره با عکس‌های مالک محصول (قاعدهٔ ۳ D72):** هنوز باز است و به آن عکس‌ها نیاز دارد.
