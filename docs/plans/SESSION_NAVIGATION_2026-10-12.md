# ناوبری جلسه و گام بعد — گزارش پیاده‌سازی (2026-10-12)

شاخه: `feat/session-navigation`. مبنا: بخش ۷ (مشکل ۵) در [FIVE_PROBLEMS_ROOT_CAUSE_2026-10-12](FIVE_PROBLEMS_ROOT_CAUSE_2026-10-12.md) و «مشاهدات رابط برای طراحی بعدی» در [PROCESSING_SPEED_2026-10-10](PROCESSING_SPEED_2026-10-10.md).

## ۱. چه تغییر کرد و چرا

### ۱.۱ یک resolver برای «الان چه کنم؟»

- [`session-state.ts`](../../apps/web/src/ui/workspace/session-state.ts): تابع خالص `sessionNextStep` وضعیت جلسه را به این سه چیز تبدیل می‌کند: یک سطر وضعیت، دقیقاً یک اقدام اصلی و چند اقدام فرعی اختیاری.
- ورودی‌های آن:
  - وضعیت یادگیری خودکار و Run
  - دسته‌های آپلود و پیشرفت انتقال صوت
  - انتقال‌های صوتی ذخیره‌شده در صف آپلود
  - ضبط در جریان یا ضبط تمام‌شده‌ای که هنوز ارسال نشده
  - وجود جزوه و کارت
  - تأیید صدای در انتظار
- سطر وضعیت و برچسب دکمه‌ها از همان متن‌های موجود می‌آیند: `learning-progress.ts`، `automaticLearningRecovery` و برچسب‌های صفحهٔ جلسه.
- برای جلوگیری از چرخهٔ Retry بی‌نتیجه:
  - کمبود سهمیه یا نبود سهمیه: Retry پیشنهاد نمی‌شود. اقدام اصلی «Ask for more allowance» یا «Ask the pilot operator» است. Retry فقط وقتی سهمیه کافی است، یا وقتی مقدارها معلوم نیست، می‌آید (FR-QUOTA-007).
  - توقف سرویس: «Request processing review» یا «View processing review» نمایش داده می‌شود، نه Retry.
  - صوت ذخیره‌شده‌ای که سرور برای همیشه رد کرده است: دکمهٔ «Retry saved audio upload» نمی‌آید و «Review material» نمایش داده می‌شود. قاعده همان `audioUploadRetryable` شاخهٔ `feat/upload-reliability` است: Retry فقط وقتی کد دلیل (`reason`) خالی یا `unknown` باشد می‌آید. هر کد پایدار دیگر، مثل `audio_upload_not_started`، `audio_upload_incomplete` و `audio_upload_rejected`، حالتی است که Retry تغییرش نمی‌دهد. مقدار غیرمتنی به‌صورت تدافعی خالی خوانده می‌شود. پس از ادغام می‌توان `uploadRetryCanHelp` را به خود `audioUploadRetryable` وصل کرد.
  - `audio_upload_rejected`: به‌جای پیام نادرست «The audio could not be verified…» پیام تازه‌ای نمایش داده می‌شود. Retry کنار «Review material» می‌آید. بعد از رفع رزرو صفر در شاخهٔ upload، Retry موفق می‌شود.
  - هنگام ضبط فقط «Recording in progress» و «Open recording» نمایش داده می‌شود و پنجره یا هشداری نمی‌آید (PRD-REC-02).

### ۱.۲ صفحهٔ جلسه

[`sessions/[id]/page.tsx`](../../apps/web/src/app/(app)/sessions/[id]/page.tsx):

