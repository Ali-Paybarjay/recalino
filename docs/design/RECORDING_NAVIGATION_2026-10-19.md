# ناوبری صفحهٔ ضبط (UX-02، تصمیم مالک محصول 2026-10-19)

## تصمیم

در صفحه‌های ضبط (`/recordings` و `/sessions/<id>/record`) ناوبری پوسته **فقط هنگام ضبط فعال** پنهان است:

| فاز controller | ناوبری |
|---|---|
| `idle` (پیش از شروع) | نمایش داده می‌شود |
| `starting`، `recording`، `recovering`، `paused` | پنهان: نه sidebar، نه bottom nav، نه «New session»، نه skip link، نه اعلان Terms |
| `saving`، `saved`، `failed` (پس از Stop) | نمایش داده می‌شود |

مجموعهٔ فاز‌های «ضبط فعال» همان `captureIsQuiet` در `apps/web/src/ui/recording/capture-phase.ts` است. این تصمیم، حالت «focus mode بدون ناوبری، همیشه» را که دستهٔ 4 ساخته بود (`FocusShell`، HANDOFF §4 و قاب C2) در دو حالت پیش از شروع و پس از Stop برمی‌دارد. حین ضبط چیزی تغییر نکرده است: PRD-REC-02 (هیچ قطع، پنجره، صدا یا هشداری) و منطق controller دست‌نخورده‌اند، «Stop and save» پیش از توضیح‌ها آمده و در ۳۹۰×۶۶۴ بدون اسکرول دیده می‌شود، و «Back to session» / «Back to Today» پس از Stop همچنان هست.

این تفاوت با HANDOFF §4 («Recording = full-screen focus mode, no nav») تصمیم صریح مالک محصول است و به‌صورت نسخه‌دار در [D90](../PRODUCT_DECISIONS_LOG.md) و بند ۱۲ [بازبینی تحویل](HANDOFF_R1_REVIEW.md) ثبت شد (دستهٔ ۹، 2026-10-19). تأیید نهایی نگه‌داشتن یا بازگرداندن در پایان همین اجرای اصلاح ممیزی گرفته می‌شود.

## پیاده‌سازی

- `apps/web/src/ui/recording/recording-focus.ts`: ثابت `RECORDING_FOCUS_MODE` و تابع `recordingFocusActive`.
- `apps/web/src/app/(app)/RecordingShell.tsx`: پوستهٔ دو صفحه. فاز را از `useCaptureQuiet()` (در `RecordingProvider`) می‌خواند و `focus` را روی `AppShell` تنظیم می‌کند. `AppShell` در حالت `focus` فقط ستون محتوا را می‌کشد؛ چون `main` و محتوا جایشان را نگه می‌دارند، `RecordingView` با تغییر فاز دوباره ساخته نمی‌شود.
- `apps/web/src/app/(app)/loading.tsx`: صفحهٔ بارگذاری ضبط همان ناوبری را می‌کشد، ولی هنگام ضبط فعال بدون آن، تا با شروع ضبط یک لحظه ناوبری ظاهر نشود.
- `apps/web/src/app/(app)/nav.ts`: دو صفحهٔ ضبط دیگر «بدون پوسته» حساب نمی‌شوند (`shellSectionFor` برای هر دو `classes` برمی‌گرداند).
- `/dev/ui/recording-shell` و `/dev/ui/recording-shell?state=recording`: همان `RecordingShellFrame` با محتوای نمونه در دو حالت، برای مقایسه در ۳۹۰ و ۱۴۴۰ پیکسل (فقط dev، در production پاسخ 404).

## بازگشت به focus mode کامل

در `apps/web/src/ui/recording/recording-focus.ts` مقدار `RECORDING_FOCUS_MODE` را از `"while-capturing"` به `"always"` ببرید. بقیه خودکار است:

- صفحه‌ها دوباره `FocusShell` (رفتار دستهٔ 4) را می‌کشند، بدون ناوبری و بدون اعلان Terms در هر فاز؛
- صفحهٔ بارگذاری ضبط همیشه بدون ناوبری است؛
- «Back to session» / «Back to Today» همچنان پس از Stop در محتوای صفحه هست.

آزمون‌های واحد `recording-focus.test.ts` و `RecordingShell.test.ts` هر دو حالت را می‌سنجند. در e2e، `recording.spec.ts` و `shell.spec.ts` ناوبری پیش از شروع و پس از Stop را انتظار دارند؛ با حالت `"always"` آن گام‌ها باید «بدون ناوبری» شوند.

## محدودیت‌ها

- e2e این دسته (`recording.spec`، `recording-capture.spec`، `learning-privacy.spec`، `shell.spec`) به Supabase محلی نیاز دارد و در محیط کار اجرا نشد.
- هنگام `saving` (چند ثانیهٔ پس از Stop) ناوبری نمایش داده می‌شود، چون تصمیم می‌گوید «پس از Stop». ضبط و ذخیره در provider سطح layout ادامه می‌یابد و ناوبری کلاینتی آن را قطع نمی‌کند؛ نوار «Active recording» در صفحه‌های دیگر وضعیت را نشان می‌دهد.
