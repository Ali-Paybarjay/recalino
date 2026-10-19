# محیط ابری Claude Code برای ریکالینو

تاریخ: 2026-10-14 (تصمیم مالک محصول) · به‌روز: 2026-10-18 (setup script سخت‌گیر، OPS-09)

## چرا environment جداگانه

حساب مالک محصول پیش از این فقط یک environment ابری به نام «Default» داشت که همهٔ مخزن‌ها، از جمله fitness-coach، از آن استفاده می‌کنند. آن environment سه متغیر `NEXT_PUBLIC_SUPABASE_URL`، `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` و `SUPABASE_SECRET_KEY` را برای پروژهٔ fitness-coach صادر می‌کند. ریکالینو `SUPABASE_SECRET_KEY` را می‌خواند و متغیر محیطی بر `apps/web/.env.local` مقدم است؛ در نتیجه آزمون‌های محلی با کلید پروژهٔ دیگر اجرا می‌شدند و با 401 شکست می‌خوردند، و هر سشن ریکالینو کلید مدیریتی پروژهٔ دیگری را با خود داشت (نقض حداقل دسترسی). تصویر پایهٔ ابری هم فقط Node 20 تا 22 دارد، در حالی که مخزن Node 24 می‌خواهد (`.nvmrc` و `engines`).

از 2026-10-14 سشن‌های ریکالینو در environment جداگانهٔ **Recalino** باز می‌شوند. «Default» برای پروژه‌های دیگر دست‌نخورده می‌ماند.

## تنظیمات environment «Recalino»

محل ویرایش: claude.ai/code → **New** → چیپ ابر بالای کادر پیام → **Cloud** → آیکون تنظیمات کنار Recalino. (منوی عنوان سشن فقط environment فعلی را ویرایش می‌کند.)

- **Name:** `Recalino`
- **Network access:** هم‌سطح Default. سطح Trusted کافی نیست، چون `*.supabase.co`، `api.supabase.com`، `openrouter.ai` و `*.vercel.app` در فهرست پیش‌فرض نیستند و برای `supabase db push`، اجرای واقعی provider و smoke test لازم‌اند. اگر Custom انتخاب می‌شود: فهرست پیش‌فرض تیک‌خورده به‌علاوهٔ همین چهار دامنه.
- **Environment variables:** فقط `OPENROUTER_API_KEY`، آن هم اختیاری و با کلیدی که سقف هزینهٔ کوچک دارد. هیچ متغیر `SUPABASE_*` یا `NEXT_PUBLIC_*` تعریف نمی‌شود: Supabase ابری از طریق کانکتور و `pnpm db:apply`، و Supabase محلی با Docker و `pnpm db:env`.
- **Network secrets (D77، 2026-10-15):** «Supabase migrations (recalino)»: نوع Bearer، میزبان `api.supabase.com` و پیشوند مسیر `/v1/projects/twowhuzhvyuzjrpraikm/`. مقدار آن access token محدود Supabase است: فقط پروژهٔ recalino، Database Read-write و Migrations Read-write. proxy توکن را خودش به درخواست اضافه می‌کند و سشن آن را نمی‌بیند. هنگام چرخش توکن فقط مقدار همین secret عوض می‌شود.
- **Setup script (نسخهٔ سخت‌گیر، 2026-10-18، OPS-09):** Node 24 را کنار نسخه‌های تصویر نصب می‌کند و pnpm را با corepack روی نسخهٔ ثابت `packageManager` می‌گذارد. PATH این تصویر از `/etc/profile.d/` ساخته نمی‌شود، پس symlink در `/root/.local/bin` (که در ابتدای PATH هر سشن است) لازم است. نسخهٔ پیشین هر خطا را با `|| true` پنهان می‌کرد، tarball را بدون checksum می‌پذیرفت و pnpm را با `npm install -g` می‌گذاشت؛ نتیجه این بود که شکست یک گام تا میانهٔ کار دیده نمی‌شد.

  script تازه:
  - با `set -euo pipefail` و پیام `recalino-setup: …` در stderr با نخستین شکست و کد خروج غیرصفر می‌ایستد.
  - فایل رسمی `SHASUMS256.txt` همان نسخه را از nodejs.org می‌گیرد و با `sha256sum -c` پیش از باز کردن tarball می‌سنجد. این فایل از همان منبع tarball می‌آید، پس خرابی یا دست‌کاری tarball را می‌گیرد، نه نفوذ به خود nodejs.org را.
  - pnpm را با `corepack prepare pnpm@12.4.2 --activate` فعال می‌کند. نخستین اجرای `pnpm -v` در همان script باینری pnpm را می‌گیرد، تا دانلود وسط یک سشن نیفتد.
  - در پایان `node -v` را با `v24.21.0` و `pnpm -v` را با `12.4.2` دقیقاً مقایسه می‌کند؛ هر تفاوت، script را با خطا تمام می‌کند.

