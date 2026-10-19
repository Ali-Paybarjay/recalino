# پیگیری token رابط، ممیزی 2026-10-18 (UI-02 و UI-04)

این یادداشت بخشی از رفع یافته‌های UI-02 و UI-04 است که **بدون تصمیم مالک محصول یا طراح** اعمال نشد. هیچ مقداری در CSS Moduleها بر پایهٔ این جدول عوض نشده است. vendor و token‌های پایه دست‌نخورده‌اند.

## UI-02: مقیاس موازی 13 / 15 / 18 پیکسل

اعمال‌شده: همهٔ `font-size: 10px` و `11px` بیرون از vendor به `var(--rc-text-xs)` (12px) رسیدند (`shell/AppShell.module.css` برای `.navCaption`، `preview/AccountViews.module.css` برای `.badge`). `.navCaption` در عرض تبلت به‌جای 10px، `letter-spacing: 0` و `overflow-wrap: anywhere` گرفت.

اعمال‌نشده: 13، 15 و 18 پیکسل. tokenهای موجود (`tokens.css:16-23`):

| token | مقدار |
|---|---|
| `--rc-text-xs` | 12px |
| `--rc-text-sm` | 14px |
| `--rc-text-md` | 16px |
| `--rc-text-read` | 17px |
| `--rc-text-lg` | 20px |

### نگاشت پیشنهادی

| مقدار خام | تعداد | نگاشت پیشنهادی | تغییر ظاهر | جایگزین |
|---|---|---|---|---|
| 13px | 33 (26 در `ui/`، 7 در `app/`) | `var(--rc-text-sm)` (14px) | +1px | `var(--rc-text-xs)` (12px) برای برچسب و راهنمای ریز، −1px |
| 15px | 20 (14 در `ui/`، 6 در `app/`) | `var(--rc-text-md)` (16px) | +1px | `var(--rc-text-sm)` (14px)، −1px |
| 18px | 5 (3 در `ui/`، 2 در `app/`) | `var(--rc-text-read)` (17px) | −1px | `var(--rc-text-lg)` (20px)، +2px |

اگر مالک محصول نگه‌داشتن 13 و 15 را می‌خواهد، راه دوم این است که آن‌ها یک بار در `app.css` به‌عنوان token لایهٔ بازطراحی (مثلاً `--rc-text-13`) ثبت شوند و CSS Moduleها به آن‌ها ارجاع دهند. این کار مقدار تازه‌ای وارد نمی‌کند، فقط مقدار موجود را نام‌گذاری می‌کند، ولی تصمیم طراحی است.

### جای مقدارها (شماره خط در `apps/web/src/ui` و `apps/web/src/app`، وضعیت 2026-10-19)

فهرست کل `apps/web/src` را پوشش می‌دهد (بیرون از `ui/styles/vendor`). نتیجهٔ `grep -rnE "font-size:\s*(13|15|18)px" apps/web/src --include=*.css` است: 33، 20 و 5 مورد.

زیر `apps/web/src/ui`:

13px:

- `admin/Admin.module.css`: 29، 106، 236، 571
- `components/Field.module.css`: 21، 27
- `components/Status.module.css`: 51، 74، 154
- `components/StudyOverview.module.css`: 104، 167
- `preview/AccountViews.module.css`: 52
- `preview/LearningViews.module.css`: 69
- `shell/AppShell.module.css`: 154، 163
- `voice/Voice.module.css`: 56، 84
- `workspace/AutomaticLearningView.module.css`: 37، 175
- `workspace/NoteView.module.css`: 65، 192
- `workspace/SessionNotesReader.module.css`: 75، 189، 220، 227، 246

زیر `apps/web/src/app`:

- `SignIn.module.css`: 98، 216
- `setup/setup.module.css`: 113، 210
- `(app)/me/profile.module.css`: 76
- `(app)/app.module.css`: 28
- `dev/ui/shell/page.module.css`: 16

15px:

- `components/Feedback.module.css`: 133
- `components/ListPicker.module.css`: 99
- `components/SegmentedControl.module.css`: 18
- `components/Sheet.module.css`: 120
- `components/Snackbar.module.css`: 23
- `components/StudyOverview.module.css`: 189
- `components/Switch.module.css`: 7
- `preview/AccountViews.module.css`: 93
- `shell/AppShell.module.css`: 102، 174
- `workspace/AutomaticLearningView.module.css`: 72، 154، 194، 237

زیر `apps/web/src/app`:

- `SignIn.module.css`: 148
- `setup/setup.module.css`: 200، 317
- `(app)/me/profile.module.css`: 165
- `(app)/me/edit/[field]/EditField.module.css`: 15
- `dev/ui/UiKit.module.css`: 81

18px:

- `components/Feedback.module.css`: 25
- `voice/Voice.module.css`: 48
- `workspace/NoteView.module.css`: 220

زیر `apps/web/src/app`:

- `dev/ui/shell/page.module.css`: 12، 28

### مقدارهای خامِ دیگر بیرون از مقیاس

17px (برابر `--rc-text-read` و قابل تبدیل بی‌تغییر ظاهر)، 19، 25، 27 و اندازه‌های عنوان (22، 23، 28، 30، 32، 36 و جز آن) در `components/RadioCards`، `StudyOverview`، `LegalDocument`، `Wordmark`، `admin/Admin`، `preview/preview.css` و `preview/*.module.css`. این‌ها در این دسته بررسی یا عوض نشدند. تبدیل 17px به `var(--rc-text-read)` بدون تغییر ظاهر ممکن است و می‌تواند همراه تصمیم بالا انجام شود.

