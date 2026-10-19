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
| 13px | 26 | `var(--rc-text-sm)` (14px) | +1px | `var(--rc-text-xs)` (12px) برای برچسب و راهنمای ریز، −1px |
| 15px | 14 | `var(--rc-text-md)` (16px) | +1px | `var(--rc-text-sm)` (14px)، −1px |
| 18px | 3 | `var(--rc-text-read)` (17px) | −1px | `var(--rc-text-lg)` (20px)، +2px |

اگر مالک محصول نگه‌داشتن 13 و 15 را می‌خواهد، راه دوم این است که آن‌ها یک بار در `app.css` به‌عنوان token لایهٔ بازطراحی (مثلاً `--rc-text-13`) ثبت شوند و CSS Moduleها به آن‌ها ارجاع دهند. این کار مقدار تازه‌ای وارد نمی‌کند، فقط مقدار موجود را نام‌گذاری می‌کند، ولی تصمیم طراحی است.

### جای مقدارها (شماره خط در `apps/web/src/ui`، وضعیت 2026-10-19)

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

18px:

- `components/Feedback.module.css`: 25
- `voice/Voice.module.css`: 48
- `workspace/NoteView.module.css`: 220

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
| `max-width: 600px` / `min-width: 600px` | `workspace/ClassDirectory`، `AutomaticLearningView`، `ClassRows`، `support/Support`، `preview/LearningViews`، `components/StudyOverview` (min) |
| `max-width: 850px` | `preview/LearningViews` |
| `max-width: 520px` / `480px` / `400px` | `voice/Voice`، `workspace/NoteView`، `notifications/NotificationCenter` |
| `min-width: 1100px` | `components/StudyOverview` |
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
