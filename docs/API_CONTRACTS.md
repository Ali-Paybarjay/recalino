# قرارداد API — ریکالینو (Recalino)

> **وضعیت:** نسخه ۰٫۱ — همراه M1 (2026-10-01)  
> **مبنا:** [FR ماژول PLT](fr/PLT.md) · پیاده‌سازی: `packages/core/src/plt/errors.ts` و `apps/web/src/server/api.ts`

> **افزونهٔ D41، 2026-10-05:** قرارداد gatewayهای admin و support زیر بر اساس پیاده‌سازی جاری ثبت شده است؛ این سند به‌تنهایی انتشار production یا آماده‌بودن ایمیل واقعی را اعلام نمی‌کند.

همه مسیرهای API از wrapper مشترک `defineRoute` عبور می‌کنند و در `apps/web/src/server/routes.ts` ثبت می‌شوند. مسیر ثبت‌نشده یا مسیر کاربری بدون آزمون بین‌حسابی، آزمون پوشش را می‌شکند (FR-PLT-002، NFR-01).

## پاکت خطا (FR-PLT-003)

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Some information is missing or not valid.",
    "details": { "fields": { "title": ["too_big"] } },
    "request_id": "6f1c2a0e-3b9d-4c55-9a51-2b0e7d8f4c11"
  }
}
```

- `code` پایدار و ماشینی است. `message` جمله‌ای ساده و انگلیسی برای نمایش است. صفحه‌ها می‌توانند متن خودشان را برای هر کد نشان دهند.
- `details` اختیاری است. برای `validation_failed` شامل کد مشکل هر فیلد است، هرگز مقدار ورودی.
- خطای پیش‌بینی‌نشده فقط `internal` و `request_id` برمی‌گرداند. stack، SQL، مسیر داخلی، URL امضاشده و محتوای کلاس هرگز در پاسخ نمی‌آیند.

| `code` | HTTP | کاربرد |
|---|---|---|
| `unauthenticated` | 401 | نشست معتبر نیست |
| `not_found` | 404 | منبع وجود ندارد **یا** متعلق به کاربر دیگری است؛ دو حالت یکسان پاسخ می‌گیرند |
| `validation_failed` | 400 | ورودی نامعتبر، JSON خراب یا کلید idempotency جاافتاده |
| `conflict` | 409 | وضعیت ناسازگار، مثلاً درخواست هم‌زمانی که هنوز تمام نشده |
| `idempotency_mismatch` | 422 | همان کلید idempotency با بدنه یا مسیر دیگر |
| `rate_limited` | 429 | عبور از کنترل نرخ؛ همراه `Retry-After` |
| `quota_insufficient` | 403 | سهمیه کافی نیست (QUOTA) |
| `cross_site` | 403 | درخواست تغییردهنده از سایت دیگری آمده است؛ نشست با cookie است و این مرز جلوی جعل درخواست را می‌گیرد (M3) |
| `payload_too_large` | 413 | فایل یا بدنه بزرگ‌تر از سقف |
| `unsupported_media` | 415 | نوع فایل پشتیبانی نمی‌شود |
| `internal` | 500 | خطای پیش‌بینی‌نشده |

## سرآیندها

| سرآیند | جهت | معنی |
|---|---|---|
| `x-request-id` | پاسخ | شناسه یکتای هر درخواست؛ همان `request_id` پاکت خطا و لاگ |
| `Idempotency-Key` | درخواست | الزامی برای ساخت منبع، مصرف سهمیه و آغاز کار AI؛ ۸ تا ۲۰۰ نویسه از `A-Z a-z 0-9 _ . : -`. در محدوده همان کاربر معتبر است و ۲۴ ساعت نگه داشته می‌شود (قابل پیکربندی) |
| `idempotent-replayed` | پاسخ | `true` وقتی پاسخ، تکرار پاسخ نخست همان کلید است |
| `Retry-After` | پاسخ | ثانیه‌های لازم پیش از تلاش دوباره، همراه `rate_limited` |

## مسیرها

| شناسه | مسیر | دسترسی | idempotency | کنترل نرخ |
|---|---|---|---|---|
| `health` | `GET /api/health` | عمومی | — | — |
| `admin` | `GET /api/admin` | مالک معتبر سمت سرور | — | قاعدهٔ جدا در route جاری ندارد |
| `admin` | `POST /api/admin` | مالک معتبر سمت سرور | کلید و receipt دامنهٔ OPS | قاعدهٔ جدا در route جاری ندارد |
| `supportFeedback` | `GET /api/support` | زبان‌آموز؛ فقط پیام‌های خودش | — | `support` |
| `supportFeedback` | `POST /api/support` | زبان‌آموز | کلید در handler/domain | `support` |
| `supportThread` | `GET /api/support/[id]` | زبان‌آموز؛ فقط گفتگوی خودش | — | `support` |
| `supportThread` | `POST /api/support/[id]` | زبان‌آموز؛ فقط گفتگوی خودش | کلید در handler/domain | `support` |

## gateway مالک — `/api/admin`

مرجع: `apps/web/src/server/admin-routes.ts`، `auth/admin.ts` و `packages/core/src/ops/admin-contracts.ts`. هر GET/POST از نشست Supabase Auth و عضویت فعال `plt.admin_owner` می‌گذرد. بدون نشست `401 unauthenticated` و برای حساب غیرمالک `404 not_found` است؛ وجود پروفایل یادگیری شرط مالک نیست. پاسخ، خطا و موفقیت `Cache-Control: private, no-store` دارند. POST باید JSON و same-origin باشد؛ هویت مالک هرگز از payload گرفته نمی‌شود.

### GET

`view` یکی از جدول زیر است و در نبود آن `overview` خوانده می‌شود. `userId` و `threadId`، اگر آمده باشند، UUID معتبرند؛ `user` به userId و `thread` به threadId نیاز دارد. `search` حداکثر ۲۰۰ نویسه و `cursor` token opaque حداکثر ۵۰۰ نویسه است؛ cursor خراب `validation_failed` می‌گیرد.

| view | فیلدهای پاسخ 200، علاوه بر `view` |
|---|---|
| `overview` | `pilot`، `counts`، `tasks`، `audit` و `costs` در صورت وجود policy |
| `tasks` | `tasks`؛ با userId اختیاری محدود به همان حساب |
| `users` | `users` و `nextCursor` (token یا null)؛ جستجوی نام/ایمیل از directory معتبر Auth، صفحهٔ ۵۰تایی |
| `user` | `user`، `quota`، `emails` و `pilot` |
| `pilot` | `pilot` با ظرفیت، پذیرش تاریخی، فعال‌ها، پنج پیش‌تنظیم و دوره |
| `costs` | `costs` در صورت وجود policy؛ هزینهٔ واقعی/برآورد/تعهد/نامعلوم جدا، USD و سقف‌های جاری |
| `rates` | `rates`؛ `rateVersion` فقط با revision ثبت‌شده |
| `processing` | `runs` با state، stage، model، کد خطا و retryAllowed؛ title خصوصی null است |
| `feedback` | `threads` با مشخصات حساب و metadata ارتباط |
| `thread` | `thread` با پیام‌های ارتباط پشتیبانی و replyDraft پنهان برای زبان‌آموز |
| `templates` | `templates` فارسی/انگلیسی و نسخه‌دار |
| `history` | `emails` شامل تماس/موضوع/وضعیت/کد خطا؛ بدون body یا metadata تأمین‌کننده |
| `privacy` | `privacy` شامل شناسه، نوع، وضعیت، زمان و کد خطا |
| `backups` | `backups` شامل وضعیت، createdAt، verifiedAt و restoreDrillAt؛ بدون key یا فایل |
| `audit` | `audit` شامل action، actorId، دلیل، شناسهٔ subject و زمان |
| `settings` | `settings`: language، theme و وضعیت/هویت امن فرستنده، appLink، aiConfigured؛ بدون کلید |

`quota` برای هر پنج بُعد، `allocated`، `consumed`، `reserved`، `available`، `entitlementId` و `startsAt`/`endsAt` دارد؛ حساب بدون entitlement واقعی مقدار صفر و تاریخ null می‌گیرد. نبود cost policy یا rate revision با فیلد غایب/آرایهٔ خالی نشان داده می‌شود، نه بودجه یا نرخ ساختگی. خواندن عملیاتی از projectionهای خصوصی OPS است و متن کلاس، transcript، units/blocks، storage key یا credential در DTO نیست. metadata تماس حساب tombstoned فوراً پنهان می‌شود.

### POST

بدنهٔ envelope دقیقاً `{ "action": "...", "input": { ... } }` است. `Idempotency-Key` ۸ تا ۱۲۸ نویسه لازم است؛ UUID انتخاب مناسبی است. کل envelope پیش از عملیات در receipt پایدار مالک ثبت می‌شود؛ همان کلید با action یا input متفاوت `422 idempotency_mismatch` است. برای تکرار پس از قطع شبکه، همان کلید و بدنه حفظ شوند. این receiptهای دامنه از TTL عمومی wrapper مستقل‌اند؛ این مسیر header عمومی `idempotent-replayed` را تضمین نمی‌کند.

در جدول، `reason` مگر آنجا که اختیاری اعلام شده، متن trim‌شدهٔ ۱ تا ۵۰۰ نویسه است. `amounts` حتماً هر پنج کلید `audio/document/regeneration/tts/storage` را با عدد صحیح نامنفی تا `Number.MAX_SAFE_INTEGER` دارد؛ واحدها در [QUOTA](fr/QUOTA.md) تعریف شده‌اند. شناسه‌های کاربر، entitlement، thread، run و draft از نوع UUID هستند. datetimeها ISO معتبر با UTC هستند.

| action | input | پاسخ موفق |
|---|---|---|
| `pilot.configure` | `capacity` عدد صحیح نامنفی ایمن، `reason` | 200 `{ok:true}`؛ revision تازه، بدون اعطای سهمیه |
| `pilot.grant` | `userId`، `amounts`، `startsAt`، `periodDays` عدد صحیح مثبت ایمن، `reason` | 200 `{ok:true, entitlementId}`؛ پایان از شروع + روزها، پذیرش زیر قفل ظرفیت |
| `quota.set` | `userId`، `entitlementId`، `amounts` (کل تخصیص)، `reason` | 200 `{ok:true, before, after, replayed}`؛ snapshotهای تخصیص با مصرف/رزرو محفوظ |
| `quota.close` | `userId`، `entitlementId`، `reason` | 200 `{ok:true}` |
| `pricing.save` | `rates`، `reason` | 200 `{ok:true, version, rates}`؛ revision immutable |
| `cost.configure` | `limits:{session,userMonth,systemDay,systemMonth}` با micros صحیح مثبت ایمن، `killSwitch` boolean، `reason` | 200 `{ok:true}`؛ USD، نسخه از operation key |
| `email.preview` | `userIds` آرایهٔ ۱ تا ۱۰۰۰ UUID، `templateId` شناسهٔ قالب یا null، `language` یکی از `en/fa/recipient`، `subject` (۱..۳۰۰)، `body` (۱..۲۰۰۰۰)، `localizedContent?` با متن en/fa، `localizedVariables?` با متغیرهای دستی en/fa، `presentation?`، `localizedPresentation?`، `reason?` | 200 `{preview}`؛ previewId، expiresAt، recipients با snapshot نهایی و excluded با دلیل |
| `email.send` | `previewId` به‌شکل `draftUUID:revision`، `draftId?` و `revision?` اگر آمده‌اند باید مطابق preview باشند | 202 `{ok:true, emails}`؛ تأیید همان snapshot و ثبت outbox، بدون ادعای delivery |
| `email.retry` | `emailId?` یا alias `id?` (حداقل یکی)، `reason?` | 202 `{ok:true, emails:[...]}`؛ فقط failed قطعی |
| `template.save` | `templateId`، `expectedVersion`، `subject:{en,fa}`، `body:{en,fa}`، `presentation?:{en?,fa?}`، `reason` | 200 `{ok:true}`؛ تضاد نسخه 409 |
| `feedback.suggest` | `threadId`، `language` یکی از en/fa | 200 `{body, source:"template"}`؛ draft آماده، بدون انتشار/ارسال یا تماس AI |
| `feedback.preview` | `threadId`، `body` (۱..۱۰۰۰۰)، `language` en/fa، `notifyByEmail` boolean، `presentation?` | 200 `{replyPreview}`؛ draftId، revision و snapshot ایمیل، بدون انتشار یا صف ارسال |
| `feedback.reply` | `threadId`، `draftId`، `revision`، `notifyByEmail` boolean، `close?` (پیش‌فرض false) | 200 `{ok:true}`؛ تأیید همان پیش‌نویس ذخیره‌شده و در صورت مجازبودن صف اعلان؛ تغییر آدرس گیرنده 409 |
| `feedback.close` | `threadId`، `closed?` (پیش‌فرض true)، `reason?` | 200 `{ok:true}`؛ closed یا awaiting_reply |
| `job.retry` | `runId`، `reason?` | 202 `{ok:true}`؛ state، source و outcome هنگام mutation دوباره بررسی می‌شوند |
| `task.update` | `taskId` (۱..۳۰۰)، `state` یکی از open/dismissed/snoozed، `snoozedUntil?` آینده و الزامی برای snoozed، `reason` | 200 `{ok:true}` |
| `settings.save` | `language` en/fa، `theme` یکی از system/light/dark | 200 `{ok:true}`؛ ترجیح مالک پایدار |

هر rate حاوی `id`، `stage` (`generation/vision/transcription/tts/support`)، `model`، `unit` (`input_million_tokens/output_million_tokens/audio_minute/page/tts_thousand_characters`) و `rateMicros` صحیح نامنفی ایمن است. حداکثر ۱۰۰ نرخ و یکتایی stage/model/unit لازم است؛ ترکیب مبنای غیرتوکنی با چند واحد یک مدل/مرحله مبهم و نامعتبر است. نرخ برآورد فقط forecast هزینه است؛ policy و hard hold را عوض نمی‌کند.

شناسه‌های template در [SUPPORT](fr/SUPPORT.md) آمده‌اند. در `email.preview`، `localizedContent` و `localizedVariables` می‌توانند فقط `en` یا `fa` ویرایش‌شده را داشته باشند. نسخهٔ نیامده از قالب ذخیره‌شده و سپس متن پایهٔ درخواست حل می‌شود؛ صحت نهایی متغیرها و ظاهر برای زبان هر گیرندهٔ معتبر بررسی می‌شود. account یا ایمیل ناموجود در excluded می‌آید و اگر هیچ گیرنده‌ای معتبر نماند درخواست رد می‌شود. preview تأییدنشده پس از ۳۰ دقیقه expired است؛ placeholder حل‌نشده و app_link بدون تنظیم رد می‌شوند. replay همان کلید، draft ذخیره‌شدهٔ اولیه را پیش از اعتبارسنجی قالب جدید بازمی‌گرداند. `email.send` receipt تأیید/outbox است و ارسال خارجی بعد از commit اجرا می‌شود؛ نبود پیکربندی، پیام را queued نگه می‌دارد.

`localizedVariables` نگاشت `{en?:{key:value},fa?:{key:value}}` است؛ کلیدها مطابق `^[a-z_][a-z0-9_]*$` و مقدارها حداکثر ۴۰۰۰ نویسه‌اند. DTO قالب `variableDefaults?` محلی‌سازی‌شده را برای متن‌های پیشنهادی معمولی دارد؛ مقدار غیرخالی مدیر بر این پیش‌فرض‌ها مقدم است. مقدار واقعی پاسخ، شرح مشکل و متغیر ناشناخته پیش‌فرض ساختگی ندارند و خطای دقیق مانند `localizedVariables.fa.issue_summary` می‌گیرند. هویت گیرنده، لینک اپ/گفتگو و تاریخ/خلاصهٔ سهمیه از سرور می‌آیند و ورودی دستی نمی‌تواند آن‌ها را جایگزین کند. snapshot نهایی پیش از تأیید ثابت می‌شود. receipt عملیات send/retry فقط شناسه‌های outbox را نگه می‌دارد؛ پاسخ `emails` از نمای metadata زنده خوانده می‌شود و حساب tombstone‌شده در replay نیز پنهان می‌ماند.

`sent` پذیرش provider است؛ webhook delivery/bounce در این نسخه وجود ندارد. `unknown` قابل retry عمومی نیست و به reconcile دستی مبتنی بر شواهد با API داخلی `reconcileEmail` نیاز دارد. action عمومی `email.reconcile`، restore یا مشاهدهٔ فایل/متن کلاس در این gateway وجود ندارد.

## gateway زبان‌آموز — `/api/support` و `/api/support/[id]`

مرجع: `apps/web/src/server/support-routes.ts` و `packages/core/src/support/contracts.ts`/`feedback.ts`. نشست معتبر و حساب فعال لازم‌اند؛ همهٔ پاسخ‌ها `private, no-store` و POSTها same-origin هستند. کنترل نرخ `support` به هر دو GET/POST اعمال می‌شود؛ پیش‌تنظیم جاری ۲۰ درخواست در ۶۰ ثانیه برای هر user و قابل پیکربندی است. بدنه envelope admin ندارد. Idempotency-Key برای POST، ۸ تا ۱۲۸ نویسه است و domain آن را به operationKey تبدیل می‌کند.

| مسیر | درخواست | پاسخ |
|---|---|---|
| `GET /api/support` | بدون body | 200 آرایهٔ FeedbackSummary متعلق به خود کاربر، آخرین ۲۰۰ مورد به ترتیب updatedAt نزولی |
| `POST /api/support` | `category` یکی از question/problem/suggestion/other، `subject` trim‌شده ۱..۲۰۰، `body` ۱..۱۰۰۰۰، `emailNotification` boolean، `context?` با `appVersion?` حداکثر ۸۰ و `screen?` حداکثر ۱۲۰ | 201 FeedbackThread با پیام اولیه؛ تکرار دقیق نیز همان گفتگو را می‌دهد |
| `GET /api/support/[id]` | UUID گفتگو در path | 200 FeedbackThread؛ فقط مالک گفتگو، خواندن unread را پاک می‌کند |
| `POST /api/support/[id]` | `body` trim‌شده ۱..۱۰۰۰۰ و `emailNotification?` boolean | 201 FeedbackThread پس از پیام پیگیری؛ state به awaiting_reply برمی‌گردد |

FeedbackSummary فیلدهای `id,userId,category,subject,status,emailNotification,createdAt,updatedAt,unread` دارد. FeedbackThread علاوه بر آن `messages` و context یا null دارد؛ هر message دارای `id,author` (learner/admin)، `body,createdAt` است. draft ادمین در پاسخ زبان‌آموز نیست. گفتگوی دیگری یا حساب حذف‌شده `404 not_found` می‌گیرد؛ کلید تکراری با متن متفاوت `422 idempotency_mismatch` است. این مسیرها خودشان ایمیل خودکار تشکر یا پاسخ منتشر نمی‌کنند.