```bash
#!/bin/bash
# Recalino cloud environment: Node 24 (the image ships 20-22; package.json engines >=24 <25) and
# pnpm 12.4.2 (package.json packageManager). Every step must succeed. Any failure stops the script
# with a message on stderr and a non-zero exit status, so the session is never started on a
# wrong Node or pnpm. Bump V together with .nvmrc and engines.
set -euo pipefail
trap 'echo "recalino-setup: failed at line $LINENO: $BASH_COMMAND" >&2' ERR
fail() { echo "recalino-setup: $*" >&2; exit 1; }

V=24.21.0
PNPM=12.4.2
PREFIX=/opt/node24
ARCHIVE="node-v$V-linux-x64.tar.xz"
BASE="https://nodejs.org/dist/v$V"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

# 1. Download the tarball and the official checksum list, then verify before extracting.
curl -fsSLO "$BASE/$ARCHIVE" || fail "download of $ARCHIVE failed"
curl -fsSLO "$BASE/SHASUMS256.txt" || fail "download of SHASUMS256.txt failed"
[ "$(grep -c -F "  $ARCHIVE" SHASUMS256.txt)" = 1 ] || fail "$ARCHIVE is not listed once in SHASUMS256.txt"
grep -F "  $ARCHIVE" SHASUMS256.txt | sha256sum -c - || fail "checksum mismatch for $ARCHIVE"

# 2. Install Node beside the image's own versions.
rm -rf "$PREFIX"
mkdir -p "$PREFIX"
tar -xJf "$ARCHIVE" -C "$PREFIX" --strip-components=1
echo 'export PATH=/opt/node24/bin:$PATH' > /etc/profile.d/zz-node24.sh

# 3. pnpm through corepack (shipped with Node 24), pinned to the version in package.json.
export PATH="$PREFIX/bin:$PATH"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack enable --install-directory "$PREFIX/bin" pnpm
corepack prepare "pnpm@$PNPM" --activate

# 4. PATH of a session is not built from /etc/profile.d, so link into /root/.local/bin, which
#    comes first in every session's PATH.
mkdir -p /root/.local/bin
ln -sf "$PREFIX/bin/node" "$PREFIX/bin/npm" "$PREFIX/bin/npx" "$PREFIX/bin/corepack" \
  "$PREFIX/bin/pnpm" /root/.local/bin/

# 5. Check what a session will actually run. The first pnpm call also downloads its binary now,
#    while the network is known to work, instead of in the middle of a session.
export PATH=/root/.local/bin:$PATH
NODE_VERSION=$(node -v)
PNPM_VERSION=$(pnpm -v)
[ "$NODE_VERSION" = "v$V" ] || fail "expected node v$V, found $NODE_VERSION"
[ "$PNPM_VERSION" = "$PNPM" ] || fail "expected pnpm $PNPM, found $PNPM_VERSION"
echo "recalino-setup: node $NODE_VERSION, pnpm $PNPM_VERSION"
```

  **گام اعمال برای مالک محصول** (من environment را تغییر نمی‌دهم):
  1. claude.ai/code ← **New** ← چیپ ابر بالای کادر پیام ← **Cloud** ← آیکون تنظیمات کنار Recalino.
  2. در کادر **Setup script**، کل متن قبلی را با script بالا جایگزین کنید و ذخیره کنید.
  3. یک سشن تازه در environment «Recalino» باز کنید و بخش «بررسی در هر سشن» را اجرا کنید. خروجی باید همان باشد: `/root/.local/bin/node`، `v24.21.0`، `12.4.2`.
  4. اگر setup شکست خورد، پیام `recalino-setup: …` گام خراب را نشان می‌دهد؛ سشن را با Node یا pnpm اشتباه ادامه ندهید. دلیل‌های محتمل: nodejs.org یا registry در دسترس نیست (سطح شبکهٔ environment را ببینید) یا نسخهٔ `V` در nodejs.org وجود ندارد.

  script روی نمونهٔ جدا از این تصویر آزموده شده است: `bash -n`، یک اجرای کامل با مسیرهای آزمایشی (Node 24.21.0 و pnpm 12.4.2 درست فعال شدند) و سه شکست عمدی (checksum دست‌کاری‌شده، نسخهٔ pnpm ناموجود، نسخهٔ Node ناموجود) که هر سه با پیام روشن و کد خروج ۱ ایستادند. اجرای نهایی روی خود environment «Recalino» پس از اعمال بالا با مالک است.

