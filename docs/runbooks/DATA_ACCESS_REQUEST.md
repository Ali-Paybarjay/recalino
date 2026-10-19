# پاسخ به درخواست دسترسی و حمل داده

> **تاریخ:** 2026-10-19 · **مالک:** مالک محصول (اپراتور پایلوت) · **یافته:** SEC-08 [ممیزی 2026-10-18](../audit/2026-10-18-project-audit.md)
> **مبنا:** [اطلاعیهٔ حریم خصوصی](../legal/privacy-notice.md) بخش ۱۱ (پیش‌نویس ۰٫۳): «give you a copy of your data»، «give you your data in a form that you can move to another service» و «We will answer within one month.» این رویه وعدهٔ تازه‌ای اضافه نمی‌کند و فقط با قابلیت‌های موجود اپ و دسترسی فقط‌خواندنی دیتابیس اجرا می‌شود.

## دامنه

- **خودسرویس موجود:** زبان‌آموز برای هر جلسه «Download notes and cards» (جزوهٔ HTML و بستهٔ Anki) را دارد و تصویر یا PDF اصلی هر منبع را از نمای منبع («Open original image»، «Open original PDF page») باز می‌کند. ضبط‌های کلاس روی دستگاه خود اوست و صوت سرور طبق D29 حداکثر ۲۴ ساعت پس از رونویسی حذف می‌شود.
- **آنچه خودسرویس ندارد:** اطلاعات حساب و ورود، رضایت‌ها، پروفایل یادگیری، تاریخچهٔ مرور، سهمیه، صدا، پیام‌های پشتیبانی و سوابق پردازش. این‌ها را اپراتور با همین رویه، به‌صورت یک فایل JSON، تحویل می‌دهد.
- **خروجی خودسرویس کامل** بیرون از این رویه است و ساختنش تصمیم نسخه‌دار جدا می‌خواهد.

## ۱. دریافت و ثبت

- درخواست از دو راه می‌رسد: پیام در `/help` (زبان‌آموز وارد حساب است)، یا ایمیل به نشانی اپراتور (`{{operator_email}}` در متن حقوقی، `PILOT_OPERATOR_EMAIL`).
- همان روز در گفتگوی `/help` آن زبان‌آموز (یا پاسخ ایمیل) بنویسید که درخواست رسید. تاریخ دریافت را یادداشت کنید؛ **مهلت پاسخ یک ماه تقویمی از همان تاریخ است.** یادآور تقویم بگذارید.
- در گفتگو، لاگ، چت با Claude یا مخزن، محتوای داده را ننویسید؛ فقط تاریخ‌ها و وضعیت.

## ۲. تأیید هویت

- **از `/help`:** هویت همان حساب واردشده است.
- **از ایمیل:** نشانی فرستنده باید دقیقاً همان نشانی ورود Google حساب باشد (گام ۳). اگر نیست، پاسخ ندهید جز اینکه از زبان‌آموز بخواهید درخواست را از `/help` یا از همان نشانی ورود بفرستد. مدرک شناسایی تازه نخواهید.
- پاسخ و فایل فقط به نشانی ورود همان حساب می‌رود، نه به نشانی دیگری که در متن پیام آمده است.

## ۳. پیدا کردن شناسهٔ حساب (فقط `select`)

در داشبورد Supabase پروژهٔ `recalino` (ref `twowhuzhvyuzjrpraikm`)، **SQL Editor**:

```sql
select id, email, created_at, last_sign_in_at
from auth.users
where lower(email) = lower('<SIGN_IN_EMAIL>');
```

باید دقیقاً یک ردیف برگردد. `id` همان `<USER_ID>` گام ۴ است.

## ۴. گردآوری داده (فقط `select`)

