# محیط ابری Claude Code برای ریکالینو

تاریخ: 2026-10-14 (تصمیم مالک محصول)

## چرا environment جداگانه

حساب مالک محصول پیش از این فقط یک environment ابری به نام «Default» داشت که همهٔ مخزن‌ها، از جمله fitness-coach، از آن استفاده می‌کنند. آن environment سه متغیر `NEXT_PUBLIC_SUPABASE_URL`، `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` و `SUPABASE_SECRET_KEY` را برای پروژهٔ fitness-coach صادر می‌کند. ریکالینو `SUPABASE_SECRET_KEY` را می‌خواند و متغیر محیطی بر `apps/web/.env.local` مقدم است؛ در نتیجه آزمون‌های محلی با کلید پروژهٔ دیگر اجرا می‌شدند و با 401 شکست می‌خوردند، و هر سشن ریکالینو کلید مدیریتی پروژهٔ دیگری را با خود داشت (نقض حداقل دسترسی). تصویر پایهٔ ابری هم فقط Node 20 تا 22 دارد، در حالی که مخزن Node 24 می‌خواهد (`.nvmrc` و `engines`).

از 2026-10-14 سشن‌های ریکالینو در environment جداگانهٔ **Recalino** باز می‌شوند. «Default» برای پروژه‌های دیگر دست‌نخورده می‌ماند.

## تنظیمات environment «Recalino»

محل ویرایش: claude.ai/code → **New** → چیپ ابر بالای کادر پیام → **Cloud** → آیکون تنظیمات کنار Recalino. (منوی عنوان سشن فقط environment فعلی را ویرایش می‌کند.)

- **Name:** `Recalino`
- **Network access:** هم‌سطح Default. سطح Trusted کافی نیست، چون `*.supabase.co`، `api.supabase.com`، `openrouter.ai` و `*.vercel.app` در فهرست پیش‌فرض نیستند و برای `supabase db push`، اجرای واقعی provider و smoke test لازم‌اند. اگر Custom انتخاب می‌شود: فهرست پیش‌فرض تیک‌خورده به‌علاوهٔ همین چهار دامنه.
- **Environment variables:** فقط `OPENROUTER_API_KEY`، آن هم اختیاری و با کلیدی که سقف هزینهٔ کوچک دارد. هیچ متغیر `SUPABASE_*` یا `NEXT_PUBLIC_*` تعریف نمی‌شود: Supabase ابری از طریق کانکتور، و Supabase محلی با Docker و `pnpm db:env`.
- **Setup script:** Node 24 را کنار نسخه‌های تصویر نصب می‌کند. PATH این تصویر از `/etc/profile.d/` ساخته نمی‌شود، پس symlink در `/root/.local/bin` (که در ابتدای PATH هر سشن است) لازم است:

```bash
#!/bin/bash
# Recalino: Node 24 (the image ships 20-22; package.json engines >=24 <25)
V=24.21.0
cd /tmp && curl -fsSLO "https://nodejs.org/dist/v$V/node-v$V-linux-x64.tar.xz" \
  && mkdir -p /opt/node24 \
  && tar -xJf "node-v$V-linux-x64.tar.xz" -C /opt/node24 --strip-components=1 \
  && rm -f "node-v$V-linux-x64.tar.xz" \
  && echo 'export PATH=/opt/node24/bin:$PATH' > /etc/profile.d/zz-node24.sh \
  && /opt/node24/bin/npm install -g pnpm@12.4.2 \
  && mkdir -p /root/.local/bin \
  && ln -sf /opt/node24/bin/node /opt/node24/bin/npm /opt/node24/bin/npx /opt/node24/bin/corepack /opt/node24/bin/pnpm /root/.local/bin/ \
  || true
```

نتیجهٔ setup script پس از نخستین سشن cache می‌شود و با هر تغییر script یا دامنه‌ها، و حدود هر هفت روز، دوباره ساخته می‌شود. برای به‌روزکردن Node، مقدار `V` را عوض کنید و `.nvmrc` و `engines` را هماهنگ نگه دارید.

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

## قاعده‌ها

- هر سشن تازهٔ ریکالینو، از جمله سشن‌های کارگری که سشن مدیر می‌سازد، در environment «Recalino» باز می‌شود. سشن‌های موجود environment خود را عوض نمی‌کنند.
- Routine زمان‌بندی‌شده environment سشن سازنده را ارث می‌برد؛ Routine‌های ریکالینو را از سشنی بساز که در «Recalino» باز شده است.
- کلید یا توکن در چت یا مخزن گذاشته نمی‌شود؛ فقط در فیلد Environment variables یا Network secrets همین environment.
