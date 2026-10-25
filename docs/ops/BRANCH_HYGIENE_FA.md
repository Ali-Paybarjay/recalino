# بهداشت شاخه‌ها و کار محلی (Branch Hygiene)

وضعیت: قاعدهٔ عملیاتی از 2026-10-25، پس از پاک‌سازی همان روز (۵ شاخهٔ محلی push‌نشده، ۸ commit، ۱۱۲ فایل commit‌نشده و چند worktree که فقط روی یک دستگاه وجود داشتند). تکمیل [CI_LOW_COST_POLICY](CI_LOW_COST_POLICY.md) است و با آن تعارض ندارد.

## قاعده‌ها

1. **هیچ کاری فقط روی یک دستگاه نمی‌ماند.** هر سشن (انسانی یا عامل) پیش از پایان، شاخهٔ کاری‌اش را push می‌کند؛ push به شاخهٔ کاری CI ندارد و ارزان است.
2. **هر کار یک شاخه و یک PR.** شاخه از `main` فعلی ساخته می‌شود و پس از merge حذف می‌شود. commit روی شاخهٔ قدیمی یا روی `main` محلی ساخته نمی‌شود.
3. **کار رهاشده حفظ می‌شود، نه merge و نه حذف.** هر شاخه‌ای که دیگر دنبال نمی‌شود، با tag `archive/<YYYY-MM-DD>/<branch>` روی GitHub نگه داشته و سپس حذف می‌شود. tag در فهرست شاخه‌ها و PRها دیده نمی‌شود و بعداً قابل بازبینی است.
4. **worktree و تغییر commit‌نشده به سشن بعدی نمی‌رسد.** پیش از بستن سشن یا رها کردن کار: یا commit و push، یا `git stash push -u -m "<تاریخ> <موضوع>"` همراه با patch در جایی خارج از مخزن. worktreeای که کار push‌نشده دارد حذف نمی‌شود.
5. **پیش از هر پاک‌سازی، پشتیبان.** `git bundle create <مسیر خارج از مخزن>.bundle --all` و `git diff > <فایل>.patch`؛ پس از آن هیچ گامی غیرقابل‌برگشت نیست. هیچ force-push روی شاخهٔ دیگری، و هیچ `git add -A` بدون بررسی فایل‌های تازه از نظر دادهٔ حساس.
6. **triage پیش از merge.** برای هر شاخهٔ قدیمی، تعداد commit جلوتر از `origin/main`، تاریخ آخرین commit و پیش‌نمایش `git merge-tree --write-tree origin/main <branch>` ثبت می‌شود. اصلاحی که هنوز در `main` نیست، از نو روی `main` فعلی ساخته و با PR جدا می‌آید (مثل PR #74 و اصلاح ضمیرهای AC-D46-01 در همان روز)، نه merge تاریخچهٔ قدیمی با conflict.

## دستورهای مرجع

```bash
# حفظ یک شاخهٔ رهاشده و حذف آن
git push origin "refs/heads/<branch>:refs/tags/archive/$(date +%F)/<branch>"
git push origin --delete <branch>
git branch -D <branch>

# triage فقط‌خواندنی همهٔ شاخه‌های محلی
git fetch origin --prune
for b in $(git for-each-ref --format='%(refname:short)' refs/heads); do
  ahead=$(git rev-list --count origin/main.."$b"); last=$(git log -1 --format=%cs "$b")
  git merge-tree --write-tree origin/main "$b" >/dev/null 2>&1 && st=clean || st=conflict
  echo "$b | $last | ahead $ahead | $st"
done
```

## سابقهٔ پاک‌سازی 2026-10-25

- tagهای `archive/2026-10-25/*`: `fix/sourceref-codepoint-slice` (بازسازی‌شده در PR #74)، `fix/study-target-literal-phrase` (commit دوم بازسازی شد)، `codex/upload-learning-recovery`، `codex/prod-baseline-eval` و `codex/gemini-release-e2e` (رکوردهای ارزیابی؛ بدون ادغام).
- تغییرهای commit‌نشده به شاخهٔ `wip/voice-check-recovery-2026-10-25` منتقل شدند؛ محتوایشان در `main` جدیدتر است و فقط به‌عنوان آرشیو نگه داشته می‌شوند.