نتیجهٔ setup script پس از نخستین سشن cache می‌شود و با هر تغییر script یا دامنه‌ها، و حدود هر هفت روز، دوباره ساخته می‌شود. برای به‌روزکردن Node، مقدار `V` را عوض کنید و `.nvmrc` و `engines` را هماهنگ نگه دارید؛ checksum خودکار از `SHASUMS256.txt` همان نسخه می‌آید. برای pnpm، `PNPM` را همراه `packageManager` در `package.json` عوض کنید.

## بررسی در هر سشن

```bash
which node; node -v; pnpm -v
env | cut -d= -f1 | grep SUPABASE
```

نتیجهٔ درست: `/root/.local/bin/node`، `v24.21.0`، `12.4.2`، و هیچ خطی برای دستور دوم. تأییدشده در 2026-10-14.

اگر Node 22 یا متغیر `SUPABASE_*` دیده شد، سشن در environment اشتباه (Default) باز شده است: به مالک محصول گزارش بده، از آن مقدارها استفاده نکن، و تا باز شدن سشن در environment درست فقط با `PATH=/opt/node24/bin:$PATH` کار کن اگر Node 24 نصب است.

## آزمون integration و e2e

Docker در تصویر نصب است، ولی daemon آن خودکار روشن نمی‌شود (2026-10-14). بدون آن Supabase محلی بالا نمی‌آید و آزمون‌های integration (بخشی از `pnpm verify`) و `pnpm test:e2e` با `ECONNREFUSED 127.0.0.1:54322` شکست می‌خورند. پیش از این آزمون‌ها:

```bash
nohup dockerd > /tmp/dockerd.log 2>&1 &
pnpm db:start   # بار اول imageها را می‌کشد و چند دقیقه طول می‌کشد
```

اگر پس از restart سشن، `db:start` با `supabase_db_recalino container is not ready: unhealthy` شکست خورد، `pnpm db:stop` و دوباره `pnpm db:start` را اجرا کن. setup script عمداً Docker را روشن نمی‌کند تا شروع سشن کند نشود (D76).

## اجرای migration ابری (D77)

```bash
pnpm db:apply            # dry run: migrationهای در انتظار روی origin/main و یافته‌های حذف داده
pnpm db:apply --apply    # اجرای همه، از قدیمی به جدید، هر کدام با ردیف تاریخچه‌اش در یک تراکنش
```

- migrationی که داده را پاک می‌کند فقط پس از «بله» صریح مالک محصول در چت اجرا می‌شود: `pnpm db:apply --apply --approve-data-loss <version>`.
  - اسکن حذف داده بدنهٔ `do $$ … $$` و `create function|procedure` را هم می‌خواند (با هر tag دلار، و `execute '…'` داخلشان)؛ `delete from` یا `truncate` یا `drop table` در آن‌ها هم «حذف داده» حساب می‌شود (OPS-08، 2026-10-18). تابعی که در بدنه‌اش حذف دارد هم، حتی پیش از آنکه اجرا شود، با ساخته‌شدنش بازبینی صریح می‌خواهد.

