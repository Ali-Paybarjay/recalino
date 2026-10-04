# پشتیبان‌گیری و تمرین بازیابی

مطابق [ADR-0001](../adr/0001-stack-and-hosting.md)، پشتیبان منطقی روزانه باید در Blob خصوصی موجود و حداکثر ۳۰ روز نگهداری شود. مسیر اجرایی `packages/ops-cli/src/backup.ts` از `pg_dump` واقعی استفاده می‌کند؛ باینری PostgreSQL روی Vercel موجود فرض نمی‌شود. سرویس پولی یا میزبان تازه‌ای لازم نیست: ابزار native نصب‌شده یا PostgreSQL داخل Docker موجودِ میزبان مورد اعتماد اپراتور کافی است.

پشتیبان یک archive سازگار PostgreSQL است: ساختار، داده، constraintها، sequenceها، شناسه‌های Auth و سابقهٔ migration. فقط دادهٔ پایدار `auth.users`، `auth.identities` و `auth.schema_migrations` در Auth می‌ماند؛ session، refresh token، جریان‌های یک‌بارمصرف و دادهٔ موقت سایر جدول‌های Auth وارد پشتیبان نمی‌شوند. رمز نقش دیتابیس و کلیدهای محیطی در archive نیستند. حساب پایلوت با Google وارد می‌شود؛ پس از بازیابی ورود دوباره لازم است. تنظیم Google، کلیدهای میزبان و رمز جدید نقش اختصاصی اپ باید جداگانه بازسازی شوند.

خروجی `pg_dump` بلافاصله با AES-256-GCM رمزگذاری می‌شود. فایل plaintext روی دیسک ساخته نمی‌شود، و native stderr و SQL چاپ نمی‌شوند. هدرِ نسخه، نوع archive و key ID نیز احراز اصالت می‌شود. کلید ۳۲‌بایتی باید جدا از Blob نگهداری شود؛ هنگام تعویض کلید، کلیدهای قدیمی تا پایان عمر پشتیبان‌ها و سابقه‌های حذفِ مربوط باقی بمانند. رمزگذاری، سقف بایت و timeout قابل آزمون‌اند و نبود پیکربندی عملیات را متوقف می‌کند.

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

فرمان اول در هر روز UTC کلید idempotency یکسان دارد و archive آماده را دوباره نمی‌سازد. خروجی فقط شناسه، وضعیت، زمان، اندازهٔ ciphertext و شناسهٔ کلید است. دفتر OPS شامل متن کلاس، رمز یا URL خصوصی نیست. کار دوره‌ای `ops.backup_retention` پس از ۳۰ روز بایت‌ها را حذف می‌کند و سپس سابقه‌های حذفِ دیگر لازم‌نبوده را پاک می‌کند؛ journal تا وقتی حتی یک پشتیبانِ نگهداری‌شدهٔ قبل از حذف وجود داشته باشد باقی می‌ماند.

برای پروژهٔ متصل `twowhuzhvyuzjrpraikm` می‌توان بدون رمز مدیریتی ماندگار از `--linked-supabase` استفاده کرد. فایل خصوصی باید `RECALINO_SUPABASE_CLI_PATH` را به executable واقعی CLI نسخهٔ 2.118.0 و در صورت نیاز `RECALINO_BACKUP_LINKED_WORKSPACE` را به مسیر مخزن بدهد. CLI هر بار اعتبارنامهٔ موقت تازه می‌گیرد؛ متن `db dump --linked --dry-run` فقط در حافظهٔ خصوصی خوانده می‌شود و فقط قالب دقیق نسخهٔ آزموده‌شده و پنج فیلد PG پذیرفته می‌شود. متن shell هیچ‌گاه اجرا نمی‌شود. هویت پروژه و tenant، گواهی و نام میزبان کنترل می‌شود؛ Docker از endpoint جلسه روی پورت 5432 استفاده می‌کند و رمز موجود در cache را کنار می‌گذارد. در این حالت `DATABASE_URL` و `BACKUP_DATABASE_URL` برای ساخت پشتیبان لازم نیستند؛ دفتر خصوصی نیز با همان اعتبارنامه و نقش ثابت `postgres` نوشته می‌شود. اتصال معمول اپ تغییر نمی‌کند.

```powershell
pnpm --filter @recalino/ops-cli backup --command create --linked-supabase --env D:\private-config\backup.env --actor operator-name --reason "Approved linked Supabase backup"
pnpm --filter @recalino/ops-cli backup --command drill --linked-supabase --env D:\private-config\backup.env --actor operator-name --reason "Approved isolated local drill" --backup-id <UUID>
```

مسیر wrapperهایی مانند `.cmd`، قالب CLI ناشناخته، پروژهٔ دیگر و نبود ابزار مناسب رد می‌شود. پیام خطا فقط مرحله و کد ثابت است؛ متن native stderr چاپ نمی‌شود. نسخهٔ `pg_dump` باید با نسخهٔ سرور سازگار باشد. پس از ارتقای CLI، fixture بی‌رمز و آزمون parser باید دوباره بررسی شوند. لاگین CLI روی میزبان اپراتور نیز باید معتبر بماند.

## فعال‌سازی روزانه روی میزبان موجود

ساخت پشتیبان، زمان‌بندی ساخت را فعال نمی‌کند. فایل `tools/backup/install-daily-task.ps1` ابزار opt-in ثبت Windows Task Scheduler است؛ این فایل به‌تنهایی اجرا یا ثبت نشده است. میزبان باید روزانه روشن، متصل و دارای محیط خصوصی، Docker یا ابزار native و نسخهٔ جاری پروژه باشد. زمان‌بندی پیش‌فرض محلی 03:00 است و اجرای ازدست‌رفته پس از در دسترس شدن میزبان شروع می‌شود. دستور ثبت:

```powershell
pwsh -File tools/backup/install-daily-task.ps1 -WorkspacePath "D:\Claude Projects\Recalino" -OperatorEnvFile D:\private-config\backup.env -ActorId operator-name -LocalTime 03:00 -NodeDirectory "C:\Program Files\nodejs"
Get-ScheduledTask -TaskName 'Recalino encrypted daily backup'
Get-ScheduledTaskInfo -TaskName 'Recalino encrypted daily backup'
```

زمان‌بندی ساخت روی این میزبان باید صریحاً فعال و وضعیت آخرین اجرای آن بررسی شود؛ تا آن زمان «پشتیبان روزانه فعال» ادعا نمی‌شود. نگهداری و حذف روی Vercel مستقل از روشن‌بودن میزبان اپراتور اجرا می‌شود. هیچ RPO/RTO یا SLA عمومی از این آزمون محلی نتیجه گرفته نمی‌شود.

برای زمان‌بندی حالت متصل، به دستور ثبت بالا `-LinkedSupabase` اضافه کنید. این switch فقط آرگومان ثابت CLI را به runner می‌دهد و هیچ رمز یا SQL در تعریف Task Scheduler نمی‌گذارد.

پارامتر `NodeDirectory` باید مسیر واقعی نصب Node.js 24 روی میزبان باشد. installer و runner اجرای `node.exe --version` را بررسی می‌کنند و نسخهٔ major دیگر را رد می‌کنند؛ runner همان مسیر را ابتدای PATH می‌گذارد. اگر این پارامتر داده نشود، installer مسیر executable موجود را از `Get-Command node` می‌گیرد و همان مسیر مؤثر را در action ثبت می‌کند؛ اجرای بعدی به PATH متفاوت Task Scheduler وابسته نمی‌شود. مسیر نمونهٔ بالا فقط برای نصب واقعی همین میزبان است.

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