- کوئری زیر را **در SQL Editor داشبورد** اجرا کنید، نه از راه کانکتور Claude: نتیجه دادهٔ شخصی است و نباید در گفتگوی Claude بنشیند.
- `<USER_ID>` را یک بار جایگزین کنید. همهٔ بخش‌ها `select` هستند و هر کدام فقط ردیف‌های همان حساب را با فیلتر مالکیت (`user_id`، `owner_id`، `owner_user_id`، `consumed_by`، یا رشتهٔ پشتیبانی همان حساب) برمی‌دارند.
- خروجی برای هر جدول یک ردیف است (`source`، `rows`)؛ نتیجه را با **Export ← Download CSV** (یا Copy as JSON در یک فایل) ذخیره کنید و نام فایل را `recalino-data-<تاریخ>.json` یا `.csv` بگذارید.
- کوئری در 2026-10-19 روی Postgres 16 با جدول‌های نمونه اجرا شد: ۶۴ ردیف، ردیف حساب دیگر بیرون ماند، و `encrypted_password`، endpoint و کلیدهای Push بیرون ماندند. نام جدول و ستون‌ها از `packages/core/src/db/types.ts` آمده است؛ با migration تازه‌ای که جدول دارای `user_id` یا `owner_id` می‌سازد، همین فهرست به‌روز شود.