- بالای صفحه کارت «Next step» قرار دارد ([`SessionNextStep.tsx`](../../apps/web/src/ui/workspace/SessionNextStep.tsx)) و وضعیت اولیه از سرور خوانده می‌شود.
- کاشی‌های «Session notes» و «Flashcards» فقط وقتی جزوه یا کارت وجود دارد نمایش داده می‌شوند. قاعدهٔ وجود همان قاعدهٔ صفحه‌های جزوه و کارت است: `hasNotes` و `canOpenCards`.
- «View progress» از «More session tools» بیرون آمد. پیشرفت و بازیابی همیشه در کارت بالای صفحه هستند.

### ۱.۳ Today

- کارت آخرین جلسه با همان resolver ساخته می‌شود.
- دکمهٔ اصلی این کارت ثانویه رندر می‌شود تا «Record a session» تنها دکمهٔ اصلی پررنگ بماند (D32).

### ۱.۴ یک جا برای مطالب و وضعیت

- [`material-page.tsx`](../../apps/web/src/app/(app)/sessions/[id]/sources/material-page.tsx): مسیرهای `/sources`، `/estimate` و `/processing` همه یک صفحه را نشان می‌دهند. بالای آن کارت وضعیت کامل با بازبینی پردازش (`#session-progress`) است و زیر آن مطالب جلسه (`SourcesView` با `withStatus`).
- مسیرها و redirectهای قبلی حفظ شده‌اند.
- دکمه‌های تکراری حذف شدند:
  - در `SourcesView`، دکمه‌های Retry، سهمیه و «Review processing» وقتی کارت وضعیت بالای صفحه هست تکرار نمی‌شوند.
  - در صف «Your audio uploads»، دکمهٔ Retry حذف شد و پیوندش به `/sources#session-progress` تغییر کرد.
  - «Retry saved audio upload» فقط در کارت وضعیت همان صفحه می‌آید، آن هم وقتی می‌تواند موفق شود.
- اعلان‌ها به `/classes/<id>/processing` اشاره می‌کنند. این مسیر حالا همان صفحهٔ واحد را نشان می‌دهد، پس کد core تغییر نکرد.

### ۱.۵ گام صدا

- `VoiceConfirmation` از بالای جزوه برداشته شد ([`notes/page.tsx`](../../apps/web/src/app/(app)/sessions/[id]/notes/page.tsx)).
- اگر بررسی صدا منتظر تأیید باشد، کارت اختیاری «Your voice in this session» در صفحهٔ جلسه نمایش داده می‌شود و به صفحهٔ تازهٔ [`/sessions/[id]/voice`](../../apps/web/src/app/(app)/sessions/[id]/voice/page.tsx) می‌رود.
- این صفحه همان کامپوننت موجود `VoiceConfirmation` را بدون children نشان می‌دهد. API تازه‌ای از شاخهٔ voice در دسترس نبود.
- پیوند همین صفحه در «More session tools» هم هست.

### ۱.۶ پس از تصمیم‌های مالک (2026-10-12)

- **انتشار جزوه پیش از نتیجهٔ صدا رد شد.** وقتی درس نوشته شده و انتشار منتظر بررسی صداست، وضعیت `/learning` حالا `stage: "checking_voices"` دارد. این حالت با تابع فقط‌خواندنی و owner-scoped [`runFinishingStage`](../../packages/core/src/proc/run-stage.ts) تشخیص داده می‌شود: Run در حال پردازش است، گام `knowledge` ذخیره شده، منبع صوتی هست و تشخیص صدا فعال است. سطر وضعیت در این حالت «Finishing your notes» است، با توضیح بررسی صدا، و دیگر انتظاری بی‌توضیح نیست. فیلد فقط وقتی مقدار دارد اضافه می‌شود، پس شکل قبلی وضعیت عوض نمی‌شود.
- **D60 و D61:** resolver حالت‌های حین ضبط و پس از Stop را هم پوشش می‌دهد:
  - حین ضبط، اگر قطعهٔ بسته‌شده‌ای از همان ضبط در سرور ثبت شده باشد، سطر وضعیت می‌گوید قطعه‌ها در پس‌زمینه ارسال می‌شوند. این از ردیف‌های ذخیره‌گاه ضبط و به‌صورت تدافعی خوانده می‌شود. حین ضبط هیچ هشدار یا مشکلی نمایش داده نمی‌شود (PRD-REC-02).
  - «Sending the last part» از پیشرفت اندازه‌گیری‌شدهٔ ارسال صوت همان Run می‌آید: وقتی از چند قطعه فقط یکی هنوز در حال ارسال است. ثبت قطعه در سرور (`sourceAssetId`) پیش از ارسال صوت انجام می‌شود، پس مبنای این پیام نیست.
  
  رونویسی پس‌زمینه (D61) متنی نشان نمی‌دهد و فقط از وضعیت پردازش سرور خوانده می‌شود.