## UI-04: breakpointهای پراکنده

اعمال‌شده:

- سایه‌های خام `rgb(0 0 0 / …)` در `NoteView`، `Recording` و `preview/LearningViews` به `var(--shadow-md)` یا `var(--shadow-lg)` رسیدند.
- `padding-left` در `Sheet` و `LegalDocument`، `border-left` و `padding-left` در `preview.css` (`.preview-note-preview`) و `border-right` در `AppShell` به معادل logical رسیدند.
- حلقهٔ focus واحد: قاعدهٔ 3px زیر `.preview-root` در `preview.css` و قاعدهٔ 3px زیر `.layout` در `LearningViews.module.css` حذف شدند تا قاعدهٔ 2px پایه (`tokens.css:144`) برسد. سه قاعدهٔ 3px دیگر در `NoteView`، `ClassDirectory` و `AutomaticLearningView` به 2px رسیدند. offsetها که به هندسهٔ هر کنترل بسته‌اند، عوض نشدند. `recovery.module.css` عمداً مستقل است و دست نخورد.

اعمال‌نشده: یکسان‌سازی `@media`. نقاط پوسته 767/768 و 1023/1024 هستند. الگوهای دیگر که ماندند:

| الگو | جاها |
|---|---|
| `max-width: 600px` / `min-width: 600px` | `workspace/ClassDirectory`، `AutomaticLearningView`، `ClassRows`، `support/Support`، `preview/LearningViews`، `components/StudyOverview` (min)، `app/(app)/me/profile.module.css` (max) |
| `max-width: 850px` | `preview/LearningViews` |
| `max-width: 520px` / `480px` / `400px` | `voice/Voice`، `workspace/NoteView`، `notifications/NotificationCenter` |
| `min-width: 1100px` | `components/StudyOverview`، `app/SignIn.module.css` |
| `max-width: 720px`، `1050px`، `min-width: 1600px` | `admin/Admin` (رابط ادمین، جدا از پوستهٔ زبان‌آموز) |
| `max-height: 700px` | `preview/AccountViews` |

پیشنهاد: هر الگو را در یک دستهٔ بعدی با screenshot در 375 و 768 و 1440 به یکی از نقاط پوسته ببرید، یا کنار همان `@media` با یک کامنت کوتاه استثنا را مستند کنید. تغییر این مقدارها جابه‌جایی چیدمان است و باید با ظاهر طرح مقایسه شود، پس در این دسته انجام نشد.

## A11Y-02: چرا `lang` در خروجی فارسی `study-render` اضافه نشد

حذف `lang` برای زبان توضیح فارسی عمدی است، نه سهو:

- خروجی فارسی بازتولید HTML مرجع مالک محصول است (`packages/core/test/reference-output/`). آزمون‌های `study-render.test.ts` (بازتولید بخش‌های مرجع و چهار نوع کارت) نمای نرمال‌شده را **با attributeها** با آن مرجع مقایسه می‌کنند، و مرجع `dir` دارد ولی `lang` ندارد.
- `CardFace.module.css` برای همین الگو انتخابگر `[dir="ltr"]:not([lang])` و `[dir="rtl"]:not([lang])` دارد.
- زبان‌های دیگر `lang` را می‌نویسند.

به‌جای تغییر خروجی ذخیره‌شده و خروجی دانلودی، `cardHtmlWithLanguages` (`packages/core/src/lkm/card-html.ts`) هنگام نمایش در `CardFace` زبان را اضافه می‌کند: بلوک سطح بالای بدون `lang` با `dir="ltr"` انگلیسی و با `dir="rtl"` فارسی می‌شود، و `<bdi>` بدون `lang` داخل بلوک فارسی انگلیسی. کارت ذخیره‌شده، خروجی TSV و APKG، و فایل جزوهٔ مستقل دست نخوردند.

باقی‌مانده: در جزوهٔ مستقل فارسی (iframe `ClassNotesFrame` و فایل دانلودی) بلوک‌های انگلیسی هنوز `lang="en"` ندارند و زیر `<html lang="fa">` خوانده می‌شوند. رفعش نیازمند تصمیم مالک محصول برای نرمال‌سازی `lang` در مقایسهٔ مرجع است.

## UX-08: محدودیت‌های شناخته‌شدهٔ `(app)/loading.tsx`

- `shellSectionFor` (`apps/web/src/app/(app)/nav.ts`) فقط مسیری را به بخش ناوبری نگاشت می‌کند که صفحه‌اش `LearnerShell` می‌کشد. خواندنگر جزوهٔ جلسه (`/sessions/<id>/notes`) `SessionNotesReader` را بدون پوسته می‌کشد و `loading.tsx` خودش را دارد، پس `null` برمی‌گرداند؛ `/sessions/<id>/notes/versions` همچنان `classes` است.
- `/me/voice` بسته به `returnHref` گاهی `current="classes"` می‌کشد، ولی حالت بارگذاری `me` را نشان می‌دهد. اثرش فقط چند ده میلی‌ثانیه نشانگر نادرست ناوبری است و برای رفعش باید پوستهٔ صفحه به layout برود (تصمیم باز مالک محصول در گزارش UX-08).
- نشان «Review due» هنگام بارگذاری نیست.