- خطای HTTP 401 یا 403 یعنی توکن منقضی یا لغو شده است، یا secret در این environment نیست. گزارش بده و توکن را در چت نخواه.

### گارد هارنس (D81، SEC-05، 2026-10-19)

فهرست `permissions.allow` در `.claude/settings.json` بی‌تغییر است، ولی hook `PreToolUse` ([`.claude/hooks/data-loss-guard.ts`](../../.claude/hooks/data-loss-guard.ts)) پیش از هر Bash و هر `execute_sql` اجرا می‌شود:

| فراخوانی | نتیجه |
|---|---|
| `execute_sql` با `select`، یا `insert`، `update` و `delete` با `where` محدودکننده | بی‌پرسش، مثل قبل |
| `execute_sql` با `drop`، `truncate`، `alter`، `create`، `grant`، `revoke`، `merge`، `copy`، SQL پویا یا زمان‌بندی‌شده (`execute`، `dblink`، `cron.schedule`)، `delete`/`update` که `where` آن همهٔ ردیف‌ها را می‌گیرد (بی `where`، `where true`، `where 2=2`، `where id = id`، `… or true`، `where exists (select 1)`)، upsert با `on conflict … do update` که ردیف‌هایش را از یک query می‌گیرد، یا تغییر `standard_conforming_strings` | پنجرهٔ تأیید (ask) |
| `execute_sql` بلندتر از ۱۰۰٬۰۰۰ نویسه، یا آن‌قدر پیچیده که بررسی‌اش از سقف کار hook بگذرد | پنجرهٔ تأیید (ask) بی‌خواندن SQL؛ hook هیچ‌وقت به مهلت ۱۰ ثانیه نمی‌رسد، چون پس از آن Claude Code فراخوانی را بی‌تصمیم اجرا می‌کند |
| همان قاعده‌ها داخل بدنه‌ها: بدنهٔ dollar-quote، همهٔ رشته‌های یک دستور `do`، و هر رشته‌ای که پس از فاصله، توضیح، `(` یا `;` با واژهٔ آغاز یک دستور Postgres شروع می‌شود (پس از اعمال escape در `E'…'` و `U&'…'` و پیوستن رشته‌ای که در خط بعد ادامه می‌یابد) | پنجرهٔ تأیید (ask) |
| فراخوانی که hook نمی‌تواند بخواند: JSON نامعتبر، بی `tool_name`، یا Bash بی `command` | پنجرهٔ تأیید (ask)، تا اگر Claude Code نام فیلدها را عوض کند گارد بی‌صدا خاموش نشود |
| هر دستور Bash که `approve-data-loss` دارد، حتی با نقل‌قول یا backslash (مثل `--approve-data-'loss'`) | رد (deny): migration حذف داده را خود مالک محصول اجرا می‌کند. برای جست‌وجوی متن، `data-loss` را جست‌وجو کن |
| فقط `pnpm db:apply` و `pnpm db:apply --apply`، تنها روی خط؛ و `supabase db push` | بی‌پرسش، مثل قبل |
| هر دستور دیگری که `db:apply` یا `db-apply` دارد (آرگومان اضافه، `$…`، pipe، `;` یا `&&`) | پنجرهٔ تأیید (ask) |