- **D64:** گام صدا همان گام اختیاری یک‌جا برای هر کلاس است: کارت در صفحهٔ جلسه و صفحهٔ `/sessions/[id]/voice`. اجزای داخلی آن (انتخاب در سطح خط) با شاخهٔ voice است و صفحه همان `VoiceConfirmation` را نشان می‌دهد.
- **D65:** تصویرهای ۳۹۰ و ۱۴۴۰ پیکسل همهٔ صفحه‌های تغییرکرده در [`artifacts/verification/feat-session-navigation/`](../../artifacts/verification/feat-session-navigation/) هستند و آزمون [`session-navigation-screens.spec.ts`](../../apps/web/e2e/session-navigation-screens.spec.ts) آن‌ها را می‌سازد:
  - `session-with-notes`
  - `session-empty`
  - `material-and-status-sources` و `material-and-status-processing`
  - `notes`
  - `voice-step`
  - `today`
- **همسانی Today:** کارت Today و صفحهٔ جلسه حالا یک قاعدهٔ محتوا دارند و یک گام را نشان می‌دهند. آزمون مرورگر همین را بررسی می‌کند.

## ۲. آزمون‌ها و شواهد

### ۲.۱ اجرای محلی به‌جای CI

GitHub Actions از حدود 22:16 UTC روز 2026-10-12 در کل مخزن کاری را شروع نمی‌کند (پیام مدیر). به همین دلیل همان مراحل CI به‌صورت محلی روی کد نهایی اجرا شدند:

- Node 24.21.0 و pnpm 12.4.2
- Supabase محلی در Docker، فقط با داده و کاربر مصنوعی
- بدون کلید ابری و بدون کلید provider: `env -u SUPABASE_SECRET_KEY -u OPENROUTER_API_KEY`. این سشن یک `SUPABASE_SECRET_KEY` ابری دارد که بر `.env.local` مقدم است، پس هیچ اتصال ابری یا فراخوان پولی رخ نداد.
- build و e2e مثل CI: `CI=1`، `RECALINO_DEV_UI=1`، `next start` روی build تولیدی.

| فرمان | خط خلاصه |
|---|---|
| `pnpm lint` | `Checked 1116 files in 3s. No fixes applied.` |
| `pnpm typecheck` | `packages/core typecheck: Done`، `apps/web typecheck: Done`، `packages/ops-cli typecheck: Done` |
| `pnpm check:boundaries` | `✔ no dependency violations found (1196 modules, 5436 dependencies cruised)` |
| `pnpm test` (unit و integration) | `Test Files  316 passed \| 1 skipped (317)` و `Tests  3903 passed \| 1 skipped (3904)` |
| `pnpm build` | `✓ Compiled successfully in 38.3s`، exit 0 |
| `pnpm test:e2e` | `268 passed (6.3m)` و `2 flaky`، exit 0 |

