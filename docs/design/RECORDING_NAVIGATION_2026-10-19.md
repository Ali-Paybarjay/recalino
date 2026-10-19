# ناوبری صفحهٔ ضبط (UX-02، تصمیم مالک محصول 2026-10-19)

## تصمیم

در صفحه‌های ضبط (`/recordings` و `/sessions/<id>/record`) ناوبری پوسته **در هیچ فازی** نمایش داده نمی‌شود: focus mode کامل HANDOFF §4 و قاب C2 («full-screen focus mode, no nav»).

| فاز controller | ناوبری |
|---|---|
| `idle` (پیش از شروع) | پنهان؛ «Back to session» / «Back to Today» در محتوای صفحه |
| `starting`، `recording`، `recovering`، `paused` | پنهان: نه sidebar، نه bottom nav، نه «New session»، نه skip link، نه اعلان Terms |
| `saving`، `saved`، `failed` (پس از Stop) | پنهان؛ «Back to session» / «Back to Today» در محتوای صفحه |

حین ضبط PRD-REC-02 (هیچ قطع، پنجره، صدا یا هشداری) و منطق controller دست‌نخورده‌اند و «Stop and save» پیش از توضیح‌ها آمده و در ۳۹۰×۶۶۴ بدون اسکرول دیده می‌شود.

## سابقه

دستهٔ ۹ (2026-10-19) به تصمیم موقت مالک محصول ناوبری را فقط هنگام ضبط فعال (`captureIsQuiet` در `apps/web/src/ui/recording/capture-phase.ts`) پنهان کرد و پیش از شروع و پس از Stop نشان داد، با تأیید نهایی در پایان اجرای اصلاح ممیزی. مالک محصول پس از دیدن پیش‌نمایش هر دو حالت focus mode کامل را انتخاب کرد (دستهٔ ۱۲، 2026-10-19). این اصلاح به‌صورت نسخه‌دار در [D90](../PRODUCT_DECISIONS_LOG.md) و بند ۱۲ [بازبینی تحویل](HANDOFF_R1_REVIEW.md) ثبت شد.

## پیاده‌سازی

- `apps/web/src/ui/recording/recording-focus.ts`: ثابت `RECORDING_FOCUS_MODE` (اکنون `"always"`) و تابع `recordingFocusActive`.
- `apps/web/src/app/(app)/RecordingShell.tsx`: پوستهٔ دو صفحه. با `"always"` همان `FocusShell` دستهٔ ۴ را می‌کشد، بدون ناوبری و بدون اعلان Terms در هر فاز. با `"while-capturing"` فاز را از `useCaptureQuiet()` (در `RecordingProvider`) می‌خواند و `focus` را روی `AppShell` تنظیم می‌کند.
- `apps/web/src/app/(app)/loading.tsx`: صفحهٔ بارگذاری ضبط `AppShell` را در حالت `focus` می‌کشد، یعنی با `"always"` همیشه بدون ناوبری.
- `apps/web/src/app/(app)/nav.ts`: دو صفحهٔ ضبط «بدون پوسته» حساب نمی‌شوند (`shellSectionFor` برای هر دو `classes` برمی‌گرداند) تا صفحهٔ بارگذاری همان ستون محتوا را بکشد.
- `/dev/ui/recording-shell` و `/dev/ui/recording-shell?state=recording`: همان `RecordingShellFrame` با محتوای نمونه در دو حالت، برای مقایسه در ۳۹۰ و ۱۴۴۰ پیکسل (فقط dev، در production پاسخ 404). با `"always"` هیچ‌کدام ناوبری ندارند.

## گزینهٔ دیگر: ناوبری فقط بیرون از ضبط

کد سوئیچ نگه داشته شده است. در `apps/web/src/ui/recording/recording-focus.ts` مقدار `RECORDING_FOCUS_MODE` را از `"always"` به `"while-capturing"` ببرید. بقیه خودکار است:

- صفحه‌ها `AppShell` را با ناوبری و اعلان Terms پیش از شروع و پس از Stop (از جمله `saving`) می‌کشند و فقط حین ضبط فعال آن را پنهان می‌کنند؛
- صفحهٔ بارگذاری ضبط فقط هنگام ضبط فعال بدون ناوبری است؛
- «Back to session» / «Back to Today» همچنان بیرون از ضبط در محتوای صفحه هست.

این تغییر، تصمیم نسخه‌دار تازه در D90 و بند ۱۲ بازبینی تحویل می‌خواهد. آزمون‌های واحد `recording-focus.test.ts` و `RecordingShell.test.ts` هر دو حالت را می‌سنجند. در e2e، `recording.spec.ts` و `shell.spec.ts` اکنون «بدون ناوبری» را در همهٔ گام‌ها انتظار دارند؛ با `"while-capturing"` گام‌های پیش از شروع و پس از Stop باید ناوبری را انتظار داشته باشند، و `recording-capture.spec.ts` می‌تواند از پیوند «Today» ناوبری استفاده کند.

## محدودیت‌ها

- e2e این تغییر (`recording.spec`، `recording-capture.spec`، `learning-privacy.spec`، `shell.spec`) به Supabase محلی نیاز دارد و در محیط کار اجرا نشد؛ فقط با خواندن به‌روز شد.
- پس از Stop تنها راه برگشت درون اپ پیوند «Back to session» / «Back to Today» است؛ ضبط و ذخیره در provider سطح layout ادامه می‌یابد و Back مرورگر (ناوبری کلاینتی) آن را قطع نمی‌کند؛ نوار «Active recording» در صفحه‌های دیگر وضعیت را نشان می‌دهد.
