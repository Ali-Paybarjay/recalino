# پشتیبان‌گیری و تمرین بازیابی

مطابق [ADR-0001](../adr/0001-stack-and-hosting.md)، پشتیبان منطقی روزانه باید در Blob خصوصی موجود و حداکثر ۳۰ روز نگهداری شود؛ استثنای «سه نسخهٔ آخر» در بخش [نگهداری و هشدار کهنگی](#نگهداری-و-هشدار-کهنگی) آمده و مالک محصول آن را در 2026-10-19 تأیید کرد ([D85](../PRODUCT_DECISIONS_LOG.md)). مسیر اجرایی `packages/ops-cli/src/backup.ts` از `pg_dump` واقعی استفاده می‌کند؛ باینری PostgreSQL روی Vercel موجود فرض نمی‌شود. سرویس پولی یا میزبان تازه‌ای لازم نیست: ابزار native نصب‌شده یا PostgreSQL داخل Docker موجودِ میزبان مورد اعتماد اپراتور کافی است.

پشتیبان یک archive سازگار PostgreSQL است: ساختار، داده، constraintها، sequenceها، شناسه‌های Auth و سابقهٔ migration. فقط دادهٔ پایدار `auth.users`، `auth.identities` و `auth.schema_migrations` در Auth می‌ماند؛ session، refresh token، جریان‌های یک‌بارمصرف و دادهٔ موقت سایر جدول‌های Auth وارد پشتیبان نمی‌شوند. رمز نقش دیتابیس و کلیدهای محیطی در archive نیستند. حساب پایلوت با Google وارد می‌شود؛ پس از بازیابی ورود دوباره لازم است. تنظیم Google، کلیدهای میزبان و رمز جدید نقش اختصاصی اپ باید جداگانه بازسازی شوند.

خروجی `pg_dump` بلافاصله با AES-256-GCM رمزگذاری می‌شود. فایل plaintext روی دیسک ساخته نمی‌شود، و native stderr و SQL چاپ نمی‌شوند. هدرِ نسخه، نوع archive و key ID نیز احراز اصالت می‌شود. هدف این است که کلید ۳۲‌بایتی جدا از Blob نگهداری شود، ولی وضعیت فعلی چنین نیست: کلید در Vercel production کنار توکن Blob هم هست (بخش [محل کلید و مدل تهدید](#محل-کلید-و-مدل-تهدید))؛ هنگام تعویض کلید، کلیدهای قدیمی تا پایان عمر پشتیبان‌ها و سابقه‌های حذفِ مربوط باقی بمانند. رمزگذاری، سقف بایت و timeout قابل آزمون‌اند و نبود پیکربندی عملیات را متوقف می‌کند.

پیکربندی اپراتور در یک فایل خصوصیِ خارج از Git:

```dotenv
DATABASE_URL=<connection for private backup manifest>
BACKUP_DATABASE_URL=<explicit direct or session-pooler administrative connection>
RECALINO_BACKUP_KEY_BASE64=<canonical base64 encoding of exactly 32 random bytes>
RECALINO_BACKUP_KEY_ID=<key identifier>
RECALINO_BACKUP_SETTINGS_JSON={"version":"1","keyId":"<same key identifier>","maxEncryptedBytes":<explicit operational byte bound>,"timeoutSeconds":<explicit bound>}
RECALINO_BACKUP_TOOLS_JSON={"mode":"docker","container":"supabase_db_recalino"}
LOCAL_RESTORE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
BLOB_READ_WRITE_TOKEN=<credential for the existing private Blob store>
```

اعداد نمونه ظرفیت تجاری نیستند. `maxEncryptedBytes` و timeout باید برای حجم واقعی پروژه تنظیم شوند. برای ابزار native، JSON آخر به `{ "mode": "native", "dumpPath": "<absolute pg_dump path>", "restorePath": "<absolute pg_restore path>" }` تغییر می‌کند. اتصال ابر فقط با بررسی گواهی و نام میزبان Supabase پذیرفته می‌شود؛ پارامتر URI برای خاموش‌کردن TLS پذیرفته نمی‌شود. Docker از متغیر محیطی رمز را می‌گیرد و رمز در argv قرار نمی‌گیرد. محیط privileged backup روی میزبان اپراتور می‌ماند و به مرورگر یا Function معمول اپ منتقل نمی‌شود.

```powershell
pnpm --filter @recalino/ops-cli backup --command create --env D:\private-config\backup.env --actor operator-name --reason "Approved daily logical backup"
pnpm --filter @recalino/ops-cli backup --command drill --env D:\private-config\backup.env --actor operator-name --reason "Isolated restore drill" --backup-id <UUID returned by create>
```

فرمان اول در هر روز UTC کلید idempotency یکسان دارد و archive آماده را دوباره نمی‌سازد. خروجی فقط شناسه، وضعیت، زمان، اندازهٔ ciphertext و شناسهٔ کلید است. دفتر OPS شامل متن کلاس، رمز یا URL خصوصی نیست. کار دوره‌ای `ops.backup_retention` پس از ۳۰ روز بایت‌ها را حذف می‌کند، جز سه نسخهٔ `ready` آخر (بخش [نگهداری و هشدار کهنگی](#نگهداری-و-هشدار-کهنگی))، و سپس سابقه‌های حذفِ دیگر لازم‌نبوده را پاک می‌کند؛ journal تا وقتی حتی یک پشتیبانِ نگهداری‌شدهٔ قبل از حذف وجود داشته باشد باقی می‌ماند.

برای پروژهٔ متصل `twowhuzhvyuzjrpraikm` می‌توان بدون رمز مدیریتی ماندگار از `--linked-supabase` استفاده کرد. فایل خصوصی باید `RECALINO_SUPABASE_CLI_PATH` را به executable واقعی CLI نسخهٔ 2.118.0 و در صورت نیاز `RECALINO_BACKUP_LINKED_WORKSPACE` را به مسیر مخزن بدهد. CLI هر بار اعتبارنامهٔ موقت تازه می‌گیرد؛ متن `db dump --linked --dry-run` فقط در حافظهٔ خصوصی خوانده می‌شود و فقط قالب دقیق نسخهٔ آزموده‌شده و پنج فیلد PG پذیرفته می‌شود. متن shell هیچ‌گاه اجرا نمی‌شود. هویت پروژه و tenant، گواهی و نام میزبان کنترل می‌شود؛ Docker از endpoint جلسه روی پورت 5432 استفاده می‌کند و رمز موجود در cache را کنار می‌گذارد. در این حالت `DATABASE_URL` و `BACKUP_DATABASE_URL` برای ساخت پشتیبان لازم نیستند؛ دفتر خصوصی نیز با همان اعتبارنامه و نقش ثابت `postgres` نوشته می‌شود. اتصال معمول اپ تغییر نمی‌کند.

```powershell
pnpm --filter @recalino/ops-cli backup --command create --linked-supabase --env D:\private-config\backup.env --actor operator-name --reason "Approved linked Supabase backup"
pnpm --filter @recalino/ops-cli backup --command drill --linked-supabase --env D:\private-config\backup.env --actor operator-name --reason "Approved isolated local drill" --backup-id <UUID>
```

مسیر wrapperهایی مانند `.cmd`، قالب CLI ناشناخته، پروژهٔ دیگر و نبود ابزار مناسب رد می‌شود. پیام خطا فقط مرحله و کد ثابت است؛ متن native stderr چاپ نمی‌شود. نسخهٔ `pg_dump` باید با نسخهٔ سرور سازگار باشد. پس از ارتقای CLI، fixture بی‌رمز و آزمون parser باید دوباره بررسی شوند. لاگین CLI روی میزبان اپراتور نیز باید معتبر بماند.

## فعال‌سازی روزانه روی میزبان موجود

ساخت پشتیبان، زمان‌بندی ساخت را فعال نمی‌کند. فایل `tools/backup/install-daily-task.ps1` ابزار ثبت صریح Windows Task Scheduler است. میزبان باید روزانه روشن، متصل و دارای محیط خصوصی، Docker یا ابزار native و نسخهٔ جاری پروژه باشد. زمان‌بندی پیش‌فرض محلی 03:00 است و اجرای ازدست‌رفته پس از در دسترس شدن میزبان شروع می‌شود. دستور ثبت روی میزبان تازه:

```powershell
pwsh -File tools/backup/install-daily-task.ps1 -WorkspacePath "D:\Claude Projects\Recalino" -OperatorEnvFile D:\private-config\backup.env -ActorId operator-name -LocalTime 03:00 -NodeDirectory "C:\Program Files\nodejs"
Get-ScheduledTask -TaskName 'Recalino encrypted daily backup'
Get-ScheduledTaskInfo -TaskName 'Recalino encrypted daily backup'
```

ثبت به‌تنهایی موفقیت اجرا را ثابت نمی‌کند؛ وضعیت آخرین اجرای همان action باید بررسی شود. نگهداری و حذف روی Vercel مستقل از روشن‌بودن میزبان اپراتور اجرا می‌شود. هیچ RPO/RTO یا SLA عمومی از این آزمون محلی نتیجه گرفته نمی‌شود.

برای زمان‌بندی حالت متصل، به دستور ثبت بالا `-LinkedSupabase` اضافه کنید. این switch فقط آرگومان ثابت CLI را به runner می‌دهد و هیچ رمز یا SQL در تعریف Task Scheduler نمی‌گذارد.

پارامتر `NodeDirectory` باید مسیر واقعی نصب Node.js 24 روی میزبان باشد. installer و runner اجرای `node.exe --version` را بررسی می‌کنند و نسخهٔ major دیگر را رد می‌کنند؛ runner همان مسیر را ابتدای PATH می‌گذارد. اگر این پارامتر داده نشود، installer مسیر executable موجود را از `Get-Command node` می‌گیرد و همان مسیر مؤثر را در action ثبت می‌کند؛ اجرای بعدی به PATH متفاوت Task Scheduler وابسته نمی‌شود. مسیر نمونهٔ بالا فقط برای نصب واقعی همین میزبان است.

installer مسیر مطلق Windows PowerShell، Node 24 و فایل JavaScript مربوط به Corepack/pnpm را در action ثبت می‌کند. `-PnpmCliPath` مسیر صریح فایل `pnpm.js` را می‌گیرد؛ runner آن را با همان `node.exe` اجرا می‌کند، نه با launcher ویندوزی که ممکن است Node دیگری انتخاب کند. جداکنندهٔ `--` آرگومان‌های فرمان backup را در pnpm 12 به خود ابزار می‌رساند. به‌روزرسانی فقط با `-UpdateExisting` مجاز است؛ task باید متعلق به همان حساب ویندوز، همان workspace و همان runner باشد و هنگام تغییر در حال اجرا نباشد.

### تنظیم رمزگذاری‌شده برای Task Scheduler

روی میزبان فعلی، action زمان‌بندی‌شده نتوانست فایل محدودشدهٔ LocalAppData را بخواند. مجوز فایل بازتر نشد؛ پیکربندی task با Windows DPAPI در scope برابر `CurrentUser` محافظت شد. فایل ciphertext در `.vercel/backup-operator.dpapi.json` از Git خارج است. رمزگشایی فقط در حافظه انجام می‌شود، هفت مقدار مجاز به محیط فرایند داده می‌شوند و در `finally` مقدارهای قبلی محیط بازمی‌گردند. فایل plaintext موقت یا مقدار محرمانه در argv و تعریف task ساخته نمی‌شود. این حالت فقط با `-LinkedSupabase` کار می‌کند؛ اتصال dump و manifest هر بار اعتبارنامهٔ موقت رسمی CLI را می‌گیرند، نه رمز مدیریتی ذخیره‌شده.

ابزار نسخه‌دار `tools/backup/protect-config.ps1` برای ساخت یا تعویض پیکربندی است. ورودی آن عمداً محدود است: **دقیقاً هفت متغیر زیر، هرکدام یک‌بار، در یک خط با مقدار داخل single quote**؛ خط خالی و توضیح با `#` مجاز است. newline داخل مقدار، escape سفارشی و متغیر اضافی مانند `DATABASE_URL`، `BACKUP_DATABASE_URL` یا `LOCAL_RESTORE_DATABASE_URL` پذیرفته نمی‌شود. این ورودی با فایل عمومی تنظیم manual backup در بخش بالاتر متفاوت است.

```dotenv
RECALINO_BACKUP_KEY_BASE64='<existing canonical 32-byte key>'
RECALINO_BACKUP_KEY_ID='<matching key identifier>'
RECALINO_BACKUP_SETTINGS_JSON='<one-line JSON with matching keyId, maxEncryptedBytes and timeoutSeconds>'
RECALINO_BACKUP_TOOLS_JSON='<one-line JSON for existing Docker or native tools>'
RECALINO_SUPABASE_CLI_PATH='<absolute path to pinned supabase executable>'
RECALINO_BACKUP_LINKED_WORKSPACE='D:\Claude Projects\Recalino'
BLOB_READ_WRITE_TOKEN='<existing private Blob credential>'
```

ساخت باید زیر همان حساب ویندوزِ task انجام شود. ابزار طول کلید، key ID و ref متصل را بررسی می‌کند و فایل خروجی را با `FileMode.CreateNew` می‌سازد؛ حتی در رقابت دو نویسنده فایل موجود جایگزین نمی‌شود. برای تعویض تنظیم، مسیر ciphertext تازه انتخاب کنید، سپس همان task را با مسیر تازه به‌روزرسانی و اجرا کنید. دادهٔ ciphertext یا مقدارهای بازشده در خروجی ابزار چاپ نمی‌شوند.

```powershell
pwsh -File tools/backup/protect-config.ps1 -OperatorEnvFile D:\private-config\linked-backup.env -OutputPath "D:\Claude Projects\Recalino\.vercel\backup-operator.dpapi.v2.json"
pwsh -File tools/backup/install-daily-task.ps1 -WorkspacePath "D:\Claude Projects\Recalino" -OperatorEnvFile "D:\Claude Projects\Recalino\.vercel\backup-operator.dpapi.v2.json" -ActorId operator-name -LinkedSupabase -DpapiConfig -UpdateExisting -NodeDirectory "C:\Program Files\nodejs" -PnpmCliPath "C:\nvm4w\nodejs\node_modules\corepack\dist\pnpm.js"
Start-ScheduledTask -TaskName 'Recalino encrypted daily backup'
Get-ScheduledTaskInfo -TaskName 'Recalino encrypted daily backup'
```

پس از آزمون موفق، ورودی plaintext مشتق‌شده دیگر برای اجرای task لازم نیست. نسخهٔ مستقل آفلاین کلید AES برای بازیابی و کلیدهای قدیمی لازم باید حفظ شوند، ولی تا 2026-10-18 چنین نسخه‌ای تثبیت نشده و تصمیم انتقال آن با مالک محصول باز است (بخش [محل کلید و مدل تهدید](#محل-کلید-و-مدل-تهدید)). DPAPI جای کلید مستقل بازیابی را نمی‌گیرد و به حساب/پروفایل ویندوز وابسته است. برای میزبان یا حساب تازه، پیکربندی DPAPI تازه بسازید. تعویض خود کلید AES باید با key ID جدید و حفظ کلیدهای بایگانی‌ها و journalهای قبلی انجام شود.

runner فقط stage/کد ثابت و شناسه، وضعیت، key ID و اندازهٔ archive را در `daily-status.json` کنار فایل تنظیم و `.vercel/backup-task-runtime.json` ثبت می‌کند. در شکست کودک، `childFailure` فقط stage و error از فهرست دقیق کدهای ثابت CLI را نگه می‌دارد؛ متن و فیلدهای اضافی حتی از JSON کودک نیز رد می‌شوند. stderr و JSON بازشدهٔ تنظیم ثبت نمی‌شوند. نبود نتیجهٔ معتبر یا شکست preflight، exit غیرصفر می‌دهد؛ نتیجهٔ manual را جای نتیجهٔ action زمان‌بندی‌شده حساب نکنید.

### وضعیت تأییدشدهٔ میزبان فعلی

در 2026-10-04، task `Recalino encrypted daily backup` با زمان محلی 03:00 و timezone برابر `GMT Standard Time` ثبت و action خودش اجرا شد. `LastTaskResult: 0` و گزارش تازهٔ 18:02:51 UTC، پس از شروع 18:02:37 UTC، موفقیت را تأیید کردند؛ Node 24.19.0 و اتصال linked ابری استفاده شد. archive آمادهٔ همان روز با 304681 بایت ciphertext طبق idempotency دوباره استفاده شد؛ snapshot تازه یا تمرین restore دیگری انجام نشد. گزارش عمومیِ بدون اسرار: `artifacts/verification/encrypted-daily-backup.json`.

task از نوع `InteractiveToken` و سطح `Limited` است: حساب ویندوز مالک باید وارد سیستم باشد، میزبان روشن و آنلاین بماند، Docker موجود اجرا شود و ورود CLI اعتبار داشته باشد. `StartWhenAvailable` فعال است و اجراهای هم‌زمان نادیده گرفته می‌شوند. اجرای بعدی هنگام ثبت شواهد 2026-10-05 ساعت 03:00 محلی، برابر 02:00 UTC، بود. این نتیجه تضمین اجرای شبانه در میزبان خاموش/خارج‌شده از حساب یا عدد RPO/RTO نیست.

پنج آزمون ایزولهٔ `node --test tools/backup/daily-task.test.mjs` موفق شدند: محیط کودک از DPAPI، حذف diagnostic محرمانهٔ مصنوعی از گزارش، رد مالک متفاوت، رد ciphertext تغییرکرده، منع اتصال نامشخص/محلی و حفظ فایل موجود هنگام درخواست جایگزینی. این آزمون‌ها کلید ساختگی و فرمان کودک ساختگی دارند و هیچ اتصال دیتابیس، Blob، AI یا restore انجام نمی‌دهند.

### بررسی اجرای ۵ اکتبر و تکرار محدود

اجرای خودکار 2026-10-05 ساعت 03:00 لندن آغاز شد ولی با `LastTaskResult: 1` و گزارش تازهٔ `backup_schedule_execution_failed` پایان یافت. runner آن زمان کد پاک‌سازی‌شدهٔ کودک را نگه نمی‌داشت، بنابراین علت دقیق تاریخی مشخص نیست؛ از موفقیت بعدی رفع قطعی علت نتیجه نمی‌گیریم. در همان روز، خود action ثبت‌شده دوباره در 02:05:04 UTC، برابر 03:05 لندن، اجرا شد و در 02:05:18 UTC گزارش تازهٔ موفق و `LastTaskResult: 0` داد. دفتر ابری `ops.backup_verified` در 02:05:16 UTC و archive آمادهٔ 319272 بایتی نشان می‌دهند پشتیبان تازهٔ همان روز کامل شد؛ archive ۴ اکتبر بازاستفاده نشد. رزروِ تلاش ناموفق و تلاش موفق همان شناسه و کلید روزانه را دارند. هیچ restore یا حذف انجام نشد.

installer اکنون برای همان job حداکثر سه تکرار پس از شکست، با فاصلهٔ ده دقیقه، ثبت می‌کند. هویت حساب، `Interactive`، سطح `Limited`، منع شروع روی باتری، توقف هنگام انتقال به باتری، `StartWhenAvailable`، سقف یک ساعت برای هر اجرا و `IgnoreNew` حفظ شده‌اند؛ `WakeToRun` خاموش است. تکرارها وابستگی به روشن و بیدار بودن میزبان، برق، اینترنت، Docker و ورود معتبر CLI را برطرف نمی‌کنند. صفحهٔ ویندوز می‌تواند قفل باشد و Codex یا مرورگر لازم نیست باز بمانند؛ خروج از حساب ویندوز با قفل صفحه متفاوت است.

شش آزمون ایزولهٔ runner پس از افزودن بررسی شکست کودک موفق شدند. آزمون تازه ثابت می‌کند تنها دو مقدار از enum مجاز باقی می‌مانند و متن diagnostic و فیلدهای خصوصی مصنوعی در stdout، stderr و گزارش ذخیره‌شده دیده نمی‌شوند. شواهد غیرمحرمانهٔ اجرای شکست‌خورده، تکمیل پشتیبان همان روز و تنظیم تکرار در `artifacts/verification/encrypted-daily-backup-2026-10-05.json` ثبت شده‌اند.

## وضعیت فعلی: شکست پشتیبان روزانه (ممیزی 2026-10-18)

خواندن فقط‌خواندنی `ops.database_backup` در ممیزی پروژه در 2026-10-18 (یافتهٔ OPS-01):

| روز (UTC) | نتیجه |
|---|---|
| 10-09، 10-10، 10-12، 10-13 | `ready` |
| 10-11 | اجرا نشده |
| 10-14 | `failed` |
| 10-15 | `ready`؛ آخرین نسخهٔ سالم، 09:00 UTC |
| 10-16، 10-17، 10-18 | `failed` |

آخرین تمرین بازیابی ثبت‌شده 2026-10-04 است. این جدول از گزارش ممیزی نقل شده است. هنگام تدوین این بخش هیچ فرمانی روی میزبان یا دیتابیس ابری اجرا نشد.

**اقدام فوری مالک محصول، دستی، روی میزبان اپراتور:**

1. علت شکست task ویندوز را ببینید: `Get-ScheduledTaskInfo -TaskName 'Recalino encrypted daily backup'` (`LastTaskResult` و `LastRunTime`) و فیلدهای `stage`، `error` و `childFailure` در `daily-status.json`. این فایل فقط کد ثابت دارد؛ محتوای آن را بدون مقدار محرمانه بررسی کنید.
2. پس از رفع علت (مثلاً ورود CLI، Docker، روشن‌بودن میزبان یا پیکربندی DPAPI)، یک پشتیبان دستی بسازید: `Start-ScheduledTask` و سپس `Get-ScheduledTaskInfo`، یا فرمان `create` بالا.
3. یک تمرین بازیابی ایزوله روی همان نسخه اجرا کنید (فرمان `drill` با `--backup-id`).
4. نتیجه را با تاریخ در همین بخش ثبت کنید. هیچ کلید، توکن یا URL خصوصی را در این سند ننویسید.

## نگهداری و هشدار کهنگی

از اصلاح OPS-01 (2026-10-18)، کار ساعتی `ops.backup_retention` دو قاعدهٔ تازه دارد:

- **کف نگهداری:** سه نسخهٔ `ready` آخر (بر اساس `created_at`) حتی پس از گذشتن `expires_at` حذف نمی‌شوند و با `readDatabaseBackup` خواندنی می‌مانند. نسخه‌های `pending`، `failed` و `ready` قدیمی‌تر، مثل قبل، پس از ۳۰ روز حذف می‌شوند. journal حذف تا وقتی چنین نسخه‌ای باقی است نگه داشته می‌شود (`maintainDeletionJournals`). پس بازیابی از نسخهٔ نگه‌داشته‌شده، حذف‌های بعدی را دوباره اعمال می‌کند.
- **هشدار کهنگی:** اگر جدیدترین نسخهٔ `ready` قدیمی‌تر از ۳۰ ساعت باشد، یا هیچ نسخهٔ `ready` وجود نداشته باشد، یک رخداد audit با `action = ops.backup_stale` و `actor_id = ops.backup_retention` ثبت می‌شود. این رخداد در «Recent activity» صفحهٔ نخست پنل ادمین و در صفحهٔ Audit دیده می‌شود. همزمان یک لاگ `error` با رخداد `backup_stale` نوشته می‌شود؛ فیلدهای آن فقط `module`، `kind`، `reason` و `age_ms` از فهرست مجاز `log.ts` هستند. کلید هشدار شناسهٔ همان جدیدترین نسخهٔ `ready` است (یا `none`). پس تکرار ساعتی هشدار تکراری نمی‌سازد و هشدار تازه فقط پس از یک نسخهٔ موفق بعدی و کهنگی دوباره ثبت می‌شود.

هر دو عدد بدون تغییر کد با `RECALINO_BACKUP_RETENTION_JSON` در محیط Vercel قابل تغییرند، مثلاً `{"keepReady":3,"staleAfterHours":30}`. کلیدهای ناشناخته یا مقدار خارج از بازه (`keepReady` از 0 تا 30، `staleAfterHours` از 1 تا 720) job را با خطا متوقف می‌کنند و در آن اجرا چیزی حذف نمی‌شود. `keepReady: 0` همان چرخهٔ سخت ۳۰روزهٔ قبلی است.

**تعارض (حل‌شده در 2026-10-19 با [D85](../PRODUCT_DECISIONS_LOG.md)):** مالک محصول `keepReady: 3` را تأیید کرد و جملهٔ نگهداری در ADR-0001 (اصلاحیهٔ ۱)، `privacy-notice.md` و `PILOT_TECHNICAL_FACTS.md` اصلاح شد؛ نسخهٔ متن حریم خصوصی هنوز ۰٫۲ است و بالا بردن آن تصمیم جداست. متن زیر وضعیت پیش از آن است. نگه‌داشتن نسخه‌ای بیش از ۳۰ روز با «نگهداری ۳۰ روزه» در ADR-0001، `docs/legal/privacy-notice.md` و `docs/legal/PILOT_TECHNICAL_FACTS.md` ناسازگار است. این حالت فقط وقتی رخ می‌دهد که پشتیبان‌گیری بیش از ۲۷ روز پیاپی شکست بخورد. پیش‌فرض ۳ را ممیزی پیشنهاد کرده است. تا تصمیم مالک محصول، یا متن نگهداری اصلاح و نسخه‌دار می‌شود، یا `keepReady` روی 0 تنظیم می‌شود. هشدار ادمین به‌صورت `ops.admin_task` به migration تازه نیاز دارد و هنوز ساخته نشده است.

## هدف RPO پایلوت و بررسی هفتگی

- **هدف داخلی پیشنهادی (منتظر تأیید مالک محصول):** RPO برابر ۲۴ ساعت، یعنی دست‌کم یک نسخهٔ `ready` در هر روز UTC. آستانهٔ هشدار ۳۰ ساعت است تا یک اجرای دیرشده هشدار کاذب نسازد. این عدد وعدهٔ عمومی، SLA یا RTO نیست. تا وقتی پشتیبان فقط روی میزبان شخصی اجرا می‌شود، روشن و آنلاین ماندن میزبان پیش‌شرط آن است.
- **مسئول:** مالک محصول، به‌عنوان تنها اپراتور پایلوت.
- **روال هفتگی (هر دوشنبه):**
  1. در پنل ادمین، صفحهٔ Backups: جدیدترین ردیف `ready` کمتر از ۳۰ ساعت عمر داشته باشد. ردیف‌های `failed` هفته را بشمارید.
  2. در صفحهٔ نخست یا Audit: رخداد `ops.backup_stale` تازه نباشد.
  3. روی میزبان: `Get-ScheduledTaskInfo` با `LastTaskResult: 0` و `daily-status.json` بدون `childFailure`.
  4. اگر یکی از این‌ها برقرار نبود، اقدام‌های بخش «وضعیت فعلی» را انجام دهید.
- **ماهانه و پس از هر تعویض کلید:** یک تمرین بازیابی ایزوله با نسخهٔ مستقل کلید (بخش بعد) و ثبت تاریخ آن در همین سند.

## محل کلید و مدل تهدید

یک کلید AES-256-GCM با شناسهٔ `RECALINO_BACKUP_KEY_ID` و مقدار `RECALINO_BACKUP_KEY_BASE64` دو کار انجام می‌دهد: رمزگذاری archive پشتیبان روی میزبان اپراتور، و رمزگذاری journal حذف در `priv/system/` توسط اپ. journal در `apps/web/src/server/privacy-journal.ts` ساخته می‌شود و نبود کلید با `deletion_journal_key_missing` حذف را متوقف می‌کند. تمرین `drill` در `packages/ops-cli/src/backup.ts` journalها را فقط با همان key ID پشتیبان می‌خواند.

**محل‌های فعلی کلید** (از کد؛ هیچ مقداری خوانده یا چاپ نشده است):

| محل | دلیل | منبع |
|---|---|---|
| Vercel production، متغیر Sensitive | نوشتن journal حذف در Function | `tools/configure-runtime-env.mjs --apply-production --include-backup-key` |
| پیکربندی DPAPI در `.vercel/backup-operator.dpapi*.json` روی میزبان اپراتور | ساخت پشتیبان روزانه با Task Scheduler | `tools/backup/protect-config.ps1` |
| فایل‌های plaintext احتمالی روی میزبان: `.env.backup.local` در ریشهٔ مخزن، `apps/web/.env.local` (با `--local`) و فایل ورودی `D:\private-config\*.env` | ورودی ابزارهای پیکربندی | `tools/configure-runtime-env.mjs`، `tools/backup/protect-config.ps1` |
| نسخهٔ مستقل آفلاین | بازیابی پس از فقدان Vercel یا پروفایل ویندوز | **تثبیت نشده؛ تصمیم مالک محصول باز است** |

**مدل تهدید واقعی:**

- **نفوذ به حساب Vercel:** مهاجم هم `BLOB_READ_WRITE_TOKEN` (طبق D53 در Vercel مانده است) و هم کلید را می‌گیرد. پس همهٔ پشتیبان‌ها و journalها را می‌تواند بخواند. در برابر این تهدید، رمزگذاری محافظتی ندارد.
- **نفوذ به حساب ویندوز میزبان:** DPAPI در scope `CurrentUser` باز می‌شود و همان کلید و توکن Blob به دست می‌آید.
- **محافظت واقعی رمزگذاری:** نشت جداگانهٔ خود Blob یا توکن آن بدون کلید، و نشت دیتابیس. دیتابیس فقط متادیتای پشتیبان را دارد.
- **فقدان:** اگر متغیر Vercel بازنویسی یا حذف شود و پروفایل ویندوز از دست برود (خرابی دیسک، نصب دوباره یا حساب تازه)، بدون نسخهٔ مستقل هیچ پشتیبان یا journalی باز نمی‌شود. بازیابی و بازاعمال حذف‌ها هم ممکن نیست.

**نسخهٔ مستقل آفلاین، پس از تصویب مالک محصول:**

1. مالک محصول کلید و key ID را از پیکربندی موجود، روی همان میزبان و بدون نمایش در ترمینال مشترک، چت یا لاگ، به یک محل آفلاین در اختیار خودش منتقل می‌کند؛ مثلاً password manager یا رسانهٔ رمزگذاری‌شدهٔ جدا. محل نباید Git، Blob، همان حساب Vercel یا پیام باشد.
2. برچسب: key ID و تاریخ شروع استفاده. کلیدهای قدیمی تا حذف آخرین پشتیبان و journal رمزشده با آن‌ها نگه داشته می‌شوند. کف نگهداری ممکن است این مدت را از ۳۰ روز بیشتر کند.
3. **آزمون:** یک فایل env موقت و خصوصی برای `drill` بسازید که `RECALINO_BACKUP_KEY_*` را از نسخهٔ آفلاین بگیرد، نه از DPAPI. سپس `drill` را با `--backup-id` جدیدترین نسخهٔ `ready` اجرا کنید. موفقیت، متادیتای تمرین را در OPS ثبت می‌کند و درستی نسخهٔ مستقل را نشان می‌دهد. فایل موقت را بلافاصله پاک کنید. این آزمون ماهانه و پس از هر تعویض کلید تکرار می‌شود.
4. پس از آزمون موفق، نسخه‌های plaintext جدول بالا را، جز نسخهٔ آفلاین، پاک کنید.

**اگر مالک محصول جداسازی کلید journal از کلید پشتیبان را تصویب کند** (به کد نیاز دارد و انجام نشده است):

1. یک کلید و key ID تازه فقط برای journal ساخته شود. `privacy-journal.ts` و `configure-runtime-env.mjs` متغیر جداگانهٔ journal را بخوانند. `drill` در `ops-cli` نیز keyring دوکلیدی بگیرد تا journalهای قدیمی و تازه را بخواند.
2. پس از استقرار و آزمون حذف، `RECALINO_BACKUP_KEY_*` از Vercel production برداشته شود. نسخهٔ آفلاین و DPAPI می‌مانند. کلید قبلی برای journalهای قدیمی تا پایان عمرشان در keyring بازیابی باقی می‌ماند.
3. حتی پس از جداسازی، نفوذ به Vercel به journalها (رسید حداقلی حذف با شناسه‌ها) می‌رسد، ولی به archive پشتیبان نمی‌رسد.

## تمرین ایزوله و سابقهٔ حذف

فرمان `drill` فقط یک URL literal loopback با دیتابیس پایه `postgres` را می‌پذیرد. یک دیتابیس خالی `recalino_restore_<32 hex digits>` می‌سازد، archive احرازاصالت‌شده را با توقف در اولین خطا و تراکنش واحد بازیابی می‌کند، و پس از بررسی constraintها و متادیتا همان دیتابیس تصادفی را حذف می‌کند. کد مسیر cloud restore یا جایگزینی دیتابیس اپ ندارد. نام دامنه، override URI، و نام یک دیتابیس موجود رد می‌شوند.

هر حذف پذیرفته‌شده باید قبل از پاسخ موفق API، receipt حداقلی و رمزگذاری‌شدهٔ مستقل در `priv/system/` داشته باشد. بازیابیِ پس از فقدان کل دیتابیس می‌تواند این journalها را بدون جدول‌های OPS از Blob خصوصی بخواند و request IDها را deduplicate کند. تمرین، journalهای جلسه/منبع/حسابِ بعد از زمان snapshot را روی دیتابیس ایزوله دوباره اعمال می‌کند. Replay فقط tombstone، لغو و منع دسترسی را انجام می‌دهد؛ تماس Auth، حذف فایل ابر، تماس AI یا job خارجی ندارد.

سرویس عمومی در تمرین باز نمی‌شود. بازیابی واقعی علاوه بر archive به تمام کلیدهای journal لازم، تنظیمات میزبان و Auth، grantهای role از migrationهای نسخهٔ مطابق، و بازاعمال حذف‌های پس از snapshot نیاز دارد. اشیای Blob جدا از dump دیتابیس‌اند: قبل از بازکردن سرویس باید وجود فایل‌های ماندگار بررسی و فایل‌های حذف‌شده از journal دوباره حذف شوند. صوت اصلی کلاس طبق D29 روی دستگاه کاربر است و با پشتیبان دیتابیس بازسازی نمی‌شود. فقدان کلید، journal ناخوانا یا خطای replay باید بازیابی را متوقف نگه دارد.

## شواهد محلی

آزمون واقعی و opt-in محلی:

```powershell
$env:RUN_NATIVE_BACKUP_DRILL = '1'
pnpm exec vitest run --project integration packages/ops-cli/src/backup-native.int.test.ts
```

این آزمون `pg_dump` واقعی را روی PostgreSQL محلی موجود اجرا می‌کند، ciphertext خصوصی را می‌سازد، در دیتابیس موقت restore می‌کند، journalهای ساخته‌شده پس از archive را برای حساب/جلسه/منبع replay می‌کند، منع دسترسی به دادهٔ حذف‌شده و constraintها را می‌سنجد و نبود دیتابیس موقت پس از پایان را تأیید می‌کند. سایر آزمون‌ها تغییر بایت و هدر، کلید اشتباه، تفاوت نوع journal/archive، idempotency، حذف ۳۰روزه و خواندن journal بدون manifest دیتابیس را می‌سنجند.

آزمون native همچنین دوبار replay، receipt تکراری، رد منابع و کلاس‌های حساب دیگر، و subject ساخته‌شده پس از snapshot را می‌سنجد. وقتی منبعی در snapshot وجود ندارد، journal آن نباید جزوهٔ کلاس نامرتبط موجود را پنهان کند. این رفتار در بازیابی واقعی محلی تأیید شده است؛ هیچ دادهٔ ابر برای تمرین restore خوانده نمی‌شود.

مبنای ابزار و بازیابی: [Supabase backup/restore CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)، [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html). راهنما در 2026-10-04 بررسی شد.

در 2026-10-04 یک پشتیبان واقعی پروژهٔ متصل با 304681 بایت ciphertext در Blob خصوصی آماده شد و فقط در دیتابیس موقت محلی بازیابی شد: 87 جدول، constraintهای معتبر، بدون بازکردن سرویس عمومی، و حذف دیتابیس موقت پس از پایان. متادیتای تمرین در OPS ثبت شد؛ داده یا SQL خصوصی چاپ نشد. این اجرای یک‌باره به معنی فعال‌شدن زمان‌بندی روزانه نیست.