- **دو آزمون flaky:** هر دو در تلاش دوم سبز شدند و در اجرای کامل قبلی (`270 passed`، بدون flaky) هم سبز بودند. هیچ‌کدام به فایل‌های این شاخه مربوط نیست:
  - `automatic-learning.spec.ts:510`: خطای IndexedDB («object store not found») در مرحلهٔ آماده‌سازی خود آزمون (`page.evaluate`)، یعنی رقابت با ساخت پایگاه IndexedDB برنامه. این شاخه IndexedDB را تغییر نداده است.
  - `session-notes-reader.spec.ts:35` در ۳۹۰ پیکسل: ارتفاع iframe جزوه در ۸ فریم ثابت نشد. این آزمون روی `/dev/ui/study` اجرا می‌شود. `SessionNotesReader`، `NoteView` و آن صفحه در diff این شاخه نیستند.
- **اجرای نیمه‌کارهٔ شبانه:** نخستین اجرای نهایی ۵۶۰ شکست integration داشت، چون daemon Docker در زمان بیکاری سشن متوقف شده بود. پس از راه‌اندازی دوباره، همان اجرا کاملاً سبز شد (جدول بالا).

### ۲.۲ آزمون‌های تازه و به‌روزشده

- `session-state.test.ts`: ۲۷ آزمون واحد برای همهٔ حالت‌های تشخیص، حالت‌های D60 و بررسی صدا، قاعدهٔ Retry آپلود، و این قاعده که اقدام اصلی در اقدام‌های فرعی تکرار نشود.
- `run-stage.test.ts`: تصمیم «checking_voices» یا «publishing».
- `session-navigation.spec.ts` روی `/dev/ui/session`: هر حالت در ۳۹۰ و ۱۴۴۰ پیکسل، بدون اسکرول افقی و بدون خطای axe.
- `session-navigation-screens.spec.ts`: صفحه‌های واقعی با کاربر محلی مصنوعی، یکی بودن گام Today و صفحهٔ جلسه، و ساخت تصویرهای D65.
- e2eهای به‌روزشده:
  - `classes-browser`: جلسهٔ خالی دیگر کاشی جزوه و کارت ندارد.
  - `automatic-learning` و `processing-review`: href تازهٔ صفحهٔ واحد.

## ۳. flag و پیش‌فرض

flag تازه‌ای اضافه نشد. این تغییرها همان اصلاح‌هایی‌اند که مالک خواسته است (۷.۳). همهٔ متن‌های تازه در فهرست انتظار ثبت شده‌اند: [`UI_COPY_PENDING.md`](../design/UI_COPY_PENDING.md) و `pendingCopy.sessionNavigation`.

رفتارهای D60، D61 و D64 و kill-switchهایشان در شاخه‌های recording و voice هستند. این شاخه فقط وضعیت آن‌ها را می‌خواند. اگر هر کدام خاموش باشد، حالت متناظرش در resolver هیچ‌وقت فعال نمی‌شود و رفتار امروز می‌ماند.

## ۴. روش بررسی

1. `pnpm dev`، سپس `/dev/ui/session` را باز کنید. هر حالت resolver در یک کارت نمایش داده می‌شود.
2. جلسهٔ خالی: کارت «Add your session material» نمایش داده می‌شود و کاشی جزوه و کارت نیست.
3. پس از جزوه: «Read notes» اقدام اصلی است. اگر صدا منتظر تأیید باشد، کارت صدا هم نمایش داده می‌شود.

## ۵. محدودیت‌های باقی‌مانده

