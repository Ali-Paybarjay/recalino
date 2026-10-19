# متن‌های رابط در انتظار تأیید مالک محصول

متن رابط باید از طرح مصوب بیاید (CLAUDE.md، «پیاده‌سازی رابط کاربری»؛ D34 و D35). متن‌های زیر برای حالت‌هایی نوشته شده‌اند که نه در `handoff/copy.md` هستند و نه در گزارش‌های بازطراحی 2026-10-04. هیچ‌کدام هنوز تأیید نشده‌اند. همه در [`apps/web/src/ui/pending-copy.ts`](../../apps/web/src/ui/pending-copy.ts) نگه داشته می‌شوند و آزمون `pending-copy.test.ts` بررسی می‌کند که هر متن عیناً در همین فهرست ثبت شده باشد.

پس از تأیید یا اصلاح هر مورد، متن نهایی به جای خودش در متن صفحه منتقل و ردیفش از این فهرست حذف می‌شود.

**تأیید 2026-10-10:** مالک محصول همهٔ ۴۳ متنی را که در این تاریخ در فهرست بودند تأیید کرد (پیگیری D54). ۳۴ متن عیناً منتقل شدند: متن‌های صدا به [`voice/voice-copy.ts`](../../apps/web/src/ui/voice/voice-copy.ts)، متن‌های بازبینی پردازش به `AutomaticLearningView.tsx` و متن‌های `learningMemory.*` به `learning-memory-copy.ts`. نُه متن صدا (`voice.reference.short`، `expired` و `missing`؛ `voice.match.no_sample`، `no_reference` و `policy_unavailable`؛ `voice.readiness.needs_sample`، `needs_class` و `unavailable`) با D54 نمی‌خواندند، چون ممکن بود در حالتی نمایش داده شوند که calibration خود حساب (۲۰ تأیید و ۲۰ رد) کلاس‌های بعد را خودکار بپذیرد. مالک محصول در همان روز متن اصلاح‌شدهٔ هر نُه متن را عیناً تأیید کرد و آن‌ها هم به `voice-copy.ts` رفتند. پیشنهاد PR #23 برای `voice.readiness.unavailable` بدون جملهٔ سوم پذیرفته شد، چون آن جمله با سیاست `autoAccept: false` درست نیست.

پس از آن تأیید فهرست خالی شد.

**تأیید دوم 2026-10-10:** مالک محصول سه متن D55 (`voice.confirmBlockedSummary`، `voice.playback.listenFirst` و `voice.playback.clipFailed`) را عیناً تأیید کرد. این متن‌ها به [`voice/voice-copy.ts`](../../apps/web/src/ui/voice/voice-copy.ts) منتقل شدند.

**تأیید 2026-10-11:** مالک محصول چهار متن D59 و FR-QUOTA-007 (`allowance.shortage`، `allowance.shortageItem`، `allowance.none` و `allowance.covered`) را عیناً تأیید کرد. شرطش این بود که هر متن اقدام متناسب خودش را داشته باشد. متن‌ها به [`allowance-copy.ts`](../../apps/web/src/ui/allowance-copy.ts) منتقل شدند. اقدام‌ها از برچسب‌های موجود و `handoff/copy.md` ساخته شده‌اند و متن تازه‌ای ندارند:

| حالت و متن | اقدام اصلی | اقدام‌های دیگر |
|---|---|---|
| کمبود سهمیه (`allowance.shortage` با `allowance.shortageItem`) | «Ask for more allowance» | «Review material» فقط وقتی انتخاب مواد کمتر کمبود را برطرف می‌کند (صوت یا صفحه، نه نسخهٔ تازه)، و «Review allowance» |
| نبود سهمیهٔ فعال (`allowance.none`) | «Ask the pilot operator» (از بخش Allowance در `handoff/copy.md`) | «Review allowance» |
| سهمیهٔ کافی (`allowance.covered`) | «Retry» در خود پیام، و دکمهٔ اصلی «Retry processing» | پیوند درخواست سهمیه نمایش داده نمی‌شود، چون سهمیه کافی است |

وقتی مقدارها معلوم‌اند و سهمیه کم است یا وجود ندارد، دکمهٔ «Retry after allowance changes» نمایش داده نمی‌شود، چون تلاش دوباره فقط دوباره متوقف می‌شود. وضعیت هر چند ثانیه دوباره خوانده می‌شود و پس از افزایش سهمیه، «Retry processing» ظاهر می‌شود (FR-QUOTA-007 قاعدهٔ ۵). اگر مقدارها در وضعیت نیامده باشند، همان دکمهٔ «Retry after allowance changes» می‌ماند.