```sql
-- SEC-08 data access export. Read-only: every statement is a select.
-- Replace <USER_ID> (from step 3) once; run in the Supabase SQL Editor, not through Claude.
with u as (select '<USER_ID>'::text as id)
-- Account
select 'acc.user_account' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from acc.user_account t where t.id::text = (select id from u)
union all
select 'acc.signup_intent' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from acc.signup_intent t where t.consumed_by::text = (select id from u)
union all
select 'acc.consent' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from acc.consent t where t.user_id::text = (select id from u)
union all
select 'acc.learning_profile' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from acc.learning_profile t where t.user_id::text = (select id from u)
union all
select 'acc.learning_profile_history' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from acc.learning_profile_history t where t.user_id::text = (select id from u)
union all
select 'acc.preference' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from acc.preference t where t.user_id::text = (select id from u)
union all
-- Courses and sessions
select 'org.course' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from org.course t where t.owner_id::text = (select id from u)
union all
select 'org.unit' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from org.unit t where t.owner_id::text = (select id from u)
union all
select 'org.class_session' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from org.class_session t where t.owner_id::text = (select id from u)
union all
select 'org.deletion_request' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from org.deletion_request t where t.owner_id::text = (select id from u)
union all
select 'org.outbox' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from org.outbox t where t.owner_id::text = (select id from u)
union all
-- Material
select 'src.asset' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from src.asset t where t.user_id::text = (select id from u)
union all
select 'src.content_version' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from src.content_version t where t.user_id::text = (select id from u)
union all
select 'src.session_source' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from src.session_source t where t.user_id::text = (select id from u)
union all
select 'src.source_snapshot' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from src.source_snapshot t where t.user_id::text = (select id from u)
union all
select 'src.notice_acceptance' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from src.notice_acceptance t where t.user_id::text = (select id from u)
union all
select 'src.upload_session' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from src.upload_session t where t.user_id::text = (select id from u)
union all
select 'src.audio_upload' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from src.audio_upload t where t.user_id::text = (select id from u)
union all
select 'src.outbox' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from src.outbox t where t.user_id::text = (select id from u)
union all
-- Notes and cards
select 'lkm.knowledge_version' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from lkm.knowledge_version t where t.user_id::text = (select id from u)
union all
select 'note.notebook' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from note.notebook t where t.user_id::text = (select id from u)
union all
select 'note.revision' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from note.revision t where t.user_id::text = (select id from u)
union all
select 'note.outbox' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from note.outbox t where t.user_id::text = (select id from u)
union all
select 'card.learning_item' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from card.learning_item t where t.user_id::text = (select id from u)
union all
select 'card.card' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from card.card t where t.user_id::text = (select id from u)
union all
select 'card.proposal' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from card.proposal t where t.user_id::text = (select id from u)
union all
select 'card.revision' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from card.revision t where t.user_id::text = (select id from u)
union all
select 'card.session_link' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from card.session_link t where t.user_id::text = (select id from u)
union all
select 'pers.item_feedback' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from pers.item_feedback t where t.user_id::text = (select id from u)
union all
-- Review
select 'srs.settings' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from srs.settings t where t.user_id::text = (select id from u)
union all
select 'srs.card_state' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from srs.card_state t where t.user_id::text = (select id from u)
union all
select 'srs.review_event' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from srs.review_event t where t.user_id::text = (select id from u)
union all
select 'srs.review_undo' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from srs.review_undo t where t.user_id::text = (select id from u)
union all
-- Media and exports
select 'media.asset' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from media.asset t where t.user_id::text = (select id from u)
union all
select 'anki.export_artifact' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from anki.export_artifact t where t.user_id::text = (select id from u)
union all
select 'html.export_artifact' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from html.export_artifact t where t.user_id::text = (select id from u)
union all
select 'plt.storage_object' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from plt.storage_object t where t.owner_user_id::text = (select id from u)
union all
-- Processing
select 'proc.processing_run' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from proc.processing_run t where t.user_id::text = (select id from u)
union all
select 'proc.automatic_session' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from proc.automatic_session t where t.user_id::text = (select id from u)
union all
select 'proc.provider_attempt' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from proc.provider_attempt t where t.user_id::text = (select id from u)
union all
select 'proc.foreground_gap' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from proc.foreground_gap t where t.user_id::text = (select id from u)
union all
select 'proc.temporary_object' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from proc.temporary_object t where t.user_id::text = (select id from u)
union all
-- Allowance
select 'quota.entitlement' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from quota.entitlement t where t.user_id::text = (select id from u)
union all
select 'quota.ledger' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from quota.ledger t where t.user_id::text = (select id from u)
union all
select 'quota.reservation' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from quota.reservation t where t.user_id::text = (select id from u)
union all
select 'quota.cost_hold' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from quota.cost_hold t where t.user_id::text = (select id from u)
union all
select 'quota.provider_cost' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from quota.provider_cost t where t.user_id::text = (select id from u)
union all
select 'quota.allocation_change' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from quota.allocation_change t where t.user_id::text = (select id from u)
union all
-- Voice
select 'voc.profile' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from voc.profile t where t.user_id::text = (select id from u)
union all
select 'voc.analysis' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from voc.analysis t where t.user_id::text = (select id from u)
union all
select 'voc.enrollment_request' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from voc.enrollment_request t where t.user_id::text = (select id from u)
union all
select 'voc.feedback' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from voc.feedback t where t.user_id::text = (select id from u)
union all
select 'voc.sample_object' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from voc.sample_object t where t.user_id::text = (select id from u)
union all
-- Support
select 'support.thread' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from support.thread t where t.user_id::text = (select id from u)
union all
select 'support.email_outbox' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from support.email_outbox t where t.user_id::text = (select id from u)
union all
-- Platform and privacy
select 'plt.notification' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from plt.notification t where t.user_id::text = (select id from u)
union all
select 'plt.idempotency_key' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from plt.idempotency_key t where t.user_id::text = (select id from u)
union all
select 'plt.security_event' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from plt.security_event t where t.user_id::text = (select id from u)
union all
select 'priv.deletion_request' as source, coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows
  from priv.deletion_request t where t.user_id::text = (select id from u)
union all
-- Messages and replies in the learner's own support threads
select 'support.message', coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  from support.message t
  where t.thread_id in (select id from support.thread where user_id::text = (select id from u))
union all
-- Push subscriptions: dates only; the browser's endpoint and keys stay out
select 'plt.push_subscription', coalesce(jsonb_agg(to_jsonb(t) - 'endpoint' - 'p256dh' - 'auth'), '[]'::jsonb)
  from plt.push_subscription t where t.user_id::text = (select id from u)
union all
-- Records of what the account did, or what was done to it
select 'plt.audit_event', coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  from plt.audit_event t
  where t.actor_id = (select id from u) or t.subject_id = (select id from u)
union all
-- Sign-in details kept by Supabase Auth (from Google)
select 'auth.users', coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'email', t.email, 'created_at', t.created_at,
    'last_sign_in_at', t.last_sign_in_at, 'user_metadata', t.raw_user_meta_data)), '[]'::jsonb)
  from auth.users t where t.id::text = (select id from u)
union all
select 'auth.identities', coalesce(jsonb_agg(jsonb_build_object(
    'provider', t.provider, 'identity_data', t.identity_data,
    'created_at', t.created_at, 'last_sign_in_at', t.last_sign_in_at)), '[]'::jsonb)
  from auth.identities t where t.user_id::text = (select id from u);
```