- **پیشرفت بررسی صدا:** «Finishing your notes» مرحله را می‌گوید، ولی درصد پیشرفت بررسی صدا را نه. سرور درصدی ثبت نمی‌کند.
- **شاخص D60 حین ضبط:** «ارسال در پس‌زمینه» از ثبت قطعهٔ ضبطِ در جریان (`sourceAssetId`) فهمیده می‌شود، نه از پایان ارسال آن. در کد فعلی، قطعهٔ ضبط خودکار پیش از Stop ثبت نمی‌شود، پس این پیام امروز ظاهر نمی‌شود. اگر شاخهٔ recording فیلد جدایی برای ارسال قطعه بسازد، هنگام ادغام باید به `useWaitingRecordings` در `SessionNextStep.tsx` وصل شود.
- **کارت وضعیت صفحهٔ مطالب:** هنوز اقدام‌هایش را خودش رندر می‌کند، با همان `automaticLearningRecovery` که resolver به کار می‌برد. اعلان کوچک صفحه‌های جزوه و کارت هم همین‌طور است. یکسان‌سازی کامل با resolver قدم بعد است.
- **بازگشت از تنظیمات صدا:** پیوند تنظیمات صدا هنوز به جزوه برمی‌گردد (`voice/navigation.ts`، مالکیت شاخهٔ voice).
- **ضبط‌های ارسال‌نشده:** شمارش ضبط‌های تمام‌شدهٔ ارسال‌نشده از IndexedDB خوانده می‌شود و فقط وقتی فاز ضبط عوض می‌شود دوباره خوانده می‌شود.
- **آزمون کاربری:** مسیر «ضبط ← Stop ← جزوه» با کاربر پایلوت انجام نشده است.

## ۶. فایل‌های بیرون از مالکیت این شاخه

- `AutomaticLearningProvider.tsx` (صف آپلود، شاخهٔ upload): حذف دکمهٔ Retry و تغییر پیوند.
- `SourcesView.tsx`: prop تازهٔ `withStatus`.
- `pending-copy.ts` و `UI_COPY_PENDING.md`: بخش «جریان کار ۵». اگر شاخه‌های دیگر هم بخش اضافه کنند، هنگام ادغام تعارض متنی ساده پیش می‌آید.
- `packages/core/src/proc/run-stage.ts` (فایل تازه) و یک سطر export در `proc/index.ts`.
- `apps/web/src/server/automatic-learning.ts`: فیلد اختیاری `stage`.
- `.gitignore`: استثنای پوشهٔ تصویرهای D65.

## ۷. تصمیم‌های پیشنهادی

1. وضعیت جلسه در همهٔ رابط فقط از resolver «گام بعد» بیاید. کارت وضعیت صفحهٔ مطالب و اعلان صفحه‌های جزوه و کارت هم بعداً به آن منتقل شوند.
2. تأیید صدا گامی اختیاری با صفحهٔ جدا باشد و دیگر بالای جزوه نیاید.
3. `/sources` نشانی اصلی صفحهٔ «مطالب و وضعیت جلسه» باشد.

## ۸. پرسش‌ها برای مالک محصول

1. متن‌های تازهٔ فهرست انتظار (`sessionNavigation.*`) را تأیید یا اصلاح می‌کنید؟
2. کارت «Next step»، کارت گام صدا، صفحهٔ `/sessions/[id]/voice` و کارت آخرین جلسه در Today قاب Figma ندارند. همه از کامپوننت‌های موجود ساخته شده‌اند. آیا یک دور طراحی Figma برای حالت‌های جلسه لازم است؟
3. عنوان صفحهٔ واحد «Session material» ماند. نام دیگری مثل «Session material and progress» می‌خواهید؟ این نام متن تازه است.
4. در Today، کارت گام بعد فقط برای آخرین جلسه نمایش داده می‌شود. برای جلسه‌های دیگرِ در جریان هم لازم است؟
5. برای مرحلهٔ «Finishing your notes» نمایش درصد یا شمارش منبع‌های بررسی‌شده لازم است؟ این کار ثبت پیشرفت در سرور را می‌خواهد.
6. در جلسهٔ خالی دو دکمهٔ پررنگ دیده می‌شود: «Add or view material» در کارت گام بعد، و «Record a session» در بخش مصوب «Session material» پایین صفحه (`session-empty-390.png`). بخش مصوب دست نخورده است. ترجیح شما کدام است: اقدام اصلی کارت در جلسهٔ خالی «Record a session» باشد و بخش پایین فقط توضیح بدهد، یا همین وضع بماند؟