در Session sources، اعلان پس از بارگذاری و پیام وضعیت بدون رسید بارگذاری همین اقدام‌ها را نشان می‌دهند: کمبود سهمیه «Ask for more allowance» و «Review allowance»، نبود سهمیه «Ask the pilot operator» و «Review allowance»، و سهمیهٔ کافی «Retry processing».

**تأیید 2026-10-13 (D65، بازبینی یک‌جای پایان کار پنج مشکل):** مالک محصول همهٔ ۳۵ متن پنج جریان کار را عیناً تأیید کرد و متن‌ها از `pending-copy.ts` به فایل نهایی خود منتقل شدند:

| جریان کار | کلیدها | مقصد |
|---|---|---|
| تشخیص صدا، دور دوم (نمونهٔ صدا در شرایط کلاس، پاسخ ۸ مالک) | `voiceSample.classConditions`، `voiceSample.recordAgain`، `voiceSample.replaces` | [`voice/voice-copy.ts`](../../apps/web/src/ui/voice/voice-copy.ts) |
| ناوبری جلسه و گام بعد (۱۴ متن `sessionNavigation.*`) | `nextStep`، `uploadCount`، `audioNotReceived`، `savedOnDevice.*`، `capture.*`، `voiceCheck.*`، `voice.*` | [`workspace/session-navigation-copy.ts`](../../apps/web/src/ui/workspace/session-navigation-copy.ts) |
| ضبط داخل اپ (۴ متن `recordingCapture.*`، فقط پس از Stop) | `missingSummary`، `missingInterval`، `missingHint`، `partMissing` | [`recording/recording-copy.ts`](../../apps/web/src/ui/recording/recording-copy.ts) |
| پایداری آپلود (۶ متن `uploadReliability.*`) | `audio.uploadClosed`، `audio.notStarted`، `audio.incomplete`، `automatic.rejected`، `automatic.notStarted`، `automatic.incomplete` | [`workspace/upload-copy.ts`](../../apps/web/src/ui/workspace/upload-copy.ts) |
| کیفیت درس و عکس تخته (۸ متن `lessonQuality.*`) | `coverage.title`، `coverage.reason.*`، `review.tooLarge` | [`workspace/lesson-quality-copy.ts`](../../apps/web/src/ui/workspace/lesson-quality-copy.ts) (در جای خود، با یادداشت تأیید) |

در همان تأیید، متن مقدمهٔ صفحهٔ ضبط («After Stop, all recorded parts are saved on this device, then uploaded automatically to prepare and save your session notes and flashcards.») که با D60 دقیق نبود، با پیشنهاد گزارش ضبط جایگزین شد: «Recorded parts are saved on this device and sent while you record; after Stop the last part is sent and your notes are prepared.» (`recordingCopy.introduction`).

**تأیید دوم 2026-10-13 (D72، پیگیری مالک محصول):** مالک محصول هر هشت متن خوانایی عکس تخته (`photoQuality.ok`، `blurry`، `too_dark`، `too_bright`، `glare`، `low_detail`، `retake` و `zoomPrompt`؛ [گزارش](../plans/PHOTO_READABILITY_2026-10-13.md)) را عیناً تأیید کرد. متن‌ها از `pending-copy.ts` به [`recording/recording-copy.ts`](../../apps/web/src/ui/recording/recording-copy.ts) (`recordingCopy.photoQuality.*`) منتقل شدند. عنوان Sheet بزرگ‌نمایی همان متن alt موجود است («Board captured around {time}») و متن تازه نیست.

**تأیید 2026-10-14 (D76):** مالک محصول چهار متن حذف عکسی که فقط روی دستگاه است را عیناً تأیید کرد: «Remove this photo» (دکمهٔ ردیف عکس، footer Sheet و دکمهٔ تأیید حذف)، «Remove this photo from this device?» (عنوان `ConfirmDialog`)، «It has not been uploaded.» (تنها پیامد) و «Keep» (گزینهٔ امن). متن‌ها از `pending-copy.ts` به [`recording/recording-copy.ts`](../../apps/web/src/ui/recording/recording-copy.ts) (`recordingCopy.photoRemove.*`) منتقل شدند.

در همان روز، متن بخش «Topics covered» جلسهٔ خالی که هنوز به دکمه‌های «below» اشاره می‌کرد، با متن تأییدشدهٔ مالک محصول جایگزین شد: «Record this session or add material to get started. Your lesson title, notes and flashcards will appear automatically.» (`app/(app)/sessions/[id]/page.tsx`). این متن به جای دکمه‌ها اشاره نمی‌کند، چون اقدام‌ها در کارت بالای صفحه‌اند (D71).

پس از این تأیید فهرست خالی است.

## ممیزی 2026-10-18، دستهٔ ۴ — مسیر زبان‌آموز (`fix/audit-4`)