- در سشن ابری پنجرهٔ تأیید ممکن است نمایش داده نشود (D77)؛ آن‌وقت فراخوانی انجام نمی‌شود و سشن گزارش می‌دهد.
- hook توضیح‌ها (`--` تا `\n` یا `\r`)، رشته‌ها، `E'…'`، `U&'…'` و dollar-quote (با برچسب غیر ASCII) را مثل Postgres می‌خواند و از مسیر symlink هم اجرا می‌شود.
- ادامهٔ رشته هم مثل Postgres خوانده می‌شود: دو رشته که فقط فاصله‌ای با دست‌کم یک خط تازه (و شاید توضیح `--`) میانشان است، با همان حالت escape رشتهٔ اول یک رشته‌اند؛ پس `do 'begin dele'` و در خط بعد `'te from t; end'` همان `delete from t` است و می‌پرسد. دو رشته روی یک خط (`select 'a' 'b'`) یا با توضیح `/* */` میانشان به هم نمی‌پیوندند، همان‌طور که در Postgres.
- نام‌های داخل `"…"` (از جمله `U&"…"`) مثل نام بی‌نقل‌قول بررسی می‌شوند: `"cron"."schedule"`، `cron."schedule"`، `"cron"."alter_job"` و `"dblink_exec"` می‌پرسند؛ خواندن `"cron"."job"` بی‌پرسش است.
- `update` پس از `for` یا `for no key` فقط وقتی قفل ردیف حساب می‌شود که پس از آن پایان دستور، `;`، `)`، `of`، `nowait`، `skip`، `for`، `limit`، `offset`، `fetch` یا `into` بیاید. `open cur for update t set …` در plpgsql مثل هر `update` دیگری بررسی می‌شود.
- روی Windows آزموده نشده است. یک بار روی دستگاه مالک بسنج که این دستور `deny` چاپ کند؛ اگر چیزی چاپ نشد، hook آن‌جا اجرا نمی‌شود و باید گزارش شود: `echo '{"tool_name":"Bash","tool_input":{"command":"x --approve-data-loss"}}' | node .claude/hooks/data-loss-guard.ts`
- **محدودیت‌ها (پارسر کامل نیست):** این‌ها دیده نمی‌شوند و قاعدهٔ «اجازهٔ صریح» CLAUDE.md برایشان پابرجاست: تابعی که هنگام `select` داده یا job را تغییر می‌دهد (مثل `pgmq.drop_queue`، `cron.unschedule` یا `setval`)؛ دستور Bash که هر دو رشتهٔ `approve-data-loss` و `db-apply`/`db:apply` را با متغیر یا glob پنهان کند (مثل `F=loss; node tools/db-*/apply.ts --approve-data-$F <v>`؛ در حالت پیش‌فرض چون `node` در allow list نیست پنجرهٔ تأیید باز می‌شود، ولی در `bypassPermissions` اجرا می‌شود)؛ SQL که در زمان اجرا از تکه‌ها ساخته می‌شود (مثل `'dr' || 'op table t'`؛ `cron.schedule` و `dblink` همیشه می‌پرسند)؛ و `where` همیشه‌درستی که شکل دیگری دارد (`id > 0`، `id is not null`، `id in (select id from t)`). در جهت مقابل، رشتهٔ داده‌ای که با واژهٔ دستور شروع می‌شود (مثل `'Drop the ball'`) پرسش اضافه می‌آورد.
- **تعارض باز:** CLAUDE.md و D77 می‌گویند Claude پس از «بله» صریح مالک، `--approve-data-loss` را اجرا می‌کند؛ hook این را رد می‌کند. تا تصمیم مالک محصول دربارهٔ هم‌خوان کردن CLAUDE.md، دستور حذف داده را مالک خودش اجرا می‌کند و سشن فقط نسخه و یافته‌های dry run را گزارش می‌دهد.
- آزمون: `tools/claude-hooks/data-loss-guard.test.ts` (در `pnpm test:unit` و CI).

## قاعده‌ها

- هر سشن تازهٔ ریکالینو، از جمله سشن‌های کارگری که سشن مدیر می‌سازد، در environment «Recalino» باز می‌شود. سشن‌های موجود environment خود را عوض نمی‌کنند.
- Routine زمان‌بندی‌شده environment سشن سازنده را ارث می‌برد؛ Routine‌های ریکالینو را از سشنی بساز که در «Recalino» باز شده است.
- کلید یا توکن در چت یا مخزن گذاشته نمی‌شود؛ فقط در فیلد Environment variables یا Network secrets همین environment.