### جدول‌هایی که عمداً بیرون‌اند

| جدول | چرا |
|---|---|
| نماهای `ops.admin_*` | از جدول‌های بالا ساخته شده‌اند و دادهٔ تازه‌ای ندارند |
| `ops.admin_preference`، `ops.admin_operation`، `ops.admin_request`، `ops.task_preference`، `support.activity`، `support.email_draft`، `support.reply_draft`، `support.template_revision`، `quota.pilot_revision`، `aip.estimate_rate_revision` | سوابق و پیش‌نویس‌های اپراتور (`actor_id` اپراتور است). پیامی که واقعاً فرستاده شده در `support.message` و `support.email_outbox` هست |
| `src.upload_part`، `src.audio_upload_part`، `proc.run_step`، `priv.cleanup_step`، `plt.push_delivery`، `plt.job`، `plt.job_step` | جزئیات فنی قطعه‌ها، گام‌ها و صف بدون محتوای تازه؛ ردیف اصلی هر کدام در فهرست بالاست |
| `ops.database_backup`، `ops.deletion_journal` | پشتیبان و سابقهٔ رمزشدهٔ حذف، بدون محتوای خواندنی برای یک حساب |

## ۵. فایل‌ها

- محتوای جزوه، کارت‌ها، متن منابع (`src.content_version.blocks`) و تاریخچه در خروجی گام ۴ هست. فایل‌های اصلی (تصویر، PDF، خروجی‌ها) در Blob خصوصی‌اند و فهرستشان در ردیف `plt.storage_object` می‌آید.
- از زبان‌آموز بخواهید پیش از هر چیز برای هر جلسه «Download notes and cards» را بزند و تصویر یا PDF اصلی را از نمای منبع باز کند؛ متن رابط هم همین را می‌گوید: «To keep a copy first, open a session, choose More session tools, then Download notes and cards.»
- در مخزن ابزار اپراتوری برای دانلود فایل‌های Blob یک حساب نیست و پنل مالک هم چنین دانلودی ندارد. اگر زبان‌آموز به اپ دسترسی ندارد و فایل اصلی را می‌خواهد، پیش از پایان مهلت تصمیم مالک محصول لازم است.

## ۶. تحویل

- فایل را به پاسخ ایمیل از نشانی اپراتور به **نشانی ورود همان حساب** پیوست کنید. در گفتگوی `/help` فقط بنویسید که نسخه فرستاده شد (بدون محتوا).
- در پاسخ بگویید فایل چه چیزهایی دارد (فهرست `source`ها)، که جزوه و کارت‌ها با «Download notes and cards» به شکل قابل‌استفاده در Anki هم در دسترس‌اند، و که ضبط‌ها روی دستگاه خود اوست.
- پس از ارسال، فایل CSV/JSON را از کامپیوتر اپراتور حذف کنید (از سطل بازیافت هم). در گفتگوی `/help` تاریخ ارسال را ثبت کنید.

## ۷. پیگیری مهلت

| روز | کار |
|---|---|
| ۰ | ثبت دریافت و تاریخ (گام ۱) |
| تا روز ۷ | تأیید هویت (گام ۲) |
| تا روز ۲۱ | گردآوری و ارسال (گام‌های ۳ تا ۶) |
| روز ۳۰ | آخرین روز پاسخ. اگر کاری مانده، پیش از این روز به زبان‌آموز وضعیت را بگویید |

## محدودیت‌ها

- مدت نگهداری `plt.security_event` و `plt.audit_event` هنوز تعیین نشده است (SEC-07، منتظر تصمیم و migration).
- این رویه دستی است و برای پایلوت هشت‌نفره است؛ خروجی خودسرویس با تصمیم جدا ساخته می‌شود.
- Claude در این رویه فقط می‌تواند شمار ردیف‌ها یا وجود حساب را بررسی کند؛ اجرای کوئری کامل و دیدن محتوا با خود اپراتور است.