متن‌های زیر برای رفع یافته‌های UX-03، UX-09، UX-10، UX-12 و UX-14 پیشنهاد شدند، ولی نه در `handoff/copy.md` هستند و نه در قاب‌های طرح و مالک محصول هنوز تأییدشان نکرده است. طبق CLAUDE.md متن رابط عیناً از طرح یا متن موجود می‌آید، پس **هیچ‌کدام در رابط نیستند** و [`pending-copy.ts`](../../apps/web/src/ui/pending-copy.ts) خالی می‌ماند. هر مورد می‌گوید رابط تا تأیید چه نشان می‌دهد. اگر مالک محصول متنی را عیناً در چت تأیید کند، آن متن به فایل نهایی صفحه می‌رود (نه به `pending-copy.ts`).

هر جا متن از قاب یا از متن موجود اپ آمده، در این فهرست نیست (مثلاً Sheet حذف کارت از قاب E3-delete، دکمهٔ «Read and accept» و جملهٔ «The Terms changed on {date}…» از `strings.settings`، و «Sign out» از `strings.settings.signOut`).

- **UX-03، پیام Undo پس از Reject** (`cardActions.rejected`): «Card rejected». الگوی قاب E3 («Card suspended»)، Snackbar با دکمهٔ Undo؛ هنگام ضبط فعال نمایش داده نشود. تا تأیید: کارت ردشده دکمهٔ «Undo last card change» (متن موجود `CardEditor`) دارد.
- **UX-09، راهنمای پیشرفت وقتی Terms تازه پردازش را نگه داشته** (`termsAcceptance.guidance`): «Read and accept the updated Terms to continue.» جایگزین «Open Review account setup to continue.». تا تأیید: جملهٔ مصوب `strings.settings.termsChanged` با تاریخی که سرور می‌دهد؛ اگر تاریخ معلوم نباشد جمله‌ای نمایش داده نمی‌شود و دکمهٔ «Read and accept» می‌ماند.
- **UX-10، رسید حذف حساب در وضعیت `needs_operator`** (`accountDeletion.needsOperator`): «Your account and sessions are already hidden. Removing the rest of your data needs the pilot operator. Contact the pilot operator and give them the request reference below.» تا تأیید: فقط «Request reference: …»، پیوند «Ask the pilot operator» (وقتی نشانی تنظیم شده) و «Sign out»؛ جملهٔ «Server cleanup has been queued.» در این حالت نمایش داده نمی‌شود، چون نادرست است.
- **UX-12، صفحهٔ Allowance، بخش «Need more allowance?»** (`allowanceHelp.need`): «The pilot operator sets your allowance. Processing starts automatically when your material is ready, as long as your allowance covers it.» تا تأیید: فقط «The pilot operator sets your allowance.».
- **UX-12، صفحهٔ Allowance، بخش «Reserved and used»** (`allowanceHelp.reserved`): «Reserved allowance is held while your material is processed. Only usable published output is charged.» تا تأیید: فقط «Only usable published output is charged.» (جملهٔ قدیمی دربارهٔ «work you confirmed» حذف شد، چون پردازش خودکار است).
- **UX-12، خطای تغییر منابع پس از برآورد** (`workspaceErrors.sourcesChanged`): «The selected sources have changed. Check your session material, then try again.» تا تأیید: فقط «The selected sources have changed.» (بدون «Review the processing estimate and confirm again.»).
- **UX-14، بالای صفحهٔ Your data** (`yourData.downloadFirst`): «To keep a copy first, open a session, choose More session tools, then Download notes and cards.» تا تأیید: متنی اضافه نمی‌شود؛ پیوند «Choose a session» به `/sessions` که از قبل بود می‌ماند.

### پیشنهادهای ثبت‌شده که هنوز در رابط نیستند (UX-01 و UX-13)

- **UX-01:** جملهٔ «Class capture, notes and reviews are coming next in the pilot.» از صفحهٔ ورود حذف شد. اگر مالک محصول جملهٔ جایگزین بخواهد، پیشنهاد: «Built for a small pilot group. Sign in with Google to start.» (فقط پیشنهاد؛ در رابط نیست.)
- **UX-13، برآورد انتظار:** پیشنهاد برای زیر «Waiting to process» و «Creating notes and flashcards»: «Most sessions are ready within a few minutes after you stop recording. Longer recordings take longer. You can leave this page.» نیاز به داده‌های واقعی زمان مرحله‌ها (NFR-07) دارد؛ بدون آن عبارت «within a few minutes» تعهد بی‌پشتوانه است.
- **UX-13، دعوت به اعلان:** پیشنهاد: «Want a message when your notes are ready? Turn on notifications in Settings.» (نیازمند تأیید مالک و تصمیم دربارهٔ جای دکمه).
