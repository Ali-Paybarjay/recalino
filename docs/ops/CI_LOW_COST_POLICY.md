# سیاست CI کم‌مصرف (همهٔ مخزن‌های مالک محصول)

تصمیم مالک محصول، 2026-10-13. این سیاست برای ریکالینو و هر مخزن دیگری در حساب GitHub مالک محصول است؛ سشن‌های Claude در مخزن‌های دیگر هم آن را اعمال می‌کنند.

## چرا

- سهمیهٔ رایگان GitHub Actions برای مخزن‌های خصوصی در پلن Free، ۲٬۰۰۰ دقیقه در ماه برای کل حساب است، نه برای هر مخزن.
- در اکتبر 2026 ریکالینو با ۲۹۴ اجرای CI (هر کدام ۱۰ تا ۲۵ دقیقه) همهٔ سهمیه را تا 12 اکتبر مصرف کرد و بعد از آن هر job بدون شروع رد شد (شکست ۳ تا ۵ ثانیه‌ای بدون log).
- علت اصلی: اجرای CI روی **هر push به هر شاخه**، به‌ویژه وقتی چند سشن موازی روی شاخه‌های `feat/*` کار می‌کنند.

## قاعده

1. CI فقط جایی اجرا می‌شود که یک تغییر را دروازه‌بانی می‌کند:
   - `push` به شاخهٔ پیش‌فرض (`main`): بررسی کامل به‌علاوهٔ e2e.
   - `pull_request` به شاخهٔ پیش‌فرض: بررسی کامل (lint، type، تست، build) روی open، synchronize و reopen؛ e2e فقط وقتی PR برچسب `e2e` دارد.
   - `workflow_dispatch`: اجرای دستی روی هر شاخه، وقتی واقعاً لازم است.
2. push ساده به شاخه‌های کاری (`feat/*`، `codex/*`، `claude/*` و مانند آن) هیچ اجرایی ندارد. به‌جای آن، پیش از باز کردن PR، `pnpm verify` (و در تغییرات UI، `pnpm test:e2e`) محلی اجرا می‌شود و خلاصهٔ خروجی در توضیح PR می‌آید.
3. `concurrency` با `cancel-in-progress: true`، یک اجرا برای هر PR و یک اجرا برای هر شاخه؛ push تازه اجرای قبلی همان PR را لغو می‌کند.
4. تغییرات فقط‌مستندات CI را اجرا نمی‌کنند (`paths-ignore`)، مگر مستنداتی که آزمون‌ها می‌خوانند (در ریکالینو: `docs/legal/**` و `docs/design/**`).
5. مرحله‌های گران (e2e، build کامل، نصب مرورگر) فقط در جایی که نتیجه‌شان مصرف می‌شود؛ cache وابستگی‌ها (`cache: pnpm`) همیشه روشن.
6. بودجهٔ Actions در GitHub → Settings → Billing → Budgets and alerts تعریف شده است تا پر شدن سهمیه، کار را بی‌خبر متوقف نکند. هر افزایش بودجه تصمیم مالک محصول است.

## قالب `on:` برای مخزن‌های دیگر

```yaml
on:
  push:
    branches: [main]
    paths-ignore: ["docs/**", "*.md"]   # مستنداتی را که آزمون‌ها می‌خوانند از این فهرست بیرون بگذارید
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened, labeled]
    paths-ignore: ["docs/**", "*.md"]
  workflow_dispatch:

concurrency:
  group: ci-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    if: github.event_name != 'pull_request' || github.event.action != 'labeled' || github.event.label.name == 'e2e'
    # ...
  e2e:
    if: >-
      github.event_name == 'workflow_dispatch' ||
      (github.event_name == 'push' && github.ref == 'refs/heads/main') ||
      (github.event_name == 'pull_request' && contains(github.event.pull_request.labels.*.name, 'e2e'))
    needs: verify
    # ...
```

## برآورد مصرف ریکالینو

| الگو | دقیقه در هر رویداد | پیش از سیاست (اکتبر 2026) | با سیاست |
|---|---|---|---|
| push به شاخهٔ کاری | ۱۰ تا ۳۰ | روی هر push | صفر |
| PR به `main` | حدود ۱۰ | هر push جداگانه، بدون لغو | هر push، اجرای قبلی لغو می‌شود |
| ادغام در `main` | حدود ۳۰ | ۳۰ | ۳۰ |

با همین الگوی کار (چند سشن موازی)، مصرف ماهانه از بیش از ۲٬۰۰۰ دقیقه به حدود یک‌سوم می‌رسد.

## متن پیشنهادی برای تنظیمات شخصی Claude (همهٔ پروژه‌ها)

> CI کم‌مصرف: در هر مخزن، GitHub Actions فقط روی push به شاخهٔ پیش‌فرض، pull request به آن و اجرای دستی (`workflow_dispatch`) اجرا می‌شود؛ e2e فقط روی شاخهٔ پیش‌فرض یا PR با برچسب `e2e`؛ `concurrency` با لغو اجرای قبلی؛ تغییرات فقط‌مستندات بدون CI. پیش از باز کردن PR، بررسی‌ها محلی اجرا می‌شوند. تغییر CI خارج از این الگو با پرسش از من.
